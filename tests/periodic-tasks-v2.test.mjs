import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import {
  createPeriodicTaskV2,
  getPeriodicTaskV2,
  updatePeriodicTaskV2
} from '../packages/work-management/src/periodic-tasks.mjs';
import { listNotifications } from '../packages/calendar/src/service.mjs';

const migrationsDir = resolve('migrations');

test('периодическая задача разделяет плановый рубеж и контрольный срок, перенос сохраняет историю', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-periodic-v2-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Смирнов Сергей Сергеевич' });
    const owner = createPerson(database, workspace.id, {
      displayName: 'Иванов Иван Иванович', managerId: manager.id
    });
    const newOwner = createPerson(database, workspace.id, {
      displayName: 'Петров Пётр Петрович', managerId: manager.id
    });

    const task = createPeriodicTaskV2(database, workspace.id, {
      ownerPersonId: owner.id,
      title: 'Семестровый отчёт по НИР',
      periodKind: 'semester', periodKey: '2026-1',
      startsAt: '2026-08-10', dueDate: '2026-08-20',
      direction: 'science', expectedResult: 'Подтверждённый отчёт'
    }, { actorPersonId: manager.id, now: '2026-08-08T12:00:00.000Z' });

    assert.equal(task.owner_person_id, owner.id);
    assert.equal(task.manager_person_id, manager.id);
    assert.equal(task.starts_at, '2026-08-10');
    assert.equal(task.due_date, '2026-08-20');

    const projections = database.all(`
      SELECT id, source_kind, starts_at, item_kind, reminder_minutes, revision
      FROM calendar_items WHERE source_id = ? ORDER BY source_kind
    `, task.id);
    assert.equal(projections.length, 2);
    const control = projections.find((item) => item.source_kind === 'periodic_task');
    const planned = projections.find((item) => item.source_kind === 'periodic_task_plan');
    assert.equal(control.starts_at, '2026-08-20');
    assert.equal(control.item_kind, 'task');
    assert.equal(control.reminder_minutes, 10080);
    assert.equal(planned.starts_at, '2026-08-10');
    assert.equal(planned.item_kind, 'event');
    assert.equal(planned.reminder_minutes, null);

    const onPlanDate = listNotifications(database, workspace.id, {
      now: new Date('2026-08-10T12:00:00Z'), limit: 100, personId: owner.id
    });
    assert.equal(onPlanDate.some((item) => item.calendarItemId === planned.id), false);

    const changed = updatePeriodicTaskV2(database, workspace.id, task.id, {
      ownerPersonId: newOwner.id,
      startsAt: '2026-08-12', dueDate: '2026-08-25',
      reason: 'Срок скорректирован руководителем'
    }, { actorPersonId: manager.id, now: '2026-08-09T10:00:00.000Z' });
    assert.equal(changed.owner_person_id, newOwner.id);
    assert.equal(changed.manager_person_id, manager.id);
    assert.equal(changed.starts_at, '2026-08-12');
    assert.equal(changed.due_date, '2026-08-25');
    assert.equal(changed.history.length, 1);
    assert.equal(changed.history[0].reason, 'Срок скорректирован руководителем');
    assert.equal(changed.history[0].before.ownerPersonId, owner.id);
    assert.equal(changed.history[0].after.ownerPersonId, newOwner.id);

    const updatedProjections = database.all(`
      SELECT id, source_kind, starts_at, revision FROM calendar_items
      WHERE source_id = ? ORDER BY source_kind
    `, task.id);
    assert.equal(updatedProjections.find((item) => item.source_kind === 'periodic_task').id, control.id);
    assert.equal(updatedProjections.find((item) => item.source_kind === 'periodic_task_plan').id, planned.id);
    assert.equal(updatedProjections.find((item) => item.source_kind === 'periodic_task').starts_at, '2026-08-25');
    assert.equal(updatedProjections.find((item) => item.source_kind === 'periodic_task_plan').starts_at, '2026-08-12');
    assert.equal(updatedProjections.every((item) => item.revision === 2), true);

    assert.equal(getPeriodicTaskV2(database, workspace.id, task.id).history.length, 1);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('задача без руководителя сохраняется и предлагает исправление вместо блокировки', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-periodic-review-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const owner = createPerson(database, workspace.id, { displayName: 'Соколов Семён Семёнович' });
    const manager = createPerson(database, workspace.id, { displayName: 'Орлов Олег Олегович' });
    const task = createPeriodicTaskV2(database, workspace.id, {
      ownerPersonId: owner.id, title: 'Годовой отчёт', periodKind: 'calendar_year',
      periodKey: '2026', dueDate: '2026-12-20'
    }, { now: '2026-08-08T12:00:00.000Z' });
    assert.equal(task.manager_person_id, null);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM review_items
      WHERE source_kind='periodic_task' AND source_id=? AND issue_code='periodic_task_manager_missing' AND status='open'
    `, task.id).n, 1);

    const fixed = updatePeriodicTaskV2(database, workspace.id, task.id, {
      managerPersonId: manager.id, reason: 'Назначен контролирующий руководитель'
    }, { actorPersonId: manager.id, now: '2026-08-08T13:00:00.000Z' });
    assert.equal(fixed.manager_person_id, manager.id);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM review_items
      WHERE source_kind='periodic_task' AND source_id=? AND issue_code='periodic_task_manager_missing' AND status='open'
    `, task.id).n, 0);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
