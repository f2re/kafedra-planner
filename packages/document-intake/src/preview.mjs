import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { isOfficeFormat } from './formats.mjs';
import { storeGeneratedFile } from './blob-store.mjs';

const execFileAsync = promisify(execFile);
const PREVIEW_CONVERSION_TIMEOUT_MS = 12_000;

function imageMediaType(originalName, mediaType) {
  if (String(mediaType || '').startsWith('image/')) return mediaType;
  const extension = extname(String(originalName || '')).toLowerCase();
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp'
  }[extension] || 'application/octet-stream';
}

function safeName(originalName, format) {
  const base = basename(String(originalName || `document.${format}`))
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .slice(0, 180);
  return extname(base) ? base : `${base}.${format}`;
}

async function convertWithLibreOffice(sourcePath, {
  originalName,
  format,
  blobDir,
  tempDir
}) {
  const directory = await mkdtemp(join(tempDir, 'preview-'));
  try {
    const input = join(directory, safeName(originalName, format));
    await copyFile(sourcePath, input);
    let lastError = null;
    for (const command of ['soffice', 'libreoffice']) {
      try {
        await execFileAsync(
          command,
          [`-env:UserInstallation=file://${join(directory, 'libreoffice-profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', directory, input],
          {
            encoding: 'utf8',
            timeout: PREVIEW_CONVERSION_TIMEOUT_MS,
            killSignal: 'SIGKILL',
            maxBuffer: 16 * 1024 * 1024
          }
        );
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 'ENOENT') break;
      }
    }
    if (lastError) {
      const timedOut = Boolean(lastError?.killed) || lastError?.signal === 'SIGKILL';
      return {
        status: lastError?.code === 'ENOENT' ? 'unavailable' : 'failed',
        mediaType: null,
        blob: null,
        error: timedOut
          ? `libreoffice_preview_timeout_${PREVIEW_CONVERSION_TIMEOUT_MS}ms`
          : String(lastError?.stderr || lastError?.message || lastError)
      };
    }
    const pdf = (await readdir(directory)).find((name) => name.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      return { status: 'failed', mediaType: null, blob: null, error: 'libreoffice_pdf_not_created' };
    }
    const blob = await storeGeneratedFile(join(directory, pdf), {
      blobDir,
      mediaType: 'application/pdf'
    });
    return { status: 'ready', mediaType: 'application/pdf', blob, error: null };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function buildDocumentPreview({
  sourcePath,
  format,
  originalName,
  originalMediaType,
  originalBlob,
  blobDir,
  tempDir,
  enabled = true
}) {
  if (!enabled) {
    return { status: 'disabled', mediaType: null, blob: null, error: null };
  }
  if (format === 'pdf') {
    return {
      status: 'ready',
      mediaType: 'application/pdf',
      blob: {
        sha256: originalBlob.sha256,
        sizeBytes: originalBlob.sizeBytes,
        storagePath: sourcePath,
        mediaType: 'application/pdf'
      },
      error: null
    };
  }
  if (format === 'image') {
    const mediaType = imageMediaType(originalName, originalMediaType);
    return {
      status: 'ready',
      mediaType,
      blob: {
        sha256: originalBlob.sha256,
        sizeBytes: originalBlob.sizeBytes,
        storagePath: sourcePath,
        mediaType
      },
      error: null
    };
  }
  if (isOfficeFormat(format)) {
    return convertWithLibreOffice(sourcePath, {
      originalName,
      format,
      blobDir,
      tempDir
    });
  }
  return { status: 'unsupported', mediaType: null, blob: null, error: null };
}
