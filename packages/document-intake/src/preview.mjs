import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { isOfficeFormat } from './formats.mjs';
import { storeGeneratedFile } from './blob-store.mjs';

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

function runProcessGroup(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== 'win32',
      stdio: 'ignore'
    });
    let settled = false;
    let timedOut = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);
    timer.unref?.();
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (timedOut) {
        const error = new Error(`libreoffice_preview_timeout_${timeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        error.signal = signal || 'SIGKILL';
        return finish(error);
      }
      if (code === 0) return finish();
      const error = new Error(`libreoffice_preview_exit_${code ?? 'signal'}`);
      error.code = code;
      error.signal = signal;
      return finish(error);
    });
  });
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
        await runProcessGroup(
          command,
          [`-env:UserInstallation=file://${join(directory, 'libreoffice-profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', directory, input],
          PREVIEW_CONVERSION_TIMEOUT_MS
        );
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 'ENOENT') break;
      }
    }
    if (lastError) {
      return {
        status: lastError?.code === 'ENOENT' ? 'unavailable' : 'failed',
        mediaType: null,
        blob: null,
        error: String(lastError?.message || lastError)
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
