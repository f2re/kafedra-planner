import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { persistProtocol } from '../packages/protocols/src/persist.mjs';
import { listMeetings } from '../packages/protocols/src/meeting-core.mjs';

const migrationsDir = resolve('migrations');
const COMPLETE_PROTOCOL = {
  protocolNumber: '17',
  meetingDate: '2026-09-15',
  title: 'Заседание кафедры',
  chairperson: 'Иванов Иван Иванович',
  secretary: 'Петрова Анна Сергеевна',
  attendees: 'Иванов И.И.; Петрова А.С.',
  confidence: 0.94,
  evidence: { kind: 'text', line: 1 },
  agendaItems: [{
    itemNo: 1,
    title: 'О подготовке годового плана',
    heardText: 'Слушали доклад заведующего кафедрой.',
    discussedText: null,
    decisionText: 'Подготовить проект плана до 20 сентября 2026 года.',
    responsibleRaw: null,
    dueDate: '2026-09-20',
    evidence: { kind: 'text', line: 6 }
  }]
};

function insertDocumentVersion(database, workspaceId, { documentId, versionId, filePath, originalName, sha, now }) {
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, 1, 'text/plain', ?, ?)
  `, sha, filePath, now);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES (?, ?, ?, 'protocol', 'uploaded', NULL, ?, ?)
  `, documentId, workspaceId, originalName, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type,
      detected_format, processing_status, uploaded_at
    ) VALUES (?, ?, 1, ?, ?, 'text/plain', 'text', 'queued', ?)
  `, versionId, documentId, sha, originalName, now);
  database.run('UPDATE documents SET current_version_id = ? WHERE id = ?', versionId, documentId);
}

test('persistProtocol идемпотентен и не перезаписывает ручные исправления', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-protocol-persist-'));
  const database = new Database(join(dir, 'db.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-09-15T10:00:00.000Z';
    const sourcePath = join(dir, 'protocol-17.txt');
    await writeFile(sourcePath, 'protocol', 'utf8');
    insertDocumentVersion(database, workspace.id, {
      documentId: 'doc-protocol-17', versionId: 'dv-protocol-17', filePath: sourcePath,
      originalName: 'Протокол №17.txt', sha: 'sha-protocol-17', now
    });

    const first = persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: 'dv-protocol-17',
      documentTitle: 'Протокол №17',
      result: COMPLETE_PROTOCOL,
      now
    });
    assert.ok(first);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM meetings').count, 1);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM agenda_items').count, 1);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM decisions').count, 1);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM calendar_items WHERE source_kind='meeting'").count, 1);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM calendar_items WHERE source_kind='decision'").count, 1);

    database.run(`
      UPDATE meetings SET title = 'Исправленное название', protocol_number = '17-А', meeting_date = '2026-09-16'
      WHERE id = ?
    `, first);
    database.run("UPDATE agenda_items SET title='Исправленный вопрос' WHERE meeting_id=?", first);

    const second = persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: 'dv-protocol-17',
      documentTitle: 'Протокол №17',
      result: COMPLETE_PROTOCOL,
      now: '2026-09-15T11:00:00.000Z'
    });
    assert.equal(second, first);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM meetings').count, 1);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM agenda_items').count, 1);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM decisions').count, 1);
    const corrected = database.get('SELECT * FROM meetings WHERE id = ?', first);
    assert.equal(corrected.title, 'Исправленное название');
    assert.equal(corrected.protocol_number, '17-А');
    assert.equal(corrected.meeting_date, '2026-09-16');
    assert.equal(database.get('SELECT title FROM agenda_items WHERE meeting_id = ?', first).title, 'Исправленный вопрос');

    const listed = listMeetings(database, workspace.id);
    assert.equal(listed[0].source_document_id, 'doc-protocol-17');
    assert.equal(listed[0].source_original_name, 'Протокол №17.txt');
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('неполный протокол всё равно создаёт заседание и вопросы проверки без дублей', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-protocol-partial-'));
  const database = new Database(join(dir, 'db.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-09-15T10:00:00.000Z';
    const sourcePath = join(dir, 'partial.txt');
    await writeFile(sourcePath, 'partial', 'utf8');
    insertDocumentVersion(database, workspace.id, {
      documentId: 'doc-partial', versionId: 'dv-partial', filePath: sourcePath,
      originalName: 'Неполный протокол.txt', sha: 'sha-partial', now
    });
    const result = {
      protocolNumber: null,
      meetingDate: null,
      title: 'Заседание кафедры',
      chairperson: null,
      secretary: null,
      attendees: null,
      confidence: 0.35,
      evidence: { kind: 'text', line: 1 },
      agendaItems: []
    };
    const first = persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: 'dv-partial',
      documentTitle: 'Неполный протокол',
      result,
      now
    });
    const second = persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: 'dv-partial',
      documentTitle: 'Неполный протокол',
      result,
      now: '2026-09-15T11:00:00.000Z'
    });
    assert.equal(second, first);
    assert.equal(database.get('SELECT status FROM meetings WHERE id = ?', first).status, 'proposed');
    assert.deepEqual(
      database.all("SELECT issue_code FROM review_items WHERE source_id='dv-partial' ORDER BY issue_code").map((row) => row.issue_code),
      ['agenda_missing', 'meeting_date_missing', 'protocol_number_missing']
    );
    assert.equal(database.get("SELECT COUNT(*) AS count FROM review_items WHERE source_id='dv-partial'").count, 3);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
