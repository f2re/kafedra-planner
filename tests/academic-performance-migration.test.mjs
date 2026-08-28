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

test('обновление 30 → 31 добавляет учебные периоды и не изменяет существующие данные', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-academic-migration-'));
  const path = join(root, 'database.sqlite3');
  const oldMigrations = await migrationsThrough(root, 30);
  const targetMigrations = await migrationsThrough(root, 31);
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let person;
  try {
    workspace = ensureDefaultWorkspace(database);
    person = createPerson(database, workspace.id, { displayName: 'Сотрудник до миграции' });
    assert.equal(database.getSchemaVersion(), 30);
    assert.equal(database.get('SELECT display_name FROM people WHERE id = ?', person.id).display_name, 'Сотрудник до миграции');
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir: targetMigrations });
  try {
    assert.equal(database.getSchemaVersion(), 31);
    assert.equal(database.get('SELECT display_name FROM people WHERE id = ?', person.id).display_name, 'Сотрудник до миграции');
    const tables = new Set(database.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name));
    for (const name of [
      'academic_groups',
      'academic_periods',
      'academic_students',
      'academic_group_memberships',
      'academic_disciplines',
      'academic_grade_imports',
      'academic_grade_import_metadata',
      'academic_grade_import_disciplines',
      'academic_grade_import_students',
      'academic_grade_records',
      'academic_grade_import_issues'
    ]) assert.ok(tables.has(name), `${name} should exist`);
    assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_academic_grade_imports_current'"));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
