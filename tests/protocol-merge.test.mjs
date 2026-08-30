import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { persistProtocol } from '../packages/protocols/src/persist.mjs';

const migrationsDir = resolve('migrations');

function addDocumentVersion(database, workspaceId, suffix) {
  const now = new Date().toISOString();
  const documentId = `doc_protocol_${suffix}`;
  const versionId = `docv_protocol_${suffix}`;
  const sha = suffix.repeat(64);
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, 10, 'text/plain', ?, ?)
  `, sha, `/tmp/${documentId}.txt`, now);
  database.run(`
    INSERT INTO documents(
      id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'department_protocol', 'processed', ?, ?, ?)
  `, documentId, workspaceId, `Протокол ${suffix}`, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type,
      detected_format, processing_status, upload_key, uploaded_at
    ) VALUES (?, ?, 1, ?, ?, 'text/plain', 'text', 'processed', ?, ?)
  `, versionId, documentId, sha, `${documentId}.txt`, `protocol-test:${suffix}`, now);
  return versionId;
}

function protocol(overrides = {}) {
  return {
    protocolNumber: '7',
    meetingDate: '2026-09-01',
    title: 'Заседание кафедры',
    chairperson: 'Иванов И. И.',
    secretary: null,
    attendees: 'Иванов И. И.; Петров П. П.',
    confidence: 0.88,
    evidence: { lineStart: 1, lineEnd: 40 },
    agendaItems: [{
      itemNo: 1,
      title: 'Об итогах учебного года',
      heardText: 'Первичный доклад',
      discussedText: null,
      decisionText: 'Утвердить результаты',
      responsibleRaw: 'Петров П. П.',
      dueDate: '2026-09-10',
      evidence: { lineStart: 10, lineEnd: 20 }
    }],
    ...overrides
  };
}

test('второй точный протокол дополняет одно заседание и не перезаписывает конфликт', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-protocol-merge-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const firstVersion = addDocumentVersion(database, workspace.id, 'a');
    const secondVersion = addDocumentVersion(database, workspace.id, 'b');
    const first = protocol();
    const secondAgenda = [
      {
        itemNo: 1,
        title: 'Об итогах учебного года',
        heardText: 'Изменённый доклад',
        discussedText: 'Обсудили замечания комиссии',
        decisionText: 'Утвердить результаты',
        responsibleRaw: 'Петров П. П.',
        dueDate: '2026-09-10',
        evidence: { lineStart: 12, lineEnd: 24 }
      },
      {
        itemNo: 2,
        title: 'О плане работы на новый год',
        heardText: 'Доклад заведующего',
        discussedText: null,
        decisionText: 'Подготовить проект плана',
        responsibleRaw: 'Сидорова С. С.',
        dueDate: '2026-09-20',
        evidence: { lineStart: 25, lineEnd: 36 }
      }
    ];
    const second = protocol({
      secretary: 'Сидорова С. С.',
      agendaItems: secondAgenda
    });

    const firstId = database.transaction(() => persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: firstVersion,
      documentTitle: 'Протокол 7, первый источник',
      result: first
    }));
    const secondId = database.transaction(() => persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: secondVersion,
      documentTitle: 'Протокол 7, второй источник',
      result: second
    }));

    assert.equal(secondId, firstId);
    assert.equal(second.id, firstId);
    assert.equal(second.materialization, 'merged');
    assert.equal(second.matchedBy, 'protocol_number_and_date');
    assert.equal(database.get('SELECT COUNT(*) AS count FROM meetings').count, 1);

    const meeting = database.get('SELECT * FROM meetings WHERE id = ?', firstId);
    assert.equal(meeting.secretary_raw, 'Сидорова С. С.');
    const meetingEvidence = JSON.parse(meeting.evidence_json);
    assert.deepEqual(meetingEvidence.sources.map((item) => item.documentVersionId).sort(), [firstVersion, secondVersion].sort());

    const agenda = database.all('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no', firstId);
    assert.equal(agenda.length, 2);
    assert.equal(agenda[0].heard_text, 'Первичный доклад');
    assert.equal(agenda[0].discussed_text, 'Обсудили замечания комиссии');
    assert.equal(agenda[1].title, 'О плане работы на новый год');
    assert.equal(database.get(`
      SELECT COUNT(*) AS count FROM review_items
      WHERE source_id = ? AND issue_code LIKE 'protocol_agenda_heard_text_conflict_%'
    `, secondVersion).count, 1);
    assert.equal(database.get(`
      SELECT COUNT(*) AS count FROM review_items
      WHERE issue_code LIKE 'responsible_person_unresolved_%'
    `).count, 2);

    const beforeRetry = {
      meetings: database.get('SELECT COUNT(*) AS count FROM meetings').count,
      agenda: database.get('SELECT COUNT(*) AS count FROM agenda_items').count,
      decisions: database.get('SELECT COUNT(*) AS count FROM decisions').count,
      reviews: database.get('SELECT COUNT(*) AS count FROM review_items').count,
      search: database.get('SELECT COUNT(*) AS count FROM search_fragments').count,
      calendar: database.get('SELECT COUNT(*) AS count FROM calendar_items').count
    };
    const retry = protocol({
      secretary: 'Сидорова С. С.',
      agendaItems: secondAgenda.map((item) => ({ ...item, evidence: { ...item.evidence } }))
    });
    const retryId = database.transaction(() => persistProtocol(database, {
      workspaceId: workspace.id,
      documentVersionId: secondVersion,
      documentTitle: 'Протокол 7, второй источник',
      result: retry
    }));
    const afterRetry = {
      meetings: database.get('SELECT COUNT(*) AS count FROM meetings').count,
      agenda: database.get('SELECT COUNT(*) AS count FROM agenda_items').count,
      decisions: database.get('SELECT COUNT(*) AS count FROM decisions').count,
      reviews: database.get('SELECT COUNT(*) AS count FROM review_items').count,
      search: database.get('SELECT COUNT(*) AS count FROM search_fragments').count,
      calendar: database.get('SELECT COUNT(*) AS count FROM calendar_items').count
    };

    assert.equal(retryId, firstId);
    assert.equal(retry.materialization, 'existing');
    assert.equal(retry.matchedBy, 'evidence_source');
    assert.deepEqual(afterRetry, beforeRetry);
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
