import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { registerDocument } from '../packages/storage/src/documents.mjs';
import { persistProtocol } from '../packages/protocols/src/persist.mjs';

const migrationsDir = resolve('migrations');

function protocolResult(overrides = {}) {
  return {
    protocolNumber: '12',
    meetingDate: '2026-08-29',
    title: 'Заседание кафедры',
    chairperson: 'Сидоров С.С.',
    secretary: 'Петрова П.П.',
    attendees: 'Иванов И.И.; Петров П.П.',
    confidence: 0.94,
    evidence: { locator: { lineStart: 1, lineEnd: 8 } },
    agendaItems: [
      {
        itemNo: 1,
        title: 'О плане работы',
        heardText: 'Слушали доклад заведующего.',
        discussedText: 'Обсудили сроки.',
        decisionText: 'Утвердить план работы.',
        responsibleRaw: 'Иванов И.И.',
        dueDate: '2026-09-10',
        evidence: { locator: { lineStart: 10, lineEnd: 18 } }
      },
      {
        itemNo: 2,
        title: 'О научной работе',
        heardText: 'Слушали отчёт.',
        discussedText: null,
        decisionText: 'Принять информацию к сведению.',
        responsibleRaw: null,
        dueDate: null,
        evidence: { locator: { lineStart: 20, lineEnd: 25 } }
      }
    ],
    ...overrides
  };
}

function registerSource(database, workspaceId, suffix) {
  return registerDocument(database, {
    workspaceId,
    title: `Протокол ${suffix}`,
    originalName: `protocol-${suffix}.docx`,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    detectedFormat: 'docx',
    blob: {
      sha256: String(suffix).padEnd(64, String(suffix)).slice(0, 64),
      sizeBytes: 100,
      storagePath: `/tmp/protocol-${suffix}.docx`
    },
    requestedType: 'protocol',
    idempotencyKey: `protocol-${suffix}`
  });
}

async function withDatabase(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-protocol-merge-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    await run(database, workspace.id);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('protocol safely enriches one exact existing meeting and repeat is idempotent', async () => {
  await withDatabase(async (database, workspaceId) => {
    const source = registerSource(database, workspaceId, 'a');
    const now = new Date().toISOString();
    database.run(`
      INSERT INTO meetings(
        id,workspace_id,source_document_version_id,protocol_number,meeting_date,title,
        chairperson_raw,secretary_raw,attendees_raw,confidence,status,evidence_json,created_at,updated_at
      ) VALUES('meeting-existing',?,NULL,'12','2026-08-29','Заседание кафедры',NULL,'Иванова И.И.',NULL,0.5,'scheduled','{}',?,?)
    `, workspaceId, now, now);
    database.run(`
      INSERT INTO agenda_items(
        id,meeting_id,item_no,title,heard_text,discussed_text,decision_text,evidence_json,created_at,updated_at
      ) VALUES('agenda-existing','meeting-existing',1,'О плане работы',NULL,NULL,'Утвердить план работы.','{}',?,?)
    `, now, now);
    database.run(`
      INSERT INTO decisions(id,agenda_item_id,text,responsible_raw,due_date,status,evidence_json,created_at)
      VALUES('decision-existing','agenda-existing','Утвердить план работы.','Иванов И.И.','2026-09-10','proposed','{}',?)
    `, now);

    const result = protocolResult();
    const meetingId = persistProtocol(database, {
      workspaceId,
      documentVersionId: source.versionId,
      documentTitle: 'Протокол №12',
      result
    });

    assert.equal(meetingId, 'meeting-existing');
    assert.equal(result.id, 'meeting-existing');
    assert.equal(database.get('SELECT COUNT(*) AS count FROM meetings').count, 1);
    const meeting = database.get('SELECT * FROM meetings WHERE id=?', meetingId);
    assert.equal(meeting.source_document_version_id, source.versionId);
    assert.equal(meeting.chairperson_raw, 'Сидоров С.С.');
    assert.equal(meeting.secretary_raw, 'Иванова И.И.');
    assert.match(meeting.evidence_json, new RegExp(source.versionId));
    assert.equal(database.get('SELECT COUNT(*) AS count FROM agenda_items WHERE meeting_id=?', meetingId).count, 2);
    const first = database.get('SELECT * FROM agenda_items WHERE id=?', 'agenda-existing');
    assert.equal(first.heard_text, 'Слушали доклад заведующего.');
    assert.equal(first.discussed_text, 'Обсудили сроки.');
    assert.equal(database.get('SELECT COUNT(*) AS count FROM decisions WHERE agenda_item_id=?', 'agenda-existing').count, 1);
    assert.equal(database.get(`SELECT COUNT(*) AS count FROM review_items WHERE issue_code='meeting_field_conflict_secretary_raw'`).count, 1);

    const counts = {
      agenda: database.get('SELECT COUNT(*) AS count FROM agenda_items').count,
      decisions: database.get('SELECT COUNT(*) AS count FROM decisions').count,
      review: database.get('SELECT COUNT(*) AS count FROM review_items').count
    };
    const repeat = protocolResult();
    assert.equal(persistProtocol(database, {
      workspaceId,
      documentVersionId: source.versionId,
      documentTitle: 'Протокол №12',
      result: repeat
    }), meetingId);
    assert.equal(repeat.id, meetingId);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM agenda_items').count, counts.agenda);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM decisions').count, counts.decisions);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM review_items').count, counts.review);
  });
});

test('ambiguous exact meeting match creates an independent meeting and review instead of destructive merge', async () => {
  await withDatabase(async (database, workspaceId) => {
    const source = registerSource(database, workspaceId, 'b');
    const now = new Date().toISOString();
    for (const id of ['meeting-a', 'meeting-b']) {
      database.run(`
        INSERT INTO meetings(
          id,workspace_id,source_document_version_id,protocol_number,meeting_date,title,
          chairperson_raw,secretary_raw,attendees_raw,confidence,status,evidence_json,created_at,updated_at
        ) VALUES(?,?,NULL,'12','2026-08-29','Ранее созданное заседание',NULL,NULL,NULL,0,'scheduled','{}',?,?)
      `, id, workspaceId, now, now);
    }
    const result = protocolResult({ agendaItems: [] });
    const meetingId = persistProtocol(database, {
      workspaceId,
      documentVersionId: source.versionId,
      documentTitle: 'Новый протокол',
      result
    });
    assert.notEqual(meetingId, 'meeting-a');
    assert.notEqual(meetingId, 'meeting-b');
    assert.equal(database.get('SELECT COUNT(*) AS count FROM meetings').count, 3);
    assert.equal(database.get(`SELECT COUNT(*) AS count FROM review_items WHERE issue_code='protocol_meeting_match_ambiguous'`).count, 1);
    assert.equal(database.get('SELECT source_document_version_id FROM meetings WHERE id=?', 'meeting-a').source_document_version_id, null);
    assert.equal(database.get('SELECT source_document_version_id FROM meetings WHERE id=?', 'meeting-b').source_document_version_id, null);
  });
});
