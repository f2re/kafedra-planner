import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import {
  authenticateAccount,
  createAuthAccount,
  resolveAuthContext,
  sessionCookie
} from '../packages/auth/src/service.mjs';
import {
  assertAssignmentScope,
  assertPersonScope,
  requireAssignmentCorrection
} from '../packages/auth/src/policy.mjs';

const migrationsDir = resolve('migrations');
const config = {
  authEnabled: true,
  authCookieName: 'kafedra_session',
  authSessionHours: 12,
  authSecureCookies: false,
  authTrustProxy: false
};

function request(cookie = '') {
  return {
    headers: { cookie, 'user-agent': 'node-test' },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

test('локальные сессии привязывают запрос к сотруднику и ограничивают чужие данные', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-auth-'));
  const database = new Database(join(dir, 'auth.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, {
      displayName: 'Петров Пётр Петрович',
      position: 'заведующий'
    });
    const staff = createPerson(database, workspace.id, {
      displayName: 'Сидоров Сергей Сергеевич',
      position: 'доцент',
      managerId: manager.id
    });
    const outsider = createPerson(database, workspace.id, {
      displayName: 'Иванов Иван Иванович',
      position: 'доцент'
    });
    createAuthAccount(database, workspace.id, {
      personId: manager.id,
      username: 'manager',
      password: 'ManagerPass2026',
      role: 'manager'
    });
    createAuthAccount(database, workspace.id, {
      personId: staff.id,
      username: 'staff',
      password: 'StaffPassword2026',
      role: 'staff'
    });

    const login = authenticateAccount(
      database,
      workspace.id,
      'staff',
      'StaffPassword2026',
      request(),
      config,
      new Date('2026-08-06T08:00:00.000Z')
    );
    const cookie = sessionCookie(config, login.session.token, login.session.expiresAt).split(';', 1)[0];
    const context = resolveAuthContext(database, request(cookie), config, new Date('2026-08-06T08:01:00.000Z'));
    assert.equal(context.authenticated, true);
    assert.equal(context.personId, staff.id);
    assert.equal(context.role, 'staff');
    assert.equal(context.workspaceId, workspace.id);
    assertPersonScope(database, workspace.id, context, staff.id);
    assert.throws(
      () => assertPersonScope(database, workspace.id, context, outsider.id),
      (error) => error.code === 'person_scope_forbidden' && error.status === 403
    );

    const now = '2026-08-06T08:00:00.000Z';
    database.run(`
      INSERT INTO assignments(
        id, workspace_id, title, instruction_text, direction, priority, status,
        report_required, confidence, evidence_json, created_at, updated_at
      ) VALUES ('assignment-auth', ?, 'Подготовить отчёт', 'Подготовить отчёт',
        'organizational', 'normal', 'open', 1, 1, '{}', ?, ?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES ('assignment-auth', ?, ?, 'executor', ?)
    `, staff.id, staff.display_name, now);
    assertAssignmentScope(database, workspace.id, context, 'assignment-auth');
    assert.throws(
      () => requireAssignmentCorrection(database, workspace.id, context, 'assignment-auth'),
      (error) => error.code === 'forbidden' && error.status === 403
    );

    const managerLogin = authenticateAccount(
      database,
      workspace.id,
      'manager',
      'ManagerPass2026',
      request(),
      config,
      new Date('2026-08-06T08:02:00.000Z')
    );
    const managerCookie = sessionCookie(config, managerLogin.session.token, managerLogin.session.expiresAt).split(';', 1)[0];
    const managerContext = resolveAuthContext(database, request(managerCookie), config, new Date('2026-08-06T08:03:00.000Z'));
    assertPersonScope(database, workspace.id, managerContext, staff.id);
    assertAssignmentScope(database, workspace.id, managerContext, 'assignment-auth');
    requireAssignmentCorrection(database, workspace.id, managerContext, 'assignment-auth');
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
