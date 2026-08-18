import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { addAssignmentProgress, createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';

const migrationsDir = resolve('migrations');

test('состояние поручения синхронно обновляет пункт плана и его календарную задачу', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-plan-execution-sync-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Руководитель Кафедры' });
    const executor = createPerson(database, workspace.id, {
      displayName: 'Исполнитель Кафедры', managerId: manager.id
    });
    const plan = createManualPlan(database, workspace.id, {
      title: 'План кафедры', planKind: 'department', periodKind: 'calendar', yearStart: 2026,
      ownerPersonId: manager.id
    }, manager.id);
    const item = database.transaction(() => createManualPlanItem(database, workspace.id, plan.id, {
      title: 'Подготовить отчёт',
      dueDate: '2026-12-20',
      executionMode: 'assigned',
      executorPersonIds: [executor.id],
      controllerPersonId: manager.id
    }, manager.id));

    addAssignmentProgress(database, workspace.id, item.assignment.id, {
      actorPersonId: executor.id,
      status: 'completed',
      progressPercent: 100,
      note: 'Работа выполнена'
    }, '2026-12-19T10:00:00.000Z');
    assert.equal(database.get('SELECT status FROM plan_items WHERE id = ?', item.id).status, 'completed');
    const completedTask = database.get(`
      SELECT status, completed_at FROM calendar_items
      WHERE source_kind = 'plan_item' AND source_id = ? AND item_kind = 'task'
    `, item.id);
    assert.equal(completedTask.status, 'completed');
    assert.equal(completedTask.completed_at, '2026-12-19T10:00:00.000Z');

    addAssignmentProgress(database, workspace.id, item.assignment.id, {
      actorPersonId: manager.id,
      status: 'open',
      progressPercent: 80,
      note: 'Возвращено в работу'
    }, '2026-12-19T11:00:00.000Z');
    assert.equal(database.get('SELECT status FROM plan_items WHERE id = ?', item.id).status, 'planned');
    const reopenedTask = database.get(`
      SELECT status, completed_at FROM calendar_items
      WHERE source_kind = 'plan_item' AND source_id = ? AND item_kind = 'task'
    `, item.id);
    assert.equal(reopenedTask.status, 'open');
    assert.equal(reopenedTask.completed_at, null);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
