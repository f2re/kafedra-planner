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

test('обновление 23 → 26 сохраняет научный реестр', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-science-report-migration-'));
  const path = join(root, 'database.sqlite3');
  const old = await migrationsThrough(root, 23);
  let database = new Database(path, { migrationsDir: old });
  let science;
  try {
    const workspace = ensureDefaultWorkspace(database);
    science = createScientificItem(database, workspace.id, {
      title: 'Материал до отчётной схемы', kind: 'article', authors: ['Автор А.А.'], publicationYear: 2025
    });
    assert.equal(database.getSchemaVersion(), 23);
  } finally {
    database.close();
  }
  database = new Database(path, { migrationsDir });
  try {
    assert.equal(database.getSchemaVersion(), 26);
    assert.equal(database.get('SELECT title FROM scientific_items WHERE id = ?', science.id).title, 'Материал до отчётной схемы');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM science_report_runs').n, 0);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
