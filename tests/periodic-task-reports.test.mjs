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
import { listPersonalNotifications } from '../packages/plan-fact/src/notifications.mjs';
import { listPlanFact } from '../packages/plan-fact/src/service.mjs';

const migrationsDir = resolve('migrations');

async function addReportDocument(database, workspaceId, root, id, text, now) {
  const blobDir = join(root, 'blobs');
  await mkdir(blobDir, { recursive: true });
  const bytes = Buffer.from(text);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const path = join(blobDir, sha);
  await writeFile(path, bytes);
  const versionId = `${id}-v`;
  database.run(`
    INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?,?,'text/plain',?,?)
  `, sha, bytes.length, path, now);
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,'Отчёт','report','processed',?,?,?)
  `, id, workspaceId, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
      processing_status,extracted_text,uploaded_at
    ) VALUES (?,?,1,?,'report.txt','text/plain','text','processed',?,?)
  `, versionId, id, sha, text, now);
  return id;
}

test('периодический отчёт проходит submit → return → новый submit → approve без потери истории', async () => {
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
      direction: 'organizational', expectedResult: 'Подтверждённый отчёт', reportRequired: true
    }, { actorPersonId: manager.id, now });

    const firstDocument = await addReportDocument(
      database, workspace.id, root, 'periodic-report-1',
      'ОТЧЁТ\nРабота выполнена частично. Выполнение 60%. Требуется уточнение итогов.', now
    );
    const submitted = attachPeriodicTaskReport(database, workspace.id, task.id, {
      documentId: firstDocument, note: 'Первый вариант'
    }, { actorPersonId: owner.id, now: '2026-08-20T10:00:00.000Z' });
    assert.equal(submitted.task.status, 'submitted');
    assert.equal(submitted.reports.length, 1);
    assert.equal(submitted.reports[0].review_status, 'pending');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM report_fact_extractions').n, 1);

    const managerNotifications = listPersonalNotifications(database, workspace.id, {
      personId: manager.id, now: new Date('2026-08-20T11:00:00Z'), limit: 100
    });
    const managerTaskNotifications = managerNotifications.items.filter((item) => item.sourceKind === 'periodic_task' && item.sourceId === task.id);
    assert.equal(managerTaskNotifications.filter((item) => item.kind === 'manager_review').length, 1);
    assert.equal(managerTaskNotifications.filter((item) => item.kind === 'reminder').length, 0);

    const returned = reviewPeriodicTaskReport(database, workspace.id, task.id, {
      action: 'return', note: 'Добавьте итоговые показатели'
    }, { actorPersonId: manager.id, now: '2026-08-21T10:00:00.000Z' });
    assert.equal(returned.task.status, 'rework');
    assert.equal(returned.reports[0].review_status, 'returned');

    const ownerNotifications = listPersonalNotifications(database, workspace.id, {
      personId: owner.id, now: new Date('2026-08-21T11:00:00Z'), limit: 100
    });
    const ownerTaskNotifications = ownerNotifications.items.filter((item) => item.sourceKind === 'periodic_task' && item.sourceId === task.id);
    assert.equal(ownerTaskNotifications.filter((item) => item.kind === 'rework').length, 1);
    assert.match(ownerTaskNotifications.find((item) => item.kind === 'rework').body, /итоговые показатели/u);

    const secondDocument = await addReportDocument(
      database, workspace.id, root, 'periodic-report-2',
      'ОТЧЁТ\nРабота выполнена полностью. Выполнение 100%. Итоговый отчёт представлен.',
      '2026-08-22T10:00:00.000Z'
    );
    const resubmitted = attachPeriodicTaskReport(database, workspace.id, task.id, {
      documentId: secondDocument, note: 'Исправленный вариант'
    }, { actorPersonId: owner.id, now: '2026-08-22T10:00:00.000Z' });
    assert.equal(resubmitted.task.status, 'submitted');
    assert.equal(resubmitted.reports.length, 2);
    assert.equal(resubmitted.reports.filter((item) => item.review_status === 'pending').length, 1);
    assert.equal(resubmitted.reports.filter((item) => item.review_status === 'returned').length, 1);

    const approved = reviewPeriodicTaskReport(database, workspace.id, task.id, {
      action: 'approve', note: 'Результат подтверждён'
    }, { actorPersonId: manager.id, now: '2026-08-23T10:00:00.000Z' });
    assert.equal(approved.task.status, 'completed');
    assert.equal(approved.task.completed_at, '2026-08-23T10:00:00.000Z');
    assert.equal(approved.reports.filter((item) => item.review_status === 'approved').length, 1);
    assert.equal(approved.reports.filter((item) => item.review_status === 'returned').length, 1);

    const calendar = database.all(`
      SELECT source_kind, status, completed_at FROM calendar_items
      WHERE source_id = ? ORDER BY source_kind
    `, task.id);
    assert.equal(calendar.find((item) => item.source_kind === 'periodic_task').status, 'completed');
    assert.equal(calendar.find((item) => item.source_kind === 'periodic_task_plan').status, 'completed');

    const planFact = listPlanFact(database, workspace.id, { ownerPersonId: owner.id, periodKey: '2026-1' }, new Date('2026-08-24T00:00:00Z'));
    const item = planFact.items.find((entry) => entry.sourceKind === 'periodic_task' && entry.id === task.id);
    assert.equal(item.progressPercent, 100);
    assert.equal(item.status, 'completed');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
