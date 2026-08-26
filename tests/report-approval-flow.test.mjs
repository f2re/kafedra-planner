import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { generateReportMatchCandidates, acceptReportMatch, reviewAssignmentReport } from '../packages/reports/src/service.mjs';

const migrationsDir = resolve('migrations');

test('автосопоставление отчёта завершается подтверждением руководителя', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-report-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-08-05T10:00:00.000Z';
    database.run("INSERT INTO file_blobs VALUES ('sha-a', 1, 'text/plain', '/tmp/a', ?)", now);
    database.run("INSERT INTO file_blobs VALUES ('sha-b', 1, 'text/plain', '/tmp/b', ?)", now);
    database.run(`INSERT INTO documents(
      id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
    ) VALUES ('doc-base', ?, 'Распоряжение 47-р', 'directive', 'processed', 'dv-base', ?, ?)`, workspace.id, now, now);
    database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at, ocr_status, preview_status, structure_status)
      VALUES ('dv-base','doc-base',1,'sha-a','base.txt','text/plain','text','processed','РАСПОРЯЖЕНИЕ № 47-р',?,'not_needed','unsupported','ready')`, now);
    database.run(`INSERT INTO directives(id, workspace_id, source_document_version_id, directive_kind, document_number, issued_at, title, direction, confidence, evidence_json, created_at, updated_at)
      VALUES ('dir-1',?,'dv-base','directive','47-р','2026-08-05','О подготовке отчёта','science',1,'{}',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO assignments(id, workspace_id, directive_id, title, instruction_text, due_date, direction, priority, status, expected_result, report_required, confidence, evidence_json, created_at, updated_at)
      VALUES ('as-1',?,'dir-1','Подготовить отчёт по НИР','Подготовить отчёт по научно-исследовательской работе','2026-08-20','science','normal','open','Отчёт по НИР',1,1,'{}',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, created_at, updated_at) VALUES ('p-1',?,'Иванов Иван Иванович','иванов иван иванович',?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at) VALUES ('as-1','p-1','Иванов Иван Иванович','executor',?)`, now);
    database.run(`INSERT INTO calendar_items(id, workspace_id, source_kind, source_id, title, starts_at, category, importance, status, item_kind, revision, created_at, updated_at)
      VALUES ('cal-1',?,'assignment','as-1','Подготовить отчёт по НИР','2026-08-20','science','normal','open','task',1,?,?)`, workspace.id, now, now);
    database.run(`INSERT INTO documents(
      id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
    ) VALUES ('doc-report', ?, 'Отчёт по распоряжению № 47-р', 'report', 'processed', 'dv-report', ?, ?)`, workspace.id, now, now);
    database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at, ocr_status, preview_status, structure_status)
      VALUES ('dv-report','doc-report',1,'sha-b','report.txt','text/plain','text','processed','Иванов Иван Иванович подготовил отчёт по НИР. Распоряжение № 47-р выполнено.',?,'not_needed','unsupported','ready')`, now);

    const matches = generateReportMatchCandidates(database, workspace.id, 'dv-report', now);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].score >= 0.65);
    acceptReportMatch(database, workspace.id, matches[0].id, { personId: 'p-1' }, now);
    assert.equal(database.get("SELECT status FROM assignments WHERE id='as-1'").status, 'submitted');
    const approved = reviewAssignmentReport(database, workspace.id, 'as-1', { action: 'approve', personId: 'p-1' }, '2026-08-21T10:00:00.000Z');
    assert.equal(approved.status, 'completed');
    assert.equal(database.get("SELECT review_status FROM assignment_evidence WHERE assignment_id='as-1'").review_status, 'approved');
    assert.equal(database.get("SELECT status FROM calendar_items WHERE id='cal-1'").status, 'completed');
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
