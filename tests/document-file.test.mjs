import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { getDocumentFile } from '../packages/storage/src/document-files.mjs';

test('оригинал и предпросмотр документа разрешаются только в рабочем пространстве', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-file-'));
  const database = new Database(join(directory, 'file.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = new Date().toISOString();
    database.run(
      'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
      'a'.repeat(64), 10, 'image/png', '/tmp/original.png', now
    );
    database.run(
      'INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      'doc_file', workspace.id, 'Скан', 'unknown', 'needs_review', 'docv_file', now, now
    );
    database.run(
      `INSERT INTO document_versions(
        id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
        processing_status,uploaded_at,preview_status,preview_blob_sha256,preview_media_type
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      'docv_file', 'doc_file', 1, 'a'.repeat(64), 'scan.png', 'image/png', 'image',
      'needs_review', now, 'ready', 'a'.repeat(64), 'image/png'
    );
    const preview = getDocumentFile(database, workspace.id, 'doc_file', 'preview');
    assert.equal(preview.available, true);
    assert.equal(preview.fileName, 'scan.png');
    assert.equal(getDocumentFile(database, 'other', 'doc_file', 'original'), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
