import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createPeriodicTaskV2 } from '../packages/work-management/src/periodic-tasks.mjs';
import {
  attachPeriodicTaskReport,
  reviewPeriodicTaskReport
} from '../packages/work-management/src/periodic-task-reports.mjs';

const migrationsDir = resolve('migrations');

async function addReportDocument(database, workspaceId, root, id, text, now) {
  const blobDir = join(root, 'blobs');
  await mkdir(blobDir, { recursive: true });
  const bytes = Buffer.from(text);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const path = join(blobDir, sha);
  await writeFile(path, bytes);
  const versionId = `${id}-v`;
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?,?,'text/plain',?,?)`, sha, bytes.length, path, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,'Отчёт','report','processed',?,?,?)`, id, workspaceId, versionId, now, now);
  database.run(`INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
      processing_status,extracted_text,uploaded_at
    ) VALUES (?,?,1,?,'report.txt','text/plain','text','processed',?,?)`, versionId, id, sha, text, now);
  return id;
}

test('периодический материал прикладывается и проверяется без изменения статуса задачи', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-periodic-report-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Смирнов Сергей Сергеевич' });
    const owner = createPerson(database, workspace.id, {
      displayName: 'Иванов Иван Иванович', managerId: manager.id
    });
    const now = '2026-08-08T10:00:00.000Z';
    const task = createPeriodicTaskV2(database, workspace.id, {
      ownerPersonId: owner.id,
      title: 'Семестровый отчёт кафедры',
      periodKind: 'semester', periodKey: '2026-1',
      startsAt: '2026-08-15', dueDate: '2026-08-30',
      direction: 'organizational', expectedResult: 'Отчёт при необходимости', reportRequired: true
    }, { actorPersonId: manager.id, now });

    const firstDocument = await addReportDocument(
      database, workspace.id, root, 'periodic-report-1',
      'ОТЧЁТ\nРабота выполнена частично. Выполнение 60%.', now
    );
    const attached = attachPeriodicTaskReport(database, workspace.id, task.id, {
      documentId: firstDocument, note: 'Материал к задаче'
    }, { actorPersonId: owner.id, now: '2026-08-20T10:00:00.000Z' });
    assert.equal(attached.task.status, 'open');
    assert.equal(attached.task.completed_at, null);
    assert.equal(attached.reports.length, 1);
    assert.equal(attached.reports[0].review_status, 'pending');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM report_fact_extractions').n, 1);

    const returned = reviewPeriodicTaskReport(database, workspace.id, task.id, {
      action: 'return', note: 'Уточнить показатели'
    }, { actorPersonId: manager.id, now: '2026-08-21T10:00:00.000Z' });
    assert.equal(returned.task.status, 'open');
    assert.equal(returned.reports[0].review_status, 'returned');

    const secondDocument = await addReportDocument(
      database, workspace.id, root, 'periodic-report-2',
      'ОТЧЁТ\nРабота выполнена полностью. Выполнение 100%.',
      '2026-08-22T10:00:00.000Z'
    );
    const second = attachPeriodicTaskReport(database, workspace.id, task.id, {
      documentId: secondDocument, note: 'Обновлённый материал'
    }, { actorPersonId: owner.id, now: '2026-08-22T10:00:00.000Z' });
    assert.equal(second.task.status, 'open');
    assert.equal(second.reports.filter((item) => item.review_status === 'pending').length, 1);

    const approved = reviewPeriodicTaskReport(database, workspace.id, task.id, {
      action: 'approve', note: 'Материал проверен'
    }, { actorPersonId: manager.id, now: '2026-08-23T10:00:00.000Z' });
    assert.equal(approved.task.status, 'open');
    assert.equal(approved.task.completed_at, null);
    assert.equal(approved.reports.filter((item) => item.review_status === 'approved').length, 1);
    assert.equal(approved.reports.filter((item) => item.review_status === 'returned').length, 1);

    const calendar = database.all(`SELECT source_kind,status FROM calendar_items
      WHERE source_id=? ORDER BY source_kind`, task.id);
    assert.equal(calendar.find((item) => item.source_kind === 'periodic_task').status, 'open');
    assert.equal(calendar.find((item) => item.source_kind === 'periodic_task_plan').status, 'confirmed');
    assert.equal(database.get(`SELECT COUNT(*) AS n FROM audit_log
      WHERE subject_id=? AND action IN ('periodic_task.report_attached','periodic_task.report_returned','periodic_task.report_approved')`, task.id).n, 4);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
