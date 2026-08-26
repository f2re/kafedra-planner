import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  applyReportFactsToAssignment,
  ensureReportFactExtraction
} from '../packages/plan-fact/src/service.mjs';
import {
  createMetricCorrection,
  getCorrectedAssignmentPlanFact,
  listMetricCorrections,
  revertMetricCorrection
} from '../packages/plan-fact/src/corrections.mjs';
import {
  deletePlanFactView,
  listPlanFactViews,
  savePlanFactView
} from '../packages/plan-fact/src/views.mjs';
import {
  planFactExportCsv,
  planFactExportJson
} from '../packages/plan-fact/src/export.mjs';

const migrationsDir = resolve('migrations');

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-fact-corrections-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const now = '2026-08-05T10:00:00.000Z';

  database.run("INSERT INTO file_blobs VALUES ('sha-corr-a', 1, 'text/plain', '/tmp/a', ?)", now);
  database.run("INSERT INTO file_blobs VALUES ('sha-corr-b', 1, 'text/plain', '/tmp/b', ?)", now);
  database.run(`INSERT INTO documents(
    id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
  ) VALUES ('doc-corr-base', ?, 'Распоряжение 82-р', 'directive', 'processed', 'dv-corr-base', ?, ?)`, workspace.id, now, now);
  database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at, ocr_status, preview_status, structure_status)
    VALUES ('dv-corr-base','doc-corr-base',1,'sha-corr-a','base.txt','text/plain','text','processed','РАСПОРЯЖЕНИЕ № 82-р',?,'not_needed','unsupported','ready')`, now);
  database.run(`INSERT INTO directives(id, workspace_id, source_document_version_id, directive_kind, document_number, issued_at, title, direction, confidence, evidence_json, created_at, updated_at)
    VALUES ('dir-corr',?,'dv-corr-base','directive','82-р','2026-01-10','О публикациях','science',1,'{}',?,?)`, workspace.id, now, now);
  database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, position, created_at, updated_at)
    VALUES ('p-corr-manager',?,'Петров Пётр Петрович','петров петр петрович','заведующий',?,?)`, workspace.id, now, now);
  database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, position, manager_id, created_at, updated_at)
    VALUES ('p-corr-owner',?,'Сидоров Сергей Сергеевич','сидоров сергей сергеевич','доцент','p-corr-manager',?,?)`, workspace.id, now, now);
  database.run(`INSERT INTO assignments(id, workspace_id, directive_id, title, instruction_text, starts_at, due_date, direction, priority, status, expected_result, report_required, confidence, evidence_json, created_at, updated_at)
    VALUES ('as-corr',?,'dir-corr','Подготовить статьи ВАК','Подготовить не менее 5 статей ВАК','2026-01-10','2026-08-20','science','high','completed','Не менее 5 статей ВАК',1,1,'{}',?,?)`, workspace.id, now, now);
  database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
    VALUES ('as-corr','p-corr-owner','Сидоров Сергей Сергеевич','executor',?)`, now);
  database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
    VALUES ('as-corr','p-corr-manager','Петров Пётр Петрович','controller',?)`, now);
  database.run(`INSERT INTO documents(
    id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
  ) VALUES ('doc-corr-report', ?, 'Отчёт по распоряжению № 82-р', 'report', 'processed', 'dv-corr-report', ?, ?)`, workspace.id, now, now);
  database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at, ocr_status, preview_status, structure_status)
    VALUES ('dv-corr-report','doc-corr-report',1,'sha-corr-b','report.txt','text/plain','text','processed',?,?,'not_needed','unsupported','ready')`,
    'ОТЧЁТ ПО РАСПОРЯЖЕНИЮ № 82-р\nПоказатель: статьи ВАК; план: 5; факт: 4\nПоручение выполнено частично.', now);
  database.run(`INSERT INTO assignment_evidence(
    id, assignment_id, document_version_id, evidence_kind, note, locator_json,
    created_at, match_status, match_score, match_reasons_json, review_status,
    reviewed_at, reviewed_by_person_id
  ) VALUES ('ev-corr','as-corr','dv-corr-report','report','Отчёт','{}',?,'accepted',0.9,'[]','approved',?,'p-corr-manager')`, now, now);

  const extraction = ensureReportFactExtraction(database, workspace.id, 'dv-corr-report', now);
  applyReportFactsToAssignment(database, workspace.id, 'as-corr', 'ev-corr', extraction, now);
  return { dir, database, workspace };
}

test('ручные исправления сохраняют машинное значение, историю и экспорт', async () => {
  const fixture = await createFixture();
  const { database, workspace, dir } = fixture;
  try {
    const first = createMetricCorrection(database, workspace.id, 'as-corr', {
      assignmentEvidenceId: 'ev-corr',
      metricKey: 'статья_вак',
      fieldKind: 'actual_numeric',
      value: 5,
      reason: 'Опечатка в сводной строке, подтверждено приложением',
      actorPersonId: 'p-corr-manager'
    }, '2026-08-06T08:00:00.000Z');

    assert.equal(first.correction.machineValue, 4);
    assert.equal(first.correction.correctedValue, 5);
    assert.equal(first.correction.active, true);
    assert.equal(first.item.metrics[0].machineActualNumeric, 4);
    assert.equal(first.item.metrics[0].actualNumeric, 5);
    assert.equal(first.item.metrics[0].attainmentPercent, 100);
    assert.equal(first.item.progressPercent, 100);

    const second = createMetricCorrection(database, workspace.id, 'as-corr', {
      assignmentEvidenceId: 'ev-corr',
      metricKey: 'статья_вак',
      fieldKind: 'actual_numeric',
      value: 3,
      reason: 'Повторная сверка приложений',
      actorPersonId: 'p-corr-manager'
    }, '2026-08-06T09:00:00.000Z');

    assert.equal(second.item.metrics[0].actualNumeric, 3);
    assert.equal(second.item.progressPercent, 60);
    const historyAfterSecond = listMetricCorrections(database, workspace.id, 'as-corr');
    assert.equal(historyAfterSecond.length, 2);
    assert.equal(historyAfterSecond.filter((entry) => entry.active).length, 1);
    assert.equal(historyAfterSecond.find((entry) => entry.id === first.correction.id).active, false);

    const reverted = revertMetricCorrection(database, workspace.id, second.correction.id, {
      actorPersonId: 'p-corr-manager',
      reason: 'Возвращено подтверждённое значение'
    }, '2026-08-06T10:00:00.000Z');
    assert.equal(reverted.item.metrics[0].actualNumeric, 5);
    assert.equal(reverted.item.progressPercent, 100);
    assert.equal(reverted.corrections.find((entry) => entry.id === first.correction.id).active, true);

    const target = createMetricCorrection(database, workspace.id, 'as-corr', {
      metricKey: 'статья_вак',
      fieldKind: 'target_numeric',
      value: 8,
      reason: 'План уточнён решением кафедры',
      actorPersonId: 'p-corr-manager'
    }, '2026-08-06T11:00:00.000Z');
    assert.equal(target.item.metrics[0].machineTargetNumeric, 5);
    assert.equal(target.item.metrics[0].targetNumeric, 8);
    assert.equal(target.item.metrics[0].actualNumeric, 5);
    assert.equal(target.item.metrics[0].attainmentPercent, 63);

    const view = savePlanFactView(database, workspace.id, {
      name: 'Наука · публикации',
      ownerPersonId: 'p-corr-owner',
      createdByPersonId: 'p-corr-owner',
      filters: {
        scope: 'owner',
        personId: 'p-corr-owner',
        direction: 'science',
        status: 'completed'
      }
    }, '2026-08-06T12:00:00.000Z');
    assert.equal(view.name, 'Наука · публикации');
    assert.equal(view.filters.direction, 'science');
    assert.equal(listPlanFactViews(database, workspace.id, 'p-corr-owner').items.length, 1);

    const json = JSON.parse(planFactExportJson(database, workspace.id, {
      ownerPersonId: 'p-corr-owner',
      direction: 'science'
    }, new Date('2026-08-06T13:00:00.000Z')));
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].metrics[0].targetNumeric, 8);
    assert.equal(json.items[0].metrics[0].actualNumeric, 5);
    assert.equal(json.items[0].metrics[0].machineTargetNumeric, 5);

    const csv = planFactExportCsv(database, workspace.id, {
      ownerPersonId: 'p-corr-owner'
    }, new Date('2026-08-06T13:00:00.000Z'));
    assert.ok(csv.startsWith('\uFEFF'));
    assert.match(csv, /Исправлено вручную/);
    assert.match(csv, /План уточнён решением кафедры/);
    assert.match(csv, /Подготовить статьи ВАК/);

    deletePlanFactView(database, workspace.id, view.id, 'p-corr-owner');
    assert.equal(listPlanFactViews(database, workspace.id, 'p-corr-owner').items.length, 0);

    const final = getCorrectedAssignmentPlanFact(database, workspace.id, 'as-corr');
    assert.equal(final.correctionCount, 2);
    assert.equal(final.corrections.length, 3);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
