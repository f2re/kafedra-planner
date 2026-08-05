import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  listPersonalNotifications,
  setPersonalNotificationState
} from '../packages/plan-fact/src/notifications.mjs';

const migrationsDir = resolve('migrations');

test('разделяет персональные предупреждения исполнителя и руководителя', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-personal-notifications-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const createdAt = '2026-01-01T09:00:00.000Z';
    database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, position, created_at, updated_at)
      VALUES ('pn-manager',?,'Иванов Иван Иванович','иванов иван иванович','заведующий',?,?)`, workspace.id, createdAt, createdAt);
    database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, position, manager_id, created_at, updated_at)
      VALUES ('pn-owner',?,'Петров Пётр Петрович','петров петр петрович','доцент','pn-manager',?,?)`, workspace.id, createdAt, createdAt);
    database.run(`INSERT INTO assignments(id, workspace_id, title, instruction_text, starts_at, due_date, direction, priority, status, expected_result, report_required, confidence, evidence_json, created_at, updated_at)
      VALUES ('pn-assignment',?,'Подготовить учебные материалы','Подготовить 10 учебных материалов','2026-01-01','2026-08-08','education','high','open','Не менее 10 учебных материалов',1,1,'{}',?,?)`, workspace.id, createdAt, createdAt);
    database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES ('pn-assignment','pn-owner','Петров Пётр Петрович','executor',?)`, createdAt);
    database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES ('pn-assignment','pn-manager','Иванов Иван Иванович','controller',?)`, createdAt);
    database.run(`INSERT INTO assignment_updates(id, assignment_id, actor_person_id, status, progress_percent, note, created_at)
      VALUES ('pn-update','pn-assignment','pn-owner','open',10,'Начата подготовка','2026-08-05T08:00:00.000Z')`);
    database.run(`INSERT INTO calendar_items(id, workspace_id, source_kind, source_id, title, starts_at, category, importance, status, item_kind, revision, created_at, updated_at)
      VALUES ('pn-calendar',?,'assignment','pn-assignment','Подготовить учебные материалы','2026-08-08','education','high','open','task',1,?,?)`, workspace.id, createdAt, createdAt);

    const now = new Date('2026-08-05T12:00:00.000Z');
    const owner = listPersonalNotifications(database, workspace.id, { personId: 'pn-owner', now });
    const manager = listPersonalNotifications(database, workspace.id, { personId: 'pn-manager', now });
    const ownerRisk = owner.items.find((item) => item.kind === 'executor_risk');
    const managerRisk = manager.items.find((item) => item.kind === 'manager_risk');

    assert.ok(ownerRisk);
    assert.ok(managerRisk);
    assert.match(ownerRisk.title, /Нужно ускорить/);
    assert.match(managerRisk.title, /Риск срыва/);
    assert.equal(ownerRisk.audience.role, 'executor');
    assert.equal(managerRisk.audience.role, 'manager');

    assert.equal(setPersonalNotificationState(database, workspace.id, 'pn-manager', managerRisk.key, 'read', '2026-08-05T12:05:00.000Z'), true);
    const managerAfter = listPersonalNotifications(database, workspace.id, { personId: 'pn-manager', now });
    const ownerAfter = listPersonalNotifications(database, workspace.id, { personId: 'pn-owner', now });
    assert.equal(managerAfter.items.find((item) => item.key === managerRisk.key).read, true);
    assert.equal(ownerAfter.items.find((item) => item.key === ownerRisk.key).read, false);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
