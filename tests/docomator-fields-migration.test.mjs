import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';

const migrationsDir = resolve('migrations');

async function migrationsThrough(root, maxVersion) {
  const target = join(root, `migrations-${maxVersion}`);
  await mkdir(target, { recursive: true });
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/u.test(name)).sort();
  for (const name of files) {
    if (Number(name.match(/^(\d+)/u)?.[1] || 0) <= maxVersion) {
      await copyFile(join(migrationsDir, name), join(target, basename(name)));
    }
  }
  return target;
}

test('обновление 28 → 29 добавляет выбор полей и сохраняет существующие связи Оформлятора', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docomator-fields-migration-'));
  const path = join(root, 'database.sqlite3');
  const oldMigrations = await migrationsThrough(root, 28);
  const targetMigrations = await migrationsThrough(root, 29);
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let person;
  try {
    workspace = ensureDefaultWorkspace(database);
    person = createPerson(database, workspace.id, { displayName: 'Сотрудник до выбора полей' });
    const now = new Date().toISOString();
    database.run(`
      INSERT INTO docomator_integrations(workspace_id, scheme, host, port, last_status, created_at, updated_at)
      VALUES (?, 'http', 'docomator.local', 8080, 'ok', ?, ?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO docomator_person_links(
        workspace_id, remote_employee_id, person_id, remote_space_id,
        remote_display_name, remote_status, last_synced_at
      ) VALUES (?, 'remote-1', ?, 'space-1', 'Сотрудник до выбора полей', 'active', ?)
    `, workspace.id, person.id, now);
    assert.equal(database.getSchemaVersion(), 28);
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir: targetMigrations });
  try {
    assert.equal(database.getSchemaVersion(), 29);
    assert.equal(database.get('SELECT host FROM docomator_integrations WHERE workspace_id = ?', workspace.id).host, 'docomator.local');
    assert.equal(database.get('SELECT person_id FROM docomator_person_links WHERE workspace_id = ?', workspace.id).person_id, person.id);
    assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='docomator_field_mappings'"));
    assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='docomator_person_fields'"));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
