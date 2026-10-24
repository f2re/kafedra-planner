import { readdir, stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, basename, extname } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { newId } from '../../core/src/ids.mjs';
import { detectFormat, supportedFormat } from '../../document-intake/src/formats.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { registerDocument } from '../../storage/src/documents.mjs';
import { enqueueJob } from '../../storage/src/jobs.mjs';
import { loadFolderSyncData, saveFolderSyncData } from './folder-sync-store.mjs';

const MIME_MAP = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.csv': 'text/csv'
};

function mediaTypeFor(fileName) {
  const ext = extname(String(fileName || '')).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function scanDirectory(folderPath, { recursive = false } = {}) {
  const results = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      // Skip hidden files, system files, and Office lock files
      if (name.startsWith('.') || name.startsWith('~$') || name.endsWith('.tmp') || name.endsWith('.bak')) {
        continue;
      }

      const fullPath = join(currentDir, name);
      if (entry.isDirectory()) {
        if (recursive) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(name).toLowerCase();
        const fmt = detectFormat(name, mediaTypeFor(name));
        if (['docx', 'odt', 'pdf', 'text', 'xlsx', 'ods'].includes(fmt)) {
          try {
            const st = await stat(fullPath);
            const relPath = relative(folderPath, fullPath).replace(/\\/g, '/');
            results.push({
              relativePath: relPath,
              absolutePath: fullPath,
              fileName: name,
              ext,
              sizeBytes: st.size,
              mtimeMs: Math.round(st.mtimeMs)
            });
          } catch {}
        }
      }
    }
  }

  await walk(folderPath);
  return results;
}

export async function syncWatchedFolder({ database, workspaceId, dataDir, blobDir, folder, logger }) {
  const now = new Date().toISOString();
  const folderPath = folder.folderPath;

  // 1. Check directory access
  try {
    await access(folderPath, fsConstants.R_OK);
    const st = await stat(folderPath);
    if (!st.isDirectory()) {
      throw new Error('path_is_not_directory');
    }
  } catch (err) {
    const errorMsg = err.code === 'ENOENT'
      ? `Папка не существует: ${folderPath}`
      : `Нет доступа к папке: ${folderPath} (${err.message})`;
    folder.lastError = errorMsg;
    folder.lastSyncedAt = now;
    const data = loadFolderSyncData(dataDir);
    const current = data.folders.find((f) => f.id === folder.id);
    if (current) {
      current.lastError = errorMsg;
      current.lastSyncedAt = now;
      saveFolderSyncData(dataDir, data);
    }
    if (logger) logger.warn('folder sync failed access', { folderId: folder.id, path: folderPath, error: errorMsg });
    return { ok: false, error: errorMsg };
  }

  // 2. Scan files
  let scannedFiles = [];
  try {
    scannedFiles = await scanDirectory(folderPath, { recursive: Boolean(folder.recursive) });
  } catch (err) {
    const errorMsg = `Ошибка сканирования: ${err.message}`;
    folder.lastError = errorMsg;
    folder.lastSyncedAt = now;
    const data = loadFolderSyncData(dataDir);
    const current = data.folders.find((f) => f.id === folder.id);
    if (current) {
      current.lastError = errorMsg;
      current.lastSyncedAt = now;
      saveFolderSyncData(dataDir, data);
    }
    return { ok: false, error: errorMsg };
  }

  const data = loadFolderSyncData(dataDir);
  const state = data.state || {};
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const currentScannedKeys = new Set();

  for (const file of scannedFiles) {
    const stateKey = `${folder.id}:${file.relativePath}`;
    currentScannedKeys.add(stateKey);
    const cached = state[stateKey];

    // If size and mtime are identical, skip re-hashing and re-ingesting
    if (cached && cached.sizeBytes === file.sizeBytes && Math.abs((cached.mtimeMs || 0) - file.mtimeMs) < 1000) {
      cached.lastSeenAt = now;
      cached.status = 'synced';
      unchangedCount++;
      continue;
    }

    let fileSha256;
    try {
      fileSha256 = await sha256File(file.absolutePath);
    } catch {
      continue;
    }

    if (cached && cached.sha256 === fileSha256) {
      // Hash is unchanged, only timestamp changed
      cached.mtimeMs = file.mtimeMs;
      cached.sizeBytes = file.sizeBytes;
      cached.lastSeenAt = now;
      cached.status = 'synced';
      unchangedCount++;
      continue;
    }

    const mediaType = mediaTypeFor(file.fileName);
    const fmt = detectFormat(file.fileName, mediaType);
    let blob;
    try {
      blob = await storeGeneratedFile(file.absolutePath, { blobDir, mediaType });
    } catch (err) {
      if (logger) logger.warn('folder sync blob store failed', { path: file.absolutePath, error: err.message });
      continue;
    }

    if (cached && cached.documentId) {
      // MODIFIED FILE -> Add new document_version and enqueue reprocess job
      const doc = database.get('SELECT * FROM documents WHERE id = ? AND workspace_id = ?', cached.documentId, workspaceId);
      if (doc) {
        const latest = database.get('SELECT MAX(version_no) AS max_v FROM document_versions WHERE document_id = ?', doc.id);
        const newVersionNo = (latest?.max_v || 1) + 1;
        const newVersionId = newId('docv');
        const idempotencyKey = `fsync:${folder.id}:${file.relativePath}:${fileSha256}`;

        database.run(`
          INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, blob.sha256, blob.sizeBytes, mediaType, blob.storagePath, now);

        database.run(`
          INSERT INTO document_versions(
            id, document_id, version_no, blob_sha256, original_name, media_type,
            detected_format, processing_status, upload_key, uploaded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `, newVersionId, doc.id, newVersionNo, fileSha256, file.fileName, mediaType, fmt, idempotencyKey, now);

        database.run(`
          UPDATE documents SET current_version_id = ?, status = 'processing', updated_at = ? WHERE id = ?
        `, newVersionId, now, doc.id);

        enqueueJob(database, {
          kind: 'process_document',
          payload: {
            workspaceId,
            documentId: doc.id,
            versionId: newVersionId,
            requestedType: folder.documentType || 'auto',
            reprocess: true
          },
          priority: 10,
          idempotencyKey
        });

        database.run(`
          INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
          VALUES (?, ?, 'folder_sync', 'document.version_synced_from_folder', 'document', ?, ?, ?)
        `, newId('audit'), workspaceId, doc.id, JSON.stringify({
          folderId: folder.id,
          relativePath: file.relativePath,
          versionId: newVersionId,
          versionNo: newVersionNo,
          sha256: fileSha256
        }), now);

        state[stateKey] = {
          documentId: doc.id,
          versionId: newVersionId,
          sha256: fileSha256,
          sizeBytes: file.sizeBytes,
          mtimeMs: file.mtimeMs,
          status: 'synced',
          lastSeenAt: now
        };
        updatedCount++;
        continue;
      }
    }

    // NEW FILE -> Register document and enqueue initial processing job
    const docTitle = file.fileName.replace(/\.[^.]+$/, '') || file.fileName;
    const idempotencyKey = folder.targetYear && folder.documentType === 'protocol'
      ? `protocol-year:${folder.targetYear}:${fileSha256.slice(0, 16)}`
      : `fsync:${folder.id}:${file.relativePath}:${fileSha256}`;

    const reg = registerDocument(database, {
      workspaceId,
      title: docTitle,
      originalName: file.fileName,
      mediaType,
      detectedFormat: fmt,
      blob,
      requestedType: folder.documentType || 'auto',
      idempotencyKey
    });

    state[stateKey] = {
      documentId: reg.documentId,
      versionId: reg.versionId,
      sha256: fileSha256,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      status: 'synced',
      lastSeenAt: now
    };
    addedCount++;
  }

  // Detect missing files
  const folderPrefix = `${folder.id}:`;
  for (const [key, val] of Object.entries(state)) {
    if (key.startsWith(folderPrefix) && !currentScannedKeys.has(key)) {
      val.status = 'missing';
    }
  }

  // Update folder status
  const current = data.folders.find((f) => f.id === folder.id);
  if (current) {
    current.lastSyncedAt = now;
    current.lastError = null;
    current.filesCount = scannedFiles.length;
  }
  data.state = state;
  saveFolderSyncData(dataDir, data);

  if (logger && (addedCount > 0 || updatedCount > 0)) {
    logger.info('folder sync completed', {
      folderId: folder.id,
      path: folderPath,
      added: addedCount,
      updated: updatedCount,
      total: scannedFiles.length
    });
  }

  return {
    ok: true,
    added: addedCount,
    updated: updatedCount,
    unchanged: unchangedCount,
    addedCount,
    updatedCount,
    unchangedCount,
    total: scannedFiles.length
  };
}
