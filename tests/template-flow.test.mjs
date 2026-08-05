import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createTemplate, applyMatchingTemplates } from '../packages/templates/src/service.mjs';

function addDocument(database, workspaceId, suffix, text) {
  const now = '2026-08-05T08:00:00.000Z';
  const documentId = `doc_${suffix}`;
  const versionId = `docv_${suffix}`;
  const sha = suffix.padEnd(64, '0').slice(0, 64);
  database.run('INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at) VALUES (?, ?, ?, ?, ?)', sha, text.length, 'text/plain', `/tmp/${suffix}.txt`, now);
  database.run(`INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, 'unknown', 'needs_review', ?, ?, ?)`, documentId, workspaceId, `Приказ ${suffix}`, versionId, now, now);
  database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at) VALUES (?, ?, 1, ?, ?, 'text/plain', 'text', 'needs_review', ?, ?)`, versionId, documentId, sha, `приказ-${suffix}.txt`, text, now);
  return database.get(`SELECT dv.*, d.workspace_id, d.title FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE dv.id = ?`, versionId);
}

test('сохранённый шаблон автоматически применяется к следующему документу', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-template-'));
  const database = new Database(join(directory, 'templates.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const first = addDocument(database, workspace.id, 'first', 'ПРИКАЗ О НАЗНАЧЕНИИ\nДата: 05.08.2026\nОтветственный: Иванов И.И.');
    const template = database.transaction(() => createTemplate(database, workspace.id, {
      documentVersionId: first.id,
      name: 'Приказ о назначении',
      documentType: 'appointment_order',
      matcher: { requiredPhrases: ['ПРИКАЗ О НАЗНАЧЕНИИ', 'Ответственный:'] },
      fields: [
        { key: 'date', label: 'Дата', type: 'date', strategy: 'after_label', anchor: 'Дата:', required: true },
        { key: 'responsible', label: 'Ответственный', type: 'string', strategy: 'after_label', anchor: 'Ответственный:', required: true }
      ]
    }));
    assert.equal(template.preview.values.date, '2026-08-05');

    const second = addDocument(database, workspace.id, 'second', 'ПРИКАЗ О НАЗНАЧЕНИИ\nДата: 12.08.2026\nОтветственный: Петров П.П.');
    const applied = database.transaction(() => applyMatchingTemplates(database, {
      workspaceId: workspace.id, version: second, text: second.extracted_text
    }));
    assert.equal(applied.length, 1);
    assert.equal(applied[0].result.values.date, '2026-08-12');
    assert.equal(applied[0].result.values.responsible, 'Петров П.П.');
    assert.equal(database.get('SELECT COUNT(*) AS count FROM template_extractions').count, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
