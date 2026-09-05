import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createPeriodicTaskV2, getPeriodicTaskV2 } from '../packages/work-management/src/periodic-tasks.mjs';
import { transitionPeriodicTaskV2 } from '../packages/work-management/src/periodic-task-completion.mjs';
import { attachPeriodicTaskReport, reviewPeriodicTaskReport } from '../packages/work-management/src/periodic-task-reports.mjs';
import { canTransitionPeriodicTask } from '../apps/api/src/periodic-task-completion-router.mjs';
import { filterNeverLearnPreferenceBody } from '../apps/api/src/ui-preferences-router.mjs';
import { listPlanFact } from '../packages/plan-fact/src/service.mjs';

const migrationsDir = resolve('migrations');

async function reportDocument(database, workspaceId, root, id, now) {
  const blobDir = join(root, 'blobs');
  await mkdir(blobDir, { recursive: true });
  const bytes = Buffer.from('ОТЧЁТ\nРабота выполнена. Выполнение 100%.');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const path = join(blobDir, sha);
  await writeFile(path, bytes);
  const versionId = `${id}-v`;
  database.run('INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES(?,?,?,?,?)',
    sha, bytes.length, 'text/plain', path, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,'Материал','report','processed',?,?,?)`, id, workspaceId, versionId, now, now);
  database.run(`INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at
    ) VALUES (?,?,1,?,'report.txt','text/plain','text','processed',?,?)`, versionId, id, sha, bytes.toString(), now);
  return id;
}

test('исполнитель завершает и возвращает периодическую задачу без файла или причины', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-periodic-completion-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Руководитель Р4' });
    const owner = createPerson(database, workspace.id, { displayName: 'Исполнитель Р4', managerId: manager.id });
    const stranger = createPerson(database, workspace.id, { displayName: 'Посторонний Р4' });
    const task = createPeriodicTaskV2(database, workspace.id, {
      ownerPersonId: owner.id,
      title: 'Периодическая задача Р4',
      periodKind: 'semester', periodKey: '2031-1',
      startsAt: '2031-09-10', dueDate: '2031-09-20', direction: 'organizational'
    }, { actorPersonId: manager.id, now: '2031-09-01T08:00:00.000Z' });

    assert.equal(canTransitionPeriodicTask(database, workspace.id, {
      enabled: true, role: 'staff', personId: owner.id
    }, task), true);
    assert.equal(canTransitionPeriodicTask(database, workspace.id, {
      enabled: true, role: 'manager', personId: manager.id
    }, task), true);
    assert.equal(canTransitionPeriodicTask(database, workspace.id, {
      enabled: true, role: 'staff', personId: stranger.id
    }, task), false);

    const completed = transitionPeriodicTaskV2(database, workspace.id, task.id, 'complete', {
      actorPersonId: owner.id, now: '2031-09-15T09:00:00.000Z'
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.completed_at, '2031-09-15T09:00:00.000Z');
    const calendar = database.all(`SELECT source_kind,status,completed_at FROM calendar_items
      WHERE workspace_id=? AND source_id=? ORDER BY source_kind`, workspace.id, task.id);
    assert.equal(calendar.find((row) => row.source_kind === 'periodic_task').status, 'completed');
    assert.equal(calendar.find((row) => row.source_kind === 'periodic_task_plan').status, 'completed');
    const planFact = listPlanFact(database, workspace.id, { ownerPersonId: owner.id, periodKey: '2031-1' }, new Date('2031-09-16T00:00:00Z'));
    const fact = planFact.items.find((item) => item.sourceKind === 'periodic_task' && item.id === task.id);
    assert.equal(fact.status, 'completed');
    assert.equal(fact.progressPercent, 100);
    assert.equal(getPeriodicTaskV2(database, workspace.id, task.id).history[0].reason, 'Выполнено');

    const documentId = await reportDocument(database, workspace.id, root, 'r4-report', '2031-09-15T10:00:00.000Z');
    const attached = attachPeriodicTaskReport(database, workspace.id, task.id, { documentId }, {
      actorPersonId: owner.id, now: '2031-09-15T10:00:00.000Z'
    });
    assert.equal(attached.task.status, 'completed');
    const reviewed = reviewPeriodicTaskReport(database, workspace.id, task.id, { action: 'return', note: 'Уточнить материал' }, {
      actorPersonId: manager.id, now: '2031-09-15T11:00:00.000Z'
    });
    assert.equal(reviewed.task.status, 'completed');
    assert.equal(reviewed.reports[0].review_status, 'returned');

    const reopened = transitionPeriodicTaskV2(database, workspace.id, task.id, 'reopen', {
      actorPersonId: owner.id, now: '2031-09-16T09:00:00.000Z'
    });
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.completed_at, null);
    assert.equal(database.get("SELECT status FROM calendar_items WHERE source_kind='periodic_task' AND source_id=?", task.id).status, 'open');
    assert.equal(database.get("SELECT status FROM calendar_items WHERE source_kind='periodic_task_plan' AND source_id=?", task.id).status, 'confirmed');
    assert.equal(getPeriodicTaskV2(database, workspace.id, task.id).history[0].reason, 'Вернуто в работу');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelled недоступен для direct completion, а статус исключён из обучения', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-periodic-cancelled-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const owner = createPerson(database, workspace.id, { displayName: 'Исполнитель отменённой' });
    const task = createPeriodicTaskV2(database, workspace.id, {
      ownerPersonId: owner.id, title: 'Отменяемая задача', periodKind: 'quarter', periodKey: '2031-Q3', dueDate: '2031-09-30'
    });
    database.run("UPDATE periodic_tasks SET status='cancelled' WHERE id=?", task.id);
    assert.throws(() => transitionPeriodicTaskV2(database, workspace.id, task.id, 'complete'), /periodic_task_transition_cancelled/u);

    const filtered = filterNeverLearnPreferenceBody({
      interactionId: 'r4-never-learn',
      choices: [
        { key: 'work.periodic.edit.status', value: 'completed' },
        { key: 'work.filter.status', value: 'completed' }
      ]
    });
    assert.deepEqual(filtered.choices, [{ key: 'work.filter.status', value: 'completed' }]);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
