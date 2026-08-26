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

test('обновление 27 → 28 добавляет настройку Оформлятора без изменения сотрудников', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docomator-migration-'));
  const path = join(root, 'database.sqlite3');
  const oldMigrations = await migrationsThrough(root, 27);
  const targetMigrations = await migrationsThrough(root, 28);
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let person;
  try {
    workspace = ensureDefaultWorkspace(database);
    person = createPerson(database, workspace.id, { displayName: 'Сотрудник до интеграции' });
    assert.equal(database.getSchemaVersion(), 27);
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir: targetMigrations });
  try {
    assert.equal(database.getSchemaVersion(), 28);
    assert.equal(database.get('SELECT display_name FROM people WHERE id = ?', person.id).display_name, 'Сотрудник до интеграции');
    assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='docomator_integrations'"));
    assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='docomator_person_links'"));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
