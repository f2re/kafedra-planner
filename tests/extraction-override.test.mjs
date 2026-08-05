import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { replaceDocumentBlocks, getDocumentStructure, setExtractionValueOverride } from '../packages/storage/src/document-structure.mjs';

test('ручное исправление не уничтожает машинный результат и сохраняет выбранный блок', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-override-'));
  const database = new Database(join(directory, 'data.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database, '2026-08-05T07:00:00.000Z');
    database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES('sha',10,'text/plain','/tmp/f','2026-08-05T07:00:00.000Z')`);
    database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES('doc',?,'Отчёт','report','processed','ver','2026-08-05T07:00:00.000Z','2026-08-05T07:00:00.000Z')`, workspace.id);
    database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at,structure_status) VALUES('ver','doc',1,'sha','report.txt','text/plain','text','processed','Количество: 10','2026-08-05T07:00:00.000Z','ready')`);
    database.run(`INSERT INTO document_templates(id,workspace_id,name,code,document_type,status,matcher_json,fields_json,source_document_version_id,version,usage_count,created_at,updated_at) VALUES('tpl',?,'Отчёт','report','report','active','{}','[{"key":"count","label":"Количество","type":"number"}]','ver',1,1,'2026-08-05T07:00:00.000Z','2026-08-05T07:00:00.000Z')`, workspace.id);
    database.run(`INSERT INTO template_extractions(id,workspace_id,template_id,document_version_id,values_json,missing_json,confidence,status,created_at) VALUES('ext',?,'tpl','ver','{"values":{"count":10},"evidence":{"count":{"raw":"10","locator":{"startLine":1,"endLine":1}}}}','[]',1,'completed','2026-08-05T07:00:00.000Z')`, workspace.id);
    replaceDocumentBlocks(database, { documentVersionId: 'ver', extractor: 'plain-text', version: '2', blocks: [{ type: 'line', text: 'Количество: 10', locator: { kind: 'text_line', line: 1 } }] });
    const before = getDocumentStructure(database, workspace.id, 'doc');
    const blockId = before.blocks[0].id;
    setExtractionValueOverride(database, workspace.id, 'ext', 'count', { value: 12, locator: { kind: 'text_line', line: 1, blockId }, reason: 'Уточнено оператором' });
    const after = getDocumentStructure(database, workspace.id, 'doc');
    assert.equal(after.extractions[0].machineValues.count, 10);
    assert.equal(after.extractions[0].values.count, 12);
    assert.equal(after.extractions[0].evidence.count.manual, true);
    assert.deepEqual(after.extractions[0].evidence.count.blockIds, [blockId]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
