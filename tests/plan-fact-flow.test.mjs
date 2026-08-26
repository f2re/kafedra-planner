import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  applyReportFactsToAssignment,
  ensureReportFactExtraction,
  getAssignmentPlanFact,
  listPlanFact
} from '../packages/plan-fact/src/service.mjs';

const migrationsDir = resolve('migrations');

test('строит подтверждённый план-факт из поручения и отчёта', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-fact-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-08-05T10:00:00.000Z';
    database.run("INSERT INTO file_blobs VALUES ('sha-pf-a', 1, 'text/plain', '/tmp/a', ?)", now);
    database.run("INSERT INTO file_blobs VALUES ('sha-pf-b', 1, 'text/plain', '/tmp/b', ?)", now);
    database.run(`INSERT INTO documents(
      id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
    ) VALUES ('doc-pf-base', ?, 'Распоряжение 82-р', 'directive', 'processed', 'dv-pf-base', ?, ?)`, workspace.id, now, now);
    database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at, ocr_status, preview_status, structure_status)
      VALUES ('dv-pf-base','doc-pf-base',1,'sha-pf-a','base.txt','text/plain','text','processed','РАСПОРЯЖЕНИЕ № 82-р',?,'not_needed','unsupported','ready')`, now);
    database.run(`INSERT INTO directives(id, workspace_id, source_document_version_id, directive_kind, document_number, issued_at, title, direction, confidence, evidence_json, created_at, updated_at)
      VALUES ('dir-pf',?,'dv-pf-base','directive','82-р','2026-01-10','О публикациях','science',1,'{}',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, position, created_at, updated_at)
      VALUES ('p-pf-manager',?,'Петров Пётр Петрович','петров петр петрович','заведующий',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, position, manager_id, created_at, updated_at)
      VALUES ('p-pf-owner',?,'Сидоров Сергей Сергеевич','сидоров сергей сергеевич','доцент','p-pf-manager',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO assignments(id, workspace_id, directive_id, title, instruction_text, starts_at, due_date, direction, priority, status, expected_result, report_required, confidence, evidence_json, created_at, updated_at)
      VALUES ('as-pf',?,'dir-pf','Подготовить статьи ВАК','Подготовить не менее 5 статей ВАК','2026-01-10','2026-08-20','science','high','open','Не менее 5 статей ВАК',1,1,'{}',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES ('as-pf','p-pf-owner','Сидоров Сергей Сергеевич','executor',?)`, now);
    database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES ('as-pf','p-pf-manager','Петров Пётр Петрович','controller',?)`, now);
    database.run(`INSERT INTO calendar_items(id, workspace_id, source_kind, source_id, title, starts_at, category, importance, status, item_kind, revision, created_at, updated_at)
      VALUES ('cal-pf',?,'assignment','as-pf','Подготовить статьи ВАК','2026-08-20','science','high','open','task',1,?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO documents(
      id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
    ) VALUES ('doc-pf-report', ?, 'Отчёт по распоряжению № 82-р', 'report', 'processed', 'dv-pf-report', ?, ?)`, workspace.id, now, now);
    database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at, ocr_status, preview_status, structure_status)
      VALUES ('dv-pf-report','doc-pf-report',1,'sha-pf-b','report.txt','text/plain','text','processed',?,?,'not_needed','unsupported','ready')`,
      'ОТЧЁТ ПО РАСПОРЯЖЕНИЮ № 82-р\nПоказатель: статьи ВАК; план: 5; факт: 4\nПоручение выполнено частично.', now);
    database.run(`INSERT INTO assignment_evidence(
      id, assignment_id, document_version_id, evidence_kind, note, locator_json,
      created_at, match_status, match_score, match_reasons_json, review_status
    ) VALUES ('ev-pf','as-pf','dv-pf-report','report','Отчёт','{}',?,'accepted',0.9,'[]','pending')`, now);

    const extraction = ensureReportFactExtraction(database, workspace.id, 'dv-pf-report', now);
    assert.equal(extraction.result_state, 'partial');
    assert.equal(extraction.progress_percent, 80);
    applyReportFactsToAssignment(database, workspace.id, 'as-pf', 'ev-pf', extraction, now);

    const pending = getAssignmentPlanFact(database, workspace.id, 'as-pf', { now: new Date(now) });
    assert.equal(pending.metrics.length, 1);
    assert.equal(pending.metrics[0].targetNumeric, 5);
    assert.equal(pending.metrics[0].actualNumeric, 4);
    assert.equal(pending.metrics[0].attainmentPercent, 80);
    assert.equal(pending.metrics[0].status, 'below');
    assert.equal(pending.progressPercent, 80);
    assert.equal(pending.currentOutcome.review_status, 'pending');

    const approvedAt = '2026-08-06T10:00:00.000Z';
    database.run("UPDATE assignment_evidence SET review_status='approved', reviewed_at=? WHERE id='ev-pf'", approvedAt);
    database.run("UPDATE assignments SET status='completed', completed_at=?, updated_at=? WHERE id='as-pf'", approvedAt, approvedAt);
    const approved = getAssignmentPlanFact(database, workspace.id, 'as-pf', { now: new Date(approvedAt) });
    assert.equal(approved.approvedOutcome.review_status, 'approved');
    assert.equal(approved.status, 'completed');
    assert.equal(approved.progressPercent, 80);

    const dashboard = listPlanFact(database, workspace.id, { ownerPersonId: 'p-pf-owner' }, new Date(approvedAt));
    assert.equal(dashboard.summary.total, 1);
    assert.equal(dashboard.summary.completed, 1);
    assert.equal(dashboard.summary.averageProgress, 80);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
