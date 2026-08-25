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
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/u.test(name)).sort();
  for (const name of files) {
    if (Number(name.match(/^(\d+)/u)?.[1] || 0) <= maxVersion) {
      await copyFile(join(migrationsDir, name), join(target, basename(name)));
    }
  }
  return target;
}

test('обновление 20 → 22 сохраняет научные карточки и назначает исходный этап', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-science-migration-'));
  const path = join(root, 'database.sqlite3');
  const oldMigrations = await migrationsThrough(root, 20);
  const targetMigrations = await migrationsThrough(root, 22);
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let published;
  let draft;
  try {
    workspace = ensureDefaultWorkspace(database);
    published = createScientificItem(database, workspace.id, {
      title: 'Опубликованная статья', kind: 'article', authors: ['Автор А.А.'],
      publicationYear: 2025, doi: '10.1000/published'
    });
    draft = createScientificItem(database, workspace.id, {
      title: 'Будущая статья', kind: 'article', authors: ['Автор Б.Б.']
    });
    assert.equal(database.getSchemaVersion(), 20);
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir: targetMigrations });
  try {
    assert.equal(database.getSchemaVersion(), 22);
    assert.equal(database.get('SELECT lifecycle_status FROM scientific_items WHERE id = ?', published.id).lifecycle_status, 'published');
    assert.equal(database.get('SELECT lifecycle_status FROM scientific_items WHERE id = ?', draft.id).lifecycle_status, 'idea');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM scientific_item_manual_overrides').n, 0);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
