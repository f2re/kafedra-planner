#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson, normalizePersonName } from '../packages/work-management/src/service.mjs';
import {
  createAuthAccount,
  isLocalPinConfigured,
  listAuthAccounts,
  resetAuthPassword,
  updateAuthAccount
} from '../packages/auth/src/service.mjs';
import { isPinHash } from '../packages/auth/src/passwords.mjs';

const config = loadConfig();
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
try {
  const workspace = ensureDefaultWorkspace(database);
  const accounts = listAuthAccounts(database, workspace.id);
  const admin = accounts.find((item) => item.active && item.role === 'admin');
  if (admin) {
    if (config.authMode === 'accounts') {
      const stored = database.get('SELECT password_hash FROM auth_accounts WHERE id = ?', admin.id);
      if (isPinHash(stored?.password_hash)) {
        const password = `Kp-${randomBytes(18).toString('base64url')}7a`;
        resetAuthPassword(database, workspace.id, admin.id, password, { mustChangePassword: true });
        process.stdout.write(`${JSON.stringify({
          created: true,
          convertedFromPin: true,
          username: admin.username,
          password,
          mustChangePassword: true
        })}\n`);
        process.exit(0);
      }
    }
    process.stdout.write(`${JSON.stringify({
      created: false,
      username: admin.username,
      pinSetupRequired: config.authMode === 'pin' && !isLocalPinConfigured(database, workspace.id)
    })}\n`);
    process.exit(0);
  }

  const username = 'admin';
  const personName = 'Администратор системы';
  let person = database.get(
    'SELECT * FROM people WHERE workspace_id = ? AND normalized_name = ?',
    workspace.id,
    normalizePersonName(personName)
  );
  if (!person) {
    person = createPerson(database, workspace.id, {
      displayName: personName,
      position: 'Администратор системы'
    });
  }

  const password = `Kp-${randomBytes(18).toString('base64url')}7a`;
  const existing = accounts.find((item) => item.personId === person.id || item.username === username);
  if (existing) {
    updateAuthAccount(database, workspace.id, existing.id, {
      active: true,
      role: 'admin',
      mustChangePassword: config.authMode === 'accounts'
    });
    if (config.authMode === 'accounts') {
      resetAuthPassword(database, workspace.id, existing.id, password, { mustChangePassword: true });
      process.stdout.write(`${JSON.stringify({
        created: true,
        reactivated: true,
        username: existing.username,
        password,
        mustChangePassword: true
      })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({
        created: false,
        reactivated: true,
        username: existing.username,
        pinSetupRequired: true
      })}\n`);
    }
    process.exit(0);
  }

  const account = createAuthAccount(database, workspace.id, {
    personId: person.id,
    username,
    password,
    role: 'admin',
    mustChangePassword: config.authMode === 'accounts'
  });
  if (config.authMode === 'accounts') {
    process.stdout.write(`${JSON.stringify({
      created: true,
      username: account.username,
      password,
      mustChangePassword: true
    })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({
      created: false,
      accountCreated: true,
      username: account.username,
      pinSetupRequired: true
    })}\n`);
  }
} finally {
  database.close();
}
