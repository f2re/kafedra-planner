import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  listUiPreferences,
  recordUiPreferences,
  supportedUiPreferenceKeys
} from '../packages/preferences/src/service.mjs';

const now = '2026-08-26T08:00:00.000Z';

function addPerson(database, workspaceId, id, displayName) {
  database.run(`
    INSERT INTO people(id,workspace_id,display_name,normalized_name,status,created_at,updated_at)
    VALUES(?,?,?,?, 'active',?,?)
  `, id, workspaceId, displayName, displayName.toLocaleLowerCase('ru-RU'), now, now);
}

function addAccount(database, workspaceId, personId) {
  database.run(`
    INSERT INTO auth_accounts(
      id,workspace_id,person_id,username,normalized_username,role,password_hash,
      password_changed_at,created_at,updated_at
    ) VALUES('account_manual',?,?, 'manual', 'manual', 'admin', 'test-hash',?,?,?)
  `, workspaceId, personId, now, now, now);
}

test('ручной пункт плана использует единый allowlist, относительные даты и идемпотентные явные выборы', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-manual-plan-preferences-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addPerson(database, workspace.id, 'person_executor', 'Иванов Иван Иванович');
    addPerson(database, workspace.id, 'person_controller', 'Петров Пётр Петрович');
    addAccount(database, workspace.id, 'person_controller');

    const expectedKeys = [
      'plan.item.direction',
      'plan.item.execution_mode',
      'plan.item.executor',
      'plan.item.controller',
      'plan.item.start_offset',
      'plan.item.end_offset',
      'plan.item.due_offset'
    ];
    const supported = supportedUiPreferenceKeys();
    for (const key of expectedKeys) assert.ok(supported.includes(key), key);

    const body = {
      interactionId: 'manual-item-1',
      choices: [
        { key: 'plan.item.direction', value: 'science' },
        { key: 'plan.item.execution_mode', value: 'assigned' },
        { key: 'plan.item.executor', value: 'person_executor' },
        { key: 'plan.item.controller', value: 'person_controller' },
        { key: 'plan.item.start_offset', value: 'd:2' },
        { key: 'plan.item.end_offset', value: 'none' },
        { key: 'plan.item.due_offset', value: 'd:14' }
      ]
    };
    recordUiPreferences(database, workspace.id, 'account_manual', body, now);
    recordUiPreferences(database, workspace.id, 'account_manual', body, '2026-08-26T08:01:00.000Z');

    const stored = listUiPreferences(database, workspace.id, 'account_manual', expectedKeys);
    assert.equal(stored['plan.item.direction'][0].value, 'science');
    assert.equal(stored['plan.item.execution_mode'][0].value, 'assigned');
    assert.equal(stored['plan.item.executor'][0].value, 'person_executor');
    assert.equal(stored['plan.item.controller'][0].value, 'person_controller');
    assert.equal(stored['plan.item.start_offset'][0].value, 'd:2');
    assert.equal(stored['plan.item.end_offset'][0].value, 'none');
    assert.equal(stored['plan.item.due_offset'][0].value, 'd:14');
    assert.ok(expectedKeys.every((key) => stored[key][0].count === 1));

    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_manual', {
      interactionId: 'manual-invalid-date',
      choices: [{ key: 'plan.item.start_offset', value: '2026-09-01' }]
    }), (error) => error?.code === 'ui_preference_value_invalid');
    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_manual', {
      interactionId: 'manual-invalid-person',
      choices: [{ key: 'plan.item.executor', value: 'person_missing' }]
    }), (error) => error?.code === 'ui_preference_value_invalid');
    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_manual', {
      interactionId: 'manual-invalid-mode',
      choices: [{ key: 'plan.item.execution_mode', value: 'completed' }]
    }), (error) => error?.code === 'ui_preference_value_invalid');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
