import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { requestDocumentReprocess } from '../packages/storage/src/documents.mjs';
import { processDocumentJob } from '../apps/worker/src/processor.mjs';
import {
  applyProtocolProfileForJob,
  shouldApplyProtocolProfileForJob
} from '../apps/worker/src/protocol-profile-job.mjs';
import { getMeeting, updateMeeting } from '../packages/protocols/src/meeting-core.mjs';
import { extendProtocolWithProfileApplications } from '../packages/protocols/src/profile-extension.mjs';

const migrationsDir = resolve('migrations');
const logger = { info() {}, warn() {}, error() {} };

function workerConfig(dir) {
  return {
    tempDir: dir,
    blobDir: dir,
    previewEnabled: false,
    ocrEnabled: false,
    ocrLanguages: 'rus+eng',
    ocrDpi: 200,
    ocrMaxPages: 20,
    ocrMinCharacters: 24
  };
}

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-protocol-profile-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    await run(database, ensureDefaultWorkspace(database), dir);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function source(database, workspaceId, dir, suffix, fixtureName) {
  const text = await readFile(resolve('tests/fixtures', fixtureName), 'utf8');
  const now = new Date().toISOString();
  const documentId = `doc_profile_${suffix}`;
  const versionId = `docv_profile_${suffix}`;
  const path = join(dir, `${suffix}.txt`);
  const sha = createHash('sha256').update(text).digest('hex');
  await writeFile(path, text);
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?,?,'text/plain',?,?)`, sha, Buffer.byteLength(text), path, now);
  database.run(`INSERT INTO documents(
    id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at
  ) VALUES (?,?,?,'department_protocol','queued',?,?,?)`,
  documentId, workspaceId, `Синтетический протокол ${suffix}`, versionId, now, now);
  database.run(`INSERT INTO document_versions(
    id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
    processing_status,upload_key,uploaded_at
  ) VALUES (?,?,1,?,?,'text/plain','text','queued',?,?)`,
  versionId, documentId, sha, `${suffix}.txt`, `protocol-profile:${suffix}`, now);
  return { documentId, versionId, text };
}

function installProfile(database, workspaceId, sourceVersionId) {
  const now = new Date().toISOString();
  database.run(`INSERT INTO document_templates(
    id,workspace_id,name,code,document_type,status,matcher_json,fields_json,
    source_document_version_id,version,usage_count,created_at,updated_at
  ) VALUES (?,?,?,?,?,'active',?,?,?,1,0,?,?)`,
  'template_protocol_profile_synthetic', workspaceId, 'Синтетический профиль протокола',
  'protocol_profile_synthetic', 'department_protocol',
  JSON.stringify({ requiredPhrases: ['Регистрационный индекс:', 'Контрольный код:'] }),
  JSON.stringify([
    {
      key: 'nomer_protokola', label: 'Номер протокола', type: 'string',
      strategy: 'after_label', anchor: 'Регистрационный индекс:', required: true
    },
    {
      key: 'kontrolnyi_kod', label: 'Контрольный код', type: 'string',
      strategy: 'after_label', anchor: 'Контрольный код:', required: true
    }
  ]),
  sourceVersionId, now, now);
}

async function processWithProfile(database, record, dir, payloadExtra = {}) {
  const payload = {
    documentId: record.documentId,
    versionId: record.versionId,
    requestedType: 'protocol',
    ...payloadExtra
  };
  const job = { kind: 'process_document', payload_json: JSON.stringify(payload) };
  assert.equal(shouldApplyProtocolProfileForJob(database, job), true);
  await processDocumentJob(database, payload, logger, workerConfig(dir));
  await applyProtocolProfileForJob(database, job, logger);
  return job;
}

function latestRun(database, versionId) {
  const row = database.get(`SELECT * FROM extraction_runs
    WHERE document_version_id=? ORDER BY started_at DESC, id DESC LIMIT 1`, versionId);
  return { ...row, result: JSON.parse(row.result_json) };
}

test('профиль дополняет два синтетических протокола одного формата и сохраняет locator', () => fixture(
  async (database, workspace, dir) => {
    const first = await source(database, workspace.id, dir, 'one', 'protocol-profile-synthetic-1.txt');
    const second = await source(database, workspace.id, dir, 'two', 'protocol-profile-synthetic-2.txt');
    installProfile(database, workspace.id, first.versionId);

    await processWithProfile(database, first, dir);
    await processWithProfile(database, second, dir);

    const firstRun = latestRun(database, first.versionId);
    const secondRun = latestRun(database, second.versionId);
    assert.equal(firstRun.result.protocol.protocolNumber, 'RP-2026-01');
    assert.equal(secondRun.result.protocol.protocolNumber, 'RP-2026-02');
    assert.equal(firstRun.result.protocol.profileApplications[0].templateCode, 'protocol_profile_synthetic');

    const numberField = firstRun.result.protocol.profileFields.find((field) => field.key === 'nomer_protokola');
    const extraField = firstRun.result.protocol.profileFields.find((field) => field.key === 'kontrolnyi_kod');
    assert.equal(numberField.canonicalField, 'protocolNumber');
    assert.equal(numberField.evidence.locator.startLine, 2);
    assert.equal(numberField.evidence.locator.endLine, 2);
    assert.equal(extraField.canonicalField, null);
    assert.equal(extraField.value, 'КФ-01');
    assert.equal(extraField.evidence.locator.startLine, 3);
    assert.equal(extraField.evidence.locator.endLine, 3);

    const firstMeeting = getMeeting(database, workspace.id, firstRun.result.protocol.id);
    const secondMeeting = getMeeting(database, workspace.id, secondRun.result.protocol.id);
    assert.equal(firstMeeting.protocol_number, 'RP-2026-01');
    assert.equal(secondMeeting.protocol_number, 'RP-2026-02');
    const profileEvidence = JSON.parse(firstMeeting.evidence_json).profileFields.protocolNumber[0];
    assert.equal(profileEvidence.documentVersionId, first.versionId);
    assert.equal(profileEvidence.locator.startLine, 2);
    assert.equal(profileEvidence.locator.endLine, 2);
    assert.equal(database.get('SELECT processing_status FROM document_versions WHERE id=?', first.versionId).processing_status, 'processed');
    assert.equal(database.get(`SELECT COUNT(*) count FROM review_items WHERE source_id=? AND status='open'`, first.versionId).count, 0);
  }
));

test('ручная правка сильнее профиля, а reprocess создаёт новый machine run того же immutable source', () => fixture(
  async (database, workspace, dir) => {
    const record = await source(database, workspace.id, dir, 'manual', 'protocol-profile-synthetic-1.txt');
    installProfile(database, workspace.id, record.versionId);
    await processWithProfile(database, record, dir);

    const firstRun = latestRun(database, record.versionId);
    const meeting = getMeeting(database, workspace.id, firstRun.result.protocol.id);
    updateMeeting(database, workspace.id, meeting.id, {
      meetingDate: meeting.meeting_date,
      protocolNumber: 'MANUAL-01',
      title: meeting.title
    }, null, '2026-09-06T04:00:00.000Z');

    const reprocess = requestDocumentReprocess(database, {
      workspaceId: workspace.id,
      documentId: record.documentId
    });
    assert.equal(reprocess.versionId, record.versionId);
    const queuedJob = database.get('SELECT * FROM jobs WHERE id=?', reprocess.jobId);
    assert.equal(shouldApplyProtocolProfileForJob(database, queuedJob), true);
    const payload = JSON.parse(queuedJob.payload_json);
    await processDocumentJob(database, payload, logger, workerConfig(dir));
    await applyProtocolProfileForJob(database, queuedJob, logger);

    const runs = database.all(`SELECT * FROM extraction_runs
      WHERE document_version_id=? ORDER BY started_at`, record.versionId);
    assert.equal(runs.length, 2);
    const oldMachine = JSON.parse(runs[0].result_json).protocol;
    const newMachine = JSON.parse(runs[1].result_json).protocol;
    assert.equal(oldMachine.protocolNumber, 'RP-2026-01');
    assert.equal(newMachine.protocolNumber, 'RP-2026-01');
    const newNumberLocator = newMachine.profileFields.find((field) => field.key === 'nomer_protokola').evidence.locator;
    assert.equal(newNumberLocator.startLine, 2);
    assert.equal(newNumberLocator.endLine, 2);

    const after = getMeeting(database, workspace.id, meeting.id);
    assert.equal(after.protocol_number, 'MANUAL-01');
    const evidence = JSON.parse(after.evidence_json);
    assert.equal(evidence.manualCorrections.length, 1);
    assert.ok(evidence.profileFields.protocolNumber.length >= 1);
    const conflict = database.get(`SELECT * FROM review_items
      WHERE source_id=? AND issue_code LIKE 'protocol_profile_working_conflict_protocolNumber_%' AND status='open'`,
    record.versionId);
    assert.ok(conflict);
    const conflictLocator = JSON.parse(conflict.context_json).evidence.locator;
    assert.equal(conflictLocator.startLine, 2);
    assert.equal(conflictLocator.endLine, 2);
    assert.equal(database.get('SELECT COUNT(*) count FROM document_versions WHERE id=?', record.versionId).count, 1);
  }
));

test('ошибка одного профильного адаптера локальна и не уничтожает успешный разбор', () => fixture(
  async (database, workspace, dir) => {
    const record = await source(database, workspace.id, dir, 'partial', 'protocol-profile-synthetic-2.txt');
    installProfile(database, workspace.id, record.versionId);
    const now = new Date().toISOString();
    database.run(`INSERT INTO document_templates(
      id,workspace_id,name,code,document_type,status,matcher_json,fields_json,
      source_document_version_id,version,usage_count,created_at,updated_at
    ) VALUES (?,?,?,?,?,'active',?,'{',?,1,0,?,?)`,
    'template_protocol_profile_broken', workspace.id, 'Сломанный профиль', 'protocol_profile_broken',
    'department_protocol', JSON.stringify({ requiredPhrases: ['ПРОТОКОЛ'] }), record.versionId, now, now);

    await processWithProfile(database, record, dir);
    const run = latestRun(database, record.versionId);
    assert.equal(run.result.protocol.protocolNumber, 'RP-2026-02');
    assert.equal(run.result.protocol.profileErrors.length, 1);
    assert.notEqual(database.get('SELECT processing_status FROM document_versions WHERE id=?', record.versionId).processing_status, 'failed');
    const review = database.get(`SELECT * FROM review_items
      WHERE source_id=? AND issue_code='protocol_profile_failed_template_protocol_profile_broken' AND status='open'`,
    record.versionId);
    assert.ok(review);
    assert.ok(getMeeting(database, workspace.id, run.result.protocol.id));
  }
));

test('profile merge keeps base parser authoritative when both have conflicting values', () => {
  const merged = extendProtocolWithProfileApplications({ protocolNumber: 'BASE-7', meetingDate: '2026-09-12' }, [{
    template: { id: 't1', code: 'profile', version: 1 },
    result: {
      confidence: 1,
      values: { nomer_protokola: 'PROFILE-7' },
      evidence: { nomer_protokola: { locator: { kind: 'text_line', line: 2 }, valid: true } },
      missing: []
    }
  }]);
  assert.equal(merged.protocolNumber, 'BASE-7');
  assert.equal(merged.profileConflicts.length, 1);
  assert.equal(merged.profileConflicts[0].incoming, 'PROFILE-7');
});
