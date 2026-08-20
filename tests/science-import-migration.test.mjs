import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';

const migrationsDir = resolve('migrations');

async function migrationsThrough(root, maxVersion) {
  const target = join(root, `migrations-${maxVersion}`);
  await mkdir(target, { recursive: true });
  for (const name of (await readdir(migrationsDir)).filter((item) => /^\d+_.*\.sql$/u.test(item)).sort()) {
    if (Number(name.match(/^(\d+)/u)?.[1] || 0) <= maxVersion) await copyFile(join(migrationsDir, name), join(target, basename(name)));
  }
  return target;
}

test('обновление 22 → 23 не изменяет научные карточки', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-science-import-migration-'));
  const path = join(root, 'database.sqlite3');
  const old = await migrationsThrough(root, 22);
  let database = new Database(path, { migrationsDir: old });
  let workspace;
  let science;
  try {
    workspace = ensureDefaultWorkspace(database);
    science = createScientificItem(database, workspace.id, {
      title: 'Карточка до журнала импорта', kind: 'article', authors: ['Автор А.А.'], publicationYear: 2025
    });
    assert.equal(database.getSchemaVersion(), 22);
  } finally {
    database.close();
  }
  database = new Database(path, { migrationsDir });
  try {
    assert.equal(database.getSchemaVersion(), 23);
    assert.equal(database.get('SELECT title FROM scientific_items WHERE id = ?', science.id).title, 'Карточка до журнала импорта');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM science_import_runs').n, 0);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM science_import_rows').n, 0);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
