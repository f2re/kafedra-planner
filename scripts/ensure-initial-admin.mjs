#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson, normalizePersonName } from '../packages/work-management/src/service.mjs';
import { createAuthAccount, listAuthAccounts } from '../packages/auth/src/service.mjs';

const config = loadConfig();
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
try {
  const workspace = ensureDefaultWorkspace(database);
  const accounts = listAuthAccounts(database, workspace.id);
  const admin = accounts.find((item) => item.active && item.role === 'admin');
  if (admin) {
    process.stdout.write(`${JSON.stringify({ created: false, username: admin.username })}\n`);
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
    person = createPerson(database, workspace.id, { displayName: personName, position: 'Администратор системы' });
  }
  const existing = accounts.find((item) => item.personId === person.id || item.username === username);
  if (existing) {
    process.stdout.write(`${JSON.stringify({ created: false, username: existing.username })}\n`);
    process.exit(0);
  }
  const password = `Kp-${randomBytes(18).toString('base64url')}7a`;
  const account = createAuthAccount(database, workspace.id, {
    personId: person.id,
    username,
    password,
    role: 'admin',
    mustChangePassword: true
  });
  process.stdout.write(`${JSON.stringify({ created: true, username: account.username, password, mustChangePassword: true })}\n`);
} finally {
  database.close();
}
