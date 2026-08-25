import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';

const migrationsDir = resolve('migrations');

test('schema 25 обновляется до 26 без потери существующих планов', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-schema26-'));
  const oldMigrations = join(dir, 'migrations25');
  const dbPath = join(dir, 'upgrade.sqlite3');
  await mkdir(oldMigrations);
  try {
    for (const name of await readdir(migrationsDir)) {
      if (!/^\d+_.*\.sql$/.test(name) || Number.parseInt(name, 10) > 25) continue;
      await copyFile(join(migrationsDir, name), join(oldMigrations, name));
    }
    let database = new Database(dbPath, { migrationsDir: oldMigrations });
    const workspace = ensureDefaultWorkspace(database);
    database.run(`
      INSERT INTO plans(
        id,workspace_id,source_document_version_id,origin_kind,plan_kind,period_kind,period_key,
        year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at
      ) VALUES ('plan_before_26',?,NULL,'manual','department','calendar','2026',2026,2026,
        'План до обновления','active',1,'{}','2026-08-25T00:00:00Z','2026-08-25T00:00:00Z')
    `, workspace.id);
    database.close();

    database = new Database(dbPath, { migrationsDir });
    try {
      assert.equal(database.get('SELECT MAX(version) AS version FROM schema_migrations').version, 26);
      assert.equal(database.get("SELECT title FROM plans WHERE id='plan_before_26'").title, 'План до обновления');
      assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_source_rows'"));
      assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_source_row_items'"));
      assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
      assert.equal(database.quickCheck(), true);
    } finally {
      database.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
