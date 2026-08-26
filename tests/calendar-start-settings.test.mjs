import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { listUiPreferences, recordUiPreferences } from '../packages/preferences/src/service.mjs';
import {
  calendarStartModeSettingKey,
  readCalendarStartMode,
  resolveCalendarStartMode,
  writeCalendarStartMode
} from '../packages/preferences/src/calendar-start.mjs';
import { createUiPreferencesRouter } from '../apps/api/src/ui-preferences-router.mjs';
import { CURRENT_SCHEMA_VERSION } from './helpers/current-schema.mjs';

function insertPersonAndAccount(database, workspaceId, suffix) {
  const now = '2026-08-21T04:00:00.000Z';
  const personId = `person_${suffix}`;
  const accountId = `account_${suffix}`;
  database.run(
    "INSERT INTO people(id,workspace_id,display_name,normalized_name,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)",
    personId, workspaceId, `Пользователь ${suffix}`, `пользователь ${suffix}`, now, now
  );
  database.run(`
    INSERT INTO auth_accounts(
      id,workspace_id,person_id,username,normalized_username,role,password_hash,password_changed_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,'staff','test-hash',?,?,?)
  `, accountId, workspaceId, personId, suffix, suffix, now, now, now);
  return { personId, accountId };
}

function mockResponse() {
  return {
    status: null, headers: null, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body += body; }
  };
}

function request(method, auth, value = null) {
  const bytes = value === null ? null : Buffer.from(JSON.stringify(value));
  return {
    method, auth, headers: {},
    async *[Symbol.asyncIterator]() { if (bytes) yield bytes; }
  };
}

test('явная настройка календаря отделена от learned preference и имеет приоритет', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-calendar-start-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const main = insertPersonAndAccount(database, workspace.id, 'main');
    const other = insertPersonAndAccount(database, workspace.id, 'other');

    recordUiPreferences(database, workspace.id, main.accountId, {
      interactionId: 'learned-month-1', choices: [{ key: 'calendar.mode', value: 'month' }]
    });
    recordUiPreferences(database, workspace.id, main.accountId, {
      interactionId: 'learned-month-2', choices: [{ key: 'calendar.mode', value: 'month' }]
    });

    assert.equal(readCalendarStartMode(database, workspace.id, main.accountId), 'auto');
    assert.equal(writeCalendarStartMode(database, workspace.id, main.accountId, 'week'), 'week');
    assert.equal(readCalendarStartMode(database, workspace.id, main.accountId), 'week');
    assert.equal(readCalendarStartMode(database, workspace.id, other.accountId), 'auto');

    const learned = listUiPreferences(database, workspace.id, main.accountId, ['calendar.mode']);
    assert.equal(learned['calendar.mode'][0].value, 'month');
    assert.equal(learned['calendar.mode'][0].count, 2);
    assert.equal(resolveCalendarStartMode({ setting: 'week', learned: 'month', legacy: 'tasks' }), 'week');
    assert.equal(resolveCalendarStartMode({ setting: 'auto', learned: 'month', legacy: 'tasks' }), 'month');
    assert.equal(resolveCalendarStartMode({ setting: 'auto', learned: null, legacy: 'tasks' }), 'tasks');
    assert.equal(resolveCalendarStartMode({ setting: 'auto', learned: null, legacy: 'invalid' }), 'month');

    assert.equal(
      database.get('SELECT COUNT(*) AS n FROM ui_choice_preferences WHERE context_key = ?', calendarStartModeSettingKey()).n,
      1
    );
    assert.deepEqual(listUiPreferences(database, workspace.id, main.accountId)[calendarStartModeSettingKey()], undefined);
    assert.throws(
      () => writeCalendarStartMode(database, workspace.id, main.accountId, 'agenda'),
      (error) => error?.code === 'calendar_start_mode_invalid'
    );

    const router = createUiPreferencesRouter({ database });
    const auth = { accountId: main.accountId, workspaceId: workspace.id };
    let response = mockResponse();
    await router(request('PUT', auth, { calendarStartMode: 'tasks' }), response, new URL('http://localhost/api/ui-settings/calendar-start'));
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).calendarStartMode, 'tasks');

    response = mockResponse();
    await router(request('GET', auth), response, new URL('http://localhost/api/ui-settings/calendar-start'));
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).calendarStartMode, 'tasks');

    assert.equal(database.get('SELECT MAX(version) AS v FROM schema_migrations').v, CURRENT_SCHEMA_VERSION);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
