import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { processDocumentJob } from '../apps/worker/src/processor.mjs';
import { listProtocolImports } from '../packages/protocols/src/protocol-imports.mjs';
import { getMeeting, updateMeeting } from '../packages/protocols/src/meeting-core.mjs';
import { addAgendaItem, updateAgendaItem } from '../packages/protocols/src/meeting-agenda.mjs';
import { persistProtocol } from '../packages/protocols/src/persist.mjs';

const migrationsDir = resolve('migrations');
const logger = { info() {}, warn() {}, error() {} };

async function fixture(prefix, run) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try { await run(database, ensureDefaultWorkspace(database), dir); }
  finally { database.close(); await rm(dir, { recursive: true, force: true }); }
}

async function source(database, workspaceId, dir, suffix, text, importYear, status = 'queued') {
  const now = new Date().toISOString();
  const documentId = `doc_year_${suffix}`;
  const versionId = `docv_year_${suffix}`;
  const path = join(dir, `${suffix}.txt`);
  const sha = createHash('sha256').update(suffix).digest('hex');
  await writeFile(path, text);
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?,?,'text/plain',?,?)`, sha, Buffer.byteLength(text), path, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,?,'department_protocol',?,?,?,?)`, documentId, workspaceId, `Протокол ${suffix}`, status, versionId, now, now);
  database.run(`INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,upload_key,uploaded_at
    ) VALUES (?,?,1,?,?,'text/plain','text',?,?,?)`, versionId, documentId, sha, `${suffix}.txt`, status,
  `protocol-year:${importYear}:${suffix}`, now);
  return { documentId, versionId };
}

function workerConfig(dir) {
  return { tempDir: dir, blobDir: dir, previewEnabled: false, ocrEnabled: false,
    ocrLanguages: 'rus+eng', ocrDpi: 200, ocrMaxPages: 20, ocrMinCharacters: 24 };
}

async function processProtocol(database, workspace, dir, record) {
  await processDocumentJob(database, {
    workspaceId: workspace.id, documentId: record.documentId,
    versionId: record.versionId, requestedType: 'protocol'
  }, logger, workerConfig(dir));
}

test('годовой импорт хранит partial success и становится готовым после исправления', () => fixture(
  'kafedra-protocol-year-', async (database, workspace, dir) => {
    const text = `ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ
от 5 августа 2026 года

ПОВЕСТКА ДНЯ
1. Об итогах учебного года.
СЛУШАЛИ: Доклад заведующего кафедрой.
РЕШИЛИ: Утвердить итоги учебного года.`;
    const record = await source(database, workspace.id, dir, 'annual-a', text, 2025);
    await processProtocol(database, workspace, dir, record);

    assert.equal(database.get('SELECT processing_status FROM document_versions WHERE id = ?', record.versionId).processing_status, 'needs_review');
    assert.deepEqual(database.all(`SELECT issue_code FROM review_items WHERE source_id=? AND status='open' ORDER BY issue_code`,
      record.versionId).map((row) => row.issue_code), ['protocol_number_missing', 'protocol_year_mismatch']);

    const before = listProtocolImports(database, workspace.id, 2025);
    assert.deepEqual(before.summary, { total: 1, ready: 0, needs_review: 1, failed: 0, processing: 0 });
    assert.equal(before.items[0].meeting_date, '2026-08-05');
    const meetingId = before.items[0].meeting_id;
    assert.ok(meetingId);

    const current = getMeeting(database, workspace.id, meetingId);
    const updated = updateMeeting(database, workspace.id, meetingId, {
      meetingDate: '2025-08-05', protocolNumber: '7', title: current.title
    }, null, '2026-09-04T06:00:00.000Z');
    assert.equal(updated.open_review_count, 0);
    assert.equal(listProtocolImports(database, workspace.id, 2025).summary.ready, 1);

    const extraction = JSON.parse(database.get(`SELECT result_json FROM extraction_runs
      WHERE document_version_id=? ORDER BY started_at DESC LIMIT 1`, record.versionId).result_json);
    assert.equal(extraction.protocol.protocolNumber, null);
    assert.equal(extraction.protocol.meetingDate, '2026-08-05');
    assert.equal(extraction.protocol.importYear, 2025);
    assert.equal(database.get(`SELECT COUNT(*) count FROM audit_log
      WHERE action='meeting.reviews.resolved' AND subject_id=?`, meetingId).count, 1);
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
  }
));

test('правка решения синхронизирует повестку, календарь и связанное сомнение', () => fixture(
  'kafedra-protocol-decision-', async (database, workspace, dir) => {
    const record = await source(database, workspace.id, dir, 'annual-b', 'protocol source', 2026, 'needs_review');
    const protocol = {
      protocolNumber: '8', meetingDate: '2026-09-03', title: 'Заседание кафедры',
      chairperson: null, secretary: null, attendees: null, confidence: 0.9,
      evidence: { lineStart: 1, lineEnd: 12 },
      agendaItems: [{ itemNo: 1, title: 'О подготовке отчёта', heardText: 'Доклад заведующего',
        discussedText: null, decisionText: 'Подготовить отчёт', responsibleRaw: 'Сидоров П. П.',
        dueDate: '2026-09-20', evidence: { lineStart: 5, lineEnd: 11 } }]
    };
    const meetingId = database.transaction(() => persistProtocol(database, {
      workspaceId: workspace.id, documentVersionId: record.versionId, documentTitle: 'Протокол 8', result: protocol
    }));
    const now = '2026-09-04T06:30:00.000Z';
    database.run(`INSERT INTO extraction_runs(
      id,document_version_id,extractor_code,extractor_version,status,confidence,result_json,started_at,completed_at
    ) VALUES ('extract_manual_protocol',?,'department-protocol','1','needs_review',0.9,?,?,?)`,
    record.versionId, JSON.stringify({ protocol }), now, now);

    const item = getMeeting(database, workspace.id, meetingId).agenda[0];
    const updated = updateAgendaItem(database, workspace.id, meetingId, item.id, {
      title: item.title, heardText: item.heard_text, discussedText: 'Замечания учтены',
      decisionText: 'Подготовить и представить отчёт', responsibleRaw: 'Сидоров Пётр Петрович', dueDate: '2026-09-25'
    }, null, now);
    const decision = updated.agenda[0].decision;
    assert.equal(updated.open_review_count, 0);
    assert.equal(decision.responsible_raw, 'Сидоров Пётр Петрович');
    assert.equal(decision.due_date, '2026-09-25');
    assert.equal(decision.status, 'confirmed');
    const calendar = database.get(`SELECT * FROM calendar_items WHERE source_kind='decision' AND source_id=?`, decision.id);
    assert.equal(calendar.starts_at, '2026-09-25');
    assert.match(calendar.description, /представить отчёт/u);
    assert.equal(JSON.parse(decision.evidence_json).sources[0].documentVersionId, record.versionId);
    assert.equal(JSON.parse(decision.evidence_json).manualCorrections.length, 1);
  }
));

test('протокол без текстового слоя создаёт карточку для ручного восстановления', () => fixture(
  'kafedra-protocol-empty-', async (database, workspace, dir) => {
    const record = await source(database, workspace.id, dir, 'annual-empty', '', 2026);
    await processProtocol(database, workspace, dir, record);
    const annual = listProtocolImports(database, workspace.id, 2026);
    assert.equal(annual.summary.needs_review, 1);
    assert.ok(annual.items[0].meeting_id);
    assert.deepEqual(annual.items[0].reviews.map((row) => row.issue_code).sort(), [
      'agenda_missing', 'empty_text', 'meeting_date_missing', 'protocol_number_missing'
    ]);

    const meeting = getMeeting(database, workspace.id, annual.items[0].meeting_id);
    updateMeeting(database, workspace.id, meeting.id, {
      protocolNumber: '9', meetingDate: '2026-11-10', title: 'Заседание кафедры'
    }, null, '2026-09-04T07:00:00.000Z');
    const repaired = addAgendaItem(database, workspace.id, meeting.id, {
      title: 'О восстановлении протокола', decisionText: 'Принять восстановленные сведения к учёту'
    }, null, '2026-09-04T07:01:00.000Z');
    assert.equal(repaired.open_review_count, 0);
    assert.equal(listProtocolImports(database, workspace.id, 2026).summary.ready, 1);
  }
));
