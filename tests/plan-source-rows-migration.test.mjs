import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { CURRENT_SCHEMA_VERSION } from './helpers/current-schema.mjs';

const migrationsDir = resolve('migrations');

test('schema 25 обновляется через 26 и 32 до текущей схемы без потери существующих планов', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-schema-current-'));
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
      assert.equal(database.get('SELECT MAX(version) AS version FROM schema_migrations').version, CURRENT_SCHEMA_VERSION);
      assert.equal(database.get("SELECT title FROM plans WHERE id='plan_before_26'").title, 'План до обновления');
      assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_source_rows'"));
      assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_source_row_items'"));
      assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_source_row_decisions'"));
      const columns = new Set(database.all('PRAGMA table_info(plan_source_rows)').map((row) => row.name));
      for (const name of [
        'inclusion_status',
        'inclusion_decided_by_person_id',
        'inclusion_decided_at',
        'inclusion_reason',
        'exclusion_snapshot_json'
      ]) assert.equal(columns.has(name), true, `missing ${name}`);
      assert.equal(database.get("SELECT lifecycle_status FROM documents LIMIT 1")?.lifecycle_status ?? 'active', 'active');
      assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
      assert.equal(database.quickCheck(), true);
    } finally {
      database.close();
    }

    database = new Database(dbPath, { migrationsDir });
    try {
      assert.equal(database.get('SELECT MAX(version) AS version FROM schema_migrations').version, CURRENT_SCHEMA_VERSION);
      assert.equal(database.get(
        'SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 32'
      ).n, 1);
      assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
      assert.equal(database.quickCheck(), true);
    } finally {
      database.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
