import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  getTemplateDraft,
  saveTemplateDraft,
  deleteTemplateDraft
} from '../packages/templates/src/drafts.mjs';

function addDocument(database, workspaceId) {
  const now = '2026-08-05T06:00:00.000Z';
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES ('draft-sha', 10, 'text/plain', '/tmp/draft.txt', ?)
  `, now);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES ('doc_draft', ?, 'Приказ', 'unknown', 'processed', 'docv_draft', ?, ?)
  `, workspaceId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type,
      detected_format, processing_status, extracted_text, uploaded_at
    ) VALUES ('docv_draft', 'doc_draft', 1, 'draft-sha', 'приказ.txt', 'text/plain', 'text', 'processed', 'Номер: 12', ?)
  `, now);
}

test('черновик шаблона сохраняет шаг и поля и не смешивается с другим документом', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-template-draft-'));
  const database = new Database(join(directory, 'draft.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addDocument(database, workspace.id);
    const first = saveTemplateDraft(database, workspace.id, {
      documentVersionId: 'docv_draft',
      step: 2,
      payload: {
        name: 'Приказ',
        fields: [{ key: 'number', label: 'Номер', anchor: 'Номер:' }]
      }
    }, '2026-08-05T06:01:00.000Z');
    assert.equal(first.step, 2);
    assert.equal(first.payload.fields[0].key, 'number');

    const updated = saveTemplateDraft(database, workspace.id, {
      documentVersionId: 'docv_draft',
      step: 3,
      payload: { name: 'Приказ о назначении', fields: first.payload.fields }
    }, '2026-08-05T06:02:00.000Z');
    assert.equal(updated.id, first.id);
    assert.equal(getTemplateDraft(database, workspace.id, 'docv_draft').step, 3);
    assert.equal(deleteTemplateDraft(database, workspace.id, 'docv_draft'), true);
    assert.equal(getTemplateDraft(database, workspace.id, 'docv_draft'), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
