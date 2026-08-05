import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { getDocument } from '../packages/storage/src/documents.mjs';

test('инспектор документа получает значения шаблона и доказательства по строкам', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-document-inspector-'));
  const database = new Database(join(directory, 'document.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-08-05T06:00:00.000Z';
    database.run("INSERT INTO file_blobs VALUES ('sha-inspector', 42, 'text/plain', '/tmp/inspector.txt', ?)", now);
    database.run(`
      INSERT INTO documents VALUES ('doc_inspector', ?, 'Приказ', 'order', 'processed', 'docv_inspector', ?, ?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO document_versions(
        id, document_id, version_no, blob_sha256, original_name, media_type,
        detected_format, processing_status, extracted_text, uploaded_at
      ) VALUES ('docv_inspector', 'doc_inspector', 1, 'sha-inspector', 'приказ.txt',
        'text/plain', 'text', 'processed', 'Номер: 17\nДата: 05.08.2026', ?)
    `, now);
    database.run(`
      INSERT INTO document_templates(
        id, workspace_id, name, code, document_type, status, matcher_json, fields_json,
        source_document_version_id, version, usage_count, created_at, updated_at
      ) VALUES ('tpl_inspector', ?, 'Приказ', 'order', 'order', 'active', '{}',
        '[{"key":"number","label":"Номер"}]', 'docv_inspector', 1, 1, ?, ?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO template_extractions(
        id, workspace_id, template_id, document_version_id, values_json,
        missing_json, confidence, status, created_at
      ) VALUES ('te_inspector', ?, 'tpl_inspector', 'docv_inspector',
        '{"values":{"number":"17"},"evidence":{"number":{"locator":{"startLine":1,"endLine":1}}}}',
        '[]', 1, 'completed', ?)
    `, workspace.id, now);

    const document = getDocument(database, workspace.id, 'doc_inspector');
    assert.equal(document.templateExtractions[0].values.number, '17');
    assert.equal(document.templateExtractions[0].evidence.number.locator.startLine, 1);
    assert.equal(document.lines[1].text, 'Дата: 05.08.2026');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
