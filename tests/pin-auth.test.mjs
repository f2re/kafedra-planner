import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import {
  authenticatePin,
  changeOwnPin,
  configureLocalPin,
  createAuthAccount,
  isLocalPinConfigured,
  resetLocalPin,
  resolveAuthContext,
  sessionCookie
} from '../packages/auth/src/service.mjs';
import { isPinHash } from '../packages/auth/src/passwords.mjs';

const migrationsDir = resolve('migrations');
const config = {
  authEnabled: true,
  authMode: 'pin',
  authCookieName: 'kafedra_session',
  authSessionHours: 12,
  authSecureCookies: false,
  authTrustProxy: false
};

function request(cookie = '') {
  return {
    headers: { cookie, 'user-agent': 'pin-node-test' },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

test('первый запуск задаёт PIN, вход работает без логина, смена и root-reset инвалидируют сессии', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-pin-auth-'));
  const database = new Database(join(dir, 'pin.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const admin = createPerson(database, workspace.id, {
      displayName: 'Администратор системы',
      position: 'Администратор системы'
    });
    const account = createAuthAccount(database, workspace.id, {
      personId: admin.id,
      username: 'admin',
      password: 'TemporaryAdmin2026',
      role: 'admin'
    });
    assert.equal(isLocalPinConfigured(database, workspace.id), false);
    assert.throws(
      () => configureLocalPin(database, workspace.id, '12a4', request(), config),
      (error) => error.code === 'pin_invalid' && error.status === 400
    );

    const configured = configureLocalPin(
      database,
      workspace.id,
      '4826',
      request(),
      config,
      new Date('2026-08-21T10:00:00.000Z')
    );
    assert.equal(configured.account.id, account.id);
    assert.equal(isLocalPinConfigured(database, workspace.id), true);
    assert.equal(isPinHash(database.get('SELECT password_hash FROM auth_accounts WHERE id = ?', account.id).password_hash), true);
    assert.throws(
      () => configureLocalPin(database, workspace.id, '1111', request(), config),
      (error) => error.code === 'pin_already_configured' && error.status === 409
    );

    const login = authenticatePin(
      database,
      workspace.id,
      '4826',
      request(),
      config,
      new Date('2026-08-21T10:01:00.000Z')
    );
    const cookie = sessionCookie(config, login.session.token, login.session.expiresAt).split(';', 1)[0];
    const context = resolveAuthContext(
      database,
      request(cookie),
      config,
      new Date('2026-08-21T10:02:00.000Z')
    );
    assert.equal(context.authenticated, true);
    assert.equal(context.role, 'admin');

    changeOwnPin(database, context, '4826', '1357', '2026-08-21T10:03:00.000Z');
    assert.throws(
      () => authenticatePin(database, workspace.id, '4826', request(), config, new Date('2026-08-21T10:04:00.000Z')),
      (error) => error.code === 'invalid_pin' && error.status === 401
    );
    assert.equal(
      authenticatePin(database, workspace.id, '1357', request(), config, new Date('2026-08-21T10:05:00.000Z')).account.id,
      account.id
    );

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      assert.throws(
        () => authenticatePin(database, workspace.id, '0000', request(), config, new Date(`2026-08-21T10:0${5 + attempt}:00.000Z`)),
        (error) => error.code === 'invalid_pin' && error.status === 401
      );
    }
    assert.throws(
      () => authenticatePin(database, workspace.id, '0000', request(), config, new Date('2026-08-21T10:10:00.000Z')),
      (error) => error.code === 'account_locked' && error.status === 429
    );
    assert.throws(
      () => authenticatePin(database, workspace.id, '1357', request(), config, new Date('2026-08-21T10:11:00.000Z')),
      (error) => error.code === 'account_locked' && error.status === 429
    );

    resetLocalPin(database, workspace.id, '2468', '2026-08-21T10:12:00.000Z');
    assert.equal(
      authenticatePin(database, workspace.id, '2468', request(), config, new Date('2026-08-21T10:13:00.000Z')).account.id,
      account.id
    );
    const activeOldSession = database.get(
      'SELECT revoked_at FROM auth_sessions WHERE id = ?',
      login.session.id
    );
    assert.ok(activeOldSession.revoked_at);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
