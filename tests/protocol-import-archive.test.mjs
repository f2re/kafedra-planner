import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { registerDocument } from '../packages/storage/src/documents.mjs';
import { archiveDocument, restoreDocument } from '../packages/lifecycle/src/service.mjs';
import { extractDepartmentProtocol } from '../packages/protocols/src/extractor.mjs';
import { listProtocolImports } from '../packages/protocols/src/protocol-imports.mjs';

test('архив неудачного импорта обратим и сохраняет исходник, дату из файла и идентичность повтора', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-import-archive-'));
  const db = new Database(join(dir, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(db);
    const text = 'ПРОТОКОЛ № 8\nот «00» октября 2028 года\nПовестка дня:\n1. План работы.\nСЛУШАЛИ: Доклад.\nРЕШИЛИ: Подготовить материалы до 15 ноября 2028 года.';
    const parsed = extractDepartmentProtocol(text);
    assert.equal(parsed.meetingDate, null);
    assert.match(parsed.meetingDateRaw, /«00» октября 2028/);
    assert.equal(extractDepartmentProtocol(text.replace('«00»', '«17»')).meetingDate, '2028-10-17');
    const path = join(dir, 'protocol.txt');
    await writeFile(path, text);
    const sha = createHash('sha256').update(text).digest('hex');
    const input = { workspaceId: workspace.id, title: 'Протокол 8', originalName: 'protocol.txt',
      mediaType: 'text/plain', detectedFormat: 'text', requestedType: 'protocol',
      idempotencyKey: `protocol-year:2028:${sha}`, blob: { sha256: sha, sizeBytes: Buffer.byteLength(text), storagePath: path } };
    const created = registerDocument(db, input);
    db.run("UPDATE document_versions SET processing_status='failed' WHERE id=?", created.versionId);
    db.run("UPDATE documents SET status='failed' WHERE id=?", created.documentId);
    const now = new Date().toISOString();
    db.run(`INSERT INTO extraction_runs(id,document_version_id,extractor_code,extractor_version,status,result_json,started_at,completed_at)
      VALUES ('extract_archive_test',?,'department-protocol','2','failed',?,?,?)`, created.versionId, JSON.stringify({ protocol: parsed }), now, now);
    const list = () => listProtocolImports(db, workspace.id, 2028);
    assert.equal(list().items[0].lifecycle_status, 'active');
    archiveDocument(db, workspace.id, created.documentId, { reason: 'Неудачный импорт' });
    archiveDocument(db, workspace.id, created.documentId, { reason: 'Неудачный импорт' });
    const archived = list().items[0];
    assert.equal(archived.lifecycle_status, 'archived');
    assert.equal(archived.archive_reason, 'Неудачный импорт');
    assert.equal(archived.state, 'failed');
    assert.equal(archived.meeting_date, null);
    assert.match(archived.meeting_date_raw, /«00» октября 2028/);
    assert.equal(archived.sha256, sha);
    const repeated = registerDocument(db, input);
    assert.equal(repeated.documentId, created.documentId);
    assert.equal(repeated.versionId, created.versionId);
    assert.equal(list().items[0].lifecycle_status, 'archived');
    restoreDocument(db, workspace.id, created.documentId);
    restoreDocument(db, workspace.id, created.documentId);
    assert.equal(list().items[0].lifecycle_status, 'active');
    assert.equal(list().items[0].version_id, created.versionId);
    assert.equal(db.get('SELECT COUNT(*) n FROM document_versions').n, 1);
    assert.equal(db.get("SELECT COUNT(*) n FROM audit_log WHERE action IN ('document.archived','document.restored')").n, 2);
    assert.equal(await readFile(path, 'utf8'), text);
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
