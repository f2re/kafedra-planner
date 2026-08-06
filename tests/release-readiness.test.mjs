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
  listManagedPeople
} from '../packages/auth/src/policy.mjs';
import { authorizeCsrfRequest } from '../packages/auth/src/csrf.mjs';
import {
  listAuthSessions,
  revokeWorkspaceSessions
} from '../packages/auth/src/sessions.mjs';
import { getReleaseReadiness } from '../packages/auth/src/readiness.mjs';

const migrationsDir = resolve('migrations');
const config = {
  host: '127.0.0.1',
  authEnabled: true,
  authCsrfEnabled: true,
  authCookieName: 'kafedra_session',
  authSessionHours: 12,
  authSecureCookies: false,
  authTrustProxy: false
};

function request({ cookie = '', method = 'GET', csrf = '' } = {}) {
  return {
    method,
    headers: {
      cookie,
      'user-agent': 'node-release-test',
      ...(csrf ? { 'x-csrf-token': csrf } : {})
    },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

test('release candidate: рекурсивная иерархия, CSRF и аварийный отзыв сессий', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-release-'));
  const database = new Database(join(dir, 'release.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const director = createPerson(database, workspace.id, {
      displayName: 'Орлов Олег Олегович',
      position: 'директор'
    });
    const head = createPerson(database, workspace.id, {
      displayName: 'Петров Пётр Петрович',
      position: 'заведующий',
      managerId: director.id
    });
    const staff = createPerson(database, workspace.id, {
      displayName: 'Сидоров Сергей Сергеевич',
      position: 'доцент',
      managerId: head.id
    });
    const outsider = createPerson(database, workspace.id, {
      displayName: 'Иванов Иван Иванович',
      position: 'доцент'
    });
    const admin = createPerson(database, workspace.id, {
      displayName: 'Администратор Системы',
      position: 'администратор'
    });

    createAuthAccount(database, workspace.id, {
      personId: director.id,
      username: 'director',
      password: 'DirectorPass2026',
      role: 'manager'
    });
    createAuthAccount(database, workspace.id, {
      personId: admin.id,
      username: 'admin',
      password: 'AdminPassword2026',
      role: 'admin'
    });

    const login = authenticateAccount(
      database,
      workspace.id,
      'director',
      'DirectorPass2026',
      request(),
      config,
      new Date('2026-08-06T12:00:00.000Z')
    );
    const cookie = sessionCookie(
      config,
      login.session.token,
      login.session.expiresAt
    ).split(';', 1)[0];
    const context = resolveAuthContext(
      database,
      request({ cookie }),
      config,
      new Date('2026-08-06T12:01:00.000Z')
    );

    assert.equal(context.authenticated, true);
    assert.ok(context.csrfToken);
    assert.deepEqual(
      listManagedPeople(database, workspace.id, director.id).map((p) => p.id),
      [head.id, staff.id]
    );
    assertPersonScope(database, workspace.id, context, staff.id);
    assert.throws(
      () => assertPersonScope(database, workspace.id, context, outsider.id),
      (error) => error.code === 'person_scope_forbidden' && error.status === 403
    );

    const now = '2026-08-06T12:00:00.000Z';
    database.run(`
      INSERT INTO assignments(
        id, workspace_id, title, instruction_text, direction, priority, status,
        report_required, confidence, evidence_json, created_at, updated_at
      ) VALUES (
        'assignment-release', ?, 'Подготовить отчёт', 'Подготовить отчёт',
        'organizational', 'normal', 'open', 1, 1, '{}', ?, ?
      )
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO assignment_executors(
        assignment_id, person_id, executor_raw, role, created_at
      ) VALUES ('assignment-release', ?, ?, 'executor', ?)
    `, staff.id, staff.display_name, now);
    assertAssignmentScope(
      database,
      workspace.id,
      context,
      'assignment-release'
    );

    assert.throws(
      () => authorizeCsrfRequest(
        request({ cookie, method: 'POST' }),
        context,
        '/api/auth/logout',
        config
      ),
      (error) => error.code === 'csrf_token_invalid' && error.status === 403
    );
    authorizeCsrfRequest(
      request({ cookie, method: 'POST', csrf: context.csrfToken }),
      context,
      '/api/auth/logout',
      config
    );

    assert.equal(listAuthSessions(database, workspace.id).length, 1);
    assert.equal(
      revokeWorkspaceSessions(database, workspace.id, {
        exceptSessionId: context.sessionId
      }),
      0
    );
    assert.equal(
      getReleaseReadiness(database, workspace.id, config).status,
      'ready'
    );
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
