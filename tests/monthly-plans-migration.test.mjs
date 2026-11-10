import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../packages/backup/src/service.mjs';
import { persistPlan } from '../packages/plans/src/persist.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createMonthlyPlan, getMonthlyPlan, updateMonthlyPlanItem } from '../packages/plans/src/monthly.mjs';

const migrationsDir = resolve('migrations');
const newMigration = '032_monthly_plan_composition.sql';
const context = { authenticated: true, enabled: false, role: 'admin' };

function digestRows(database, tables) {
  return createHash('sha256').update(JSON.stringify(tables.map((table) => ({
    table, rows: database.all(`SELECT * FROM ${table} ORDER BY id`)
  })))).digest('hex');
}

async function migrationDirectory(root, name, { fail = false } = {}) {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  for (const file of await readdir(migrationsDir)) {
    if (!/^\d+_.*\.sql$/u.test(file) || Number.parseInt(file, 10) > 31) continue;
    await copyFile(join(migrationsDir, file), join(path, file));
  }
  if (fail) await writeFile(join(path, newMigration), `${await readFile(join(migrationsDir, newMigration), 'utf8')}\nSELECT * FROM forced_monthly_migration_failure;\n`);
  return path;
}

test('schema 31 → 32: сохранение исходников, forced rollback, repeat, backup/verify/restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-monthly-migration-'));
  let database;
  try {
    const dataDir = join(root, 'data');
    const blobDir = join(dataDir, 'blobs');
    const databasePath = join(dataDir, 'kafedra-planner.sqlite3');
    const applicationDir = join(root, 'application');
    const configPath = join(root, 'kafedra.env');
    const oldMigrations = await migrationDirectory(root, 'schema31');
    const failingMigrations = await migrationDirectory(root, 'schema32-failed', { fail: true });
    await mkdir(blobDir, { recursive: true });
    await mkdir(applicationDir, { recursive: true });
    await writeFile(join(applicationDir, 'VERSION'), '0.4.12\n');
    await writeFile(configPath, 'KAFEDRA_HOST=127.0.0.1\n');
    database = new Database(databasePath, { migrationsDir: oldMigrations });
    const workspaceId = ensureDefaultWorkspace(database).id;
    const content = 'План кафедры на 2026 год\n1. Научный семинар — 18 ноября 2026';
    const sha256 = createHash('sha256').update(content).digest('hex');
    const blobPath = join(blobDir, sha256);
    const now = '2026-11-10T12:00:00.000Z';
    await writeFile(blobPath, content);
    database.run('INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)', sha256, Buffer.byteLength(content), 'text/plain', blobPath, now);
    database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
      VALUES ('monthly-source',?,'План кафедры','department_plan','processed','monthly-version',?,?)`, workspaceId, now, now);
    database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at)
      VALUES ('monthly-version','monthly-source',1,?,'plan.txt','text/plain','text','processed',?,?)`, sha256, content, now);
    const sourcePlan = persistPlan(database, {
      workspaceId, documentVersionId: 'monthly-version', result: {
        kind: 'department', periodKind: 'calendar', periodKey: '2026', yearStart: 2026, yearEnd: 2026,
        title: 'План кафедры', confidence: 1, items: [{
          sourceItemKey: 'line:2', itemNo: '1', title: 'Научный семинар', startsAt: '2026-11-18', direction: 'science', confidence: 1,
          evidence: { locator: { kind: 'text_line', line: 2 }, sourceText: '1. Научный семинар — 18 ноября 2026' }
        }]
      }, now
    });
    const sourceTables = ['documents', 'document_versions', 'plans', 'plan_items', 'calendar_items'];
    const before = digestRows(database, sourceTables);
    database.close(); database = null;

    assert.throws(() => new Database(databasePath, { migrationsDir: failingMigrations }), /forced_monthly_migration_failure/u);
    database = new Database(databasePath, { readonly: true });
    assert.equal(database.getSchemaVersion(), 31);
    assert.equal(database.get("SELECT name FROM sqlite_master WHERE name = 'monthly_plans'"), undefined);
    assert.equal(digestRows(database, sourceTables), before);
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.foreignKeyCheck(), []);
    database.close(); database = null;

    database = new Database(databasePath, { migrationsDir });
    assert.equal(database.getSchemaVersion(), 32);
    assert.equal(digestRows(database, sourceTables), before);
    database.migrate(migrationsDir);
    assert.equal(database.getSchemaVersion(), 32);
    assert.equal(digestRows(database, sourceTables), before);
    let draft = createMonthlyPlan(database, workspaceId, { month: '2026-11', idempotencyKey: 'backup-month', planItemIds: [sourcePlan.items[0].id] }, context, now);
    draft = updateMonthlyPlanItem(database, workspaceId, draft.id, draft.items[0].id, {
      expectedRevision: draft.revision, titleOverride: 'Доклад на научном семинаре', note: 'Сохранённая правка', dateTextOverride: '18 ноября'
    }, context, now);
    database.run(`INSERT INTO monthly_plan_exports(id,workspace_id,monthly_plan_id,revision,idempotency_key,request_hash,snapshot_json,status,error_message,started_at,updated_at)
      VALUES ('failed-export',?,?,?,'failed-export-key','request-digest',?,'failed','Проверенный отказ',?,?)`,
    workspaceId, draft.id, draft.revision, JSON.stringify({ monthlyPlan: draft }), now, now);
    assert.throws(() => database.run("UPDATE monthly_plan_exports SET snapshot_json = '{}' WHERE id = 'failed-export'"), /monthly_plan_export_snapshot_immutable/u);
    assert.throws(() => database.run("UPDATE monthly_plan_exports SET request_hash = 'changed' WHERE id = 'failed-export'"), /monthly_plan_export_snapshot_immutable/u);
    database.run("UPDATE monthly_plan_exports SET snapshot_json = snapshot_json WHERE id = 'failed-export'");
    assert.throws(() => database.run("UPDATE monthly_plan_exports SET status = 'completed' WHERE id = 'failed-export'"), /CHECK constraint failed/u);
    assert.throws(() => database.run("UPDATE monthly_plan_exports SET generated_document_version_id = 'monthly-version' WHERE id = 'failed-export'"), /monthly_plan_export_document_mismatch/u);
    const monthlyTables = ['monthly_plans', 'monthly_plan_items', 'monthly_plan_exports'];
    const compositionDigest = digestRows(database, monthlyTables);
    assert.equal(digestRows(database, sourceTables), before);
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.foreignKeyCheck(), []);
    database.close(); database = null;

    const backup = await createBackup({ databasePath, dataDir, blobDir, configPath, applicationDir,
      versionPath: join(applicationDir, 'VERSION'), backupDir: join(root, 'backups'), includeApplication: true, keep: 1, reason: 'monthly-plan-migration' });
    assert.equal((await verifyBackup({ archivePath: backup.archivePath })).status, 'ok');
    const targetDataDir = join(root, 'restored');
    await restoreBackup({ archivePath: backup.archivePath, targetDataDir, targetConfigPath: join(root, 'restored.env'),
      targetApplicationDir: join(root, 'restored-app'), apply: true, force: true });
    database = new Database(join(targetDataDir, 'kafedra-planner.sqlite3'), { readonly: true });
    assert.equal(digestRows(database, monthlyTables), compositionDigest);
    assert.equal(digestRows(database, sourceTables), before);
    assert.equal(getMonthlyPlan(database, workspaceId, draft.id, context).items[0].effective.title, 'Доклад на научном семинаре');
    assert.equal(await readFile(database.get('SELECT storage_path FROM file_blobs WHERE sha256 = ?', sha256).storage_path, 'utf8'), content);
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.foreignKeyCheck(), []);
  } finally {
    database?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('чистая schema32 предотвращает межпространственные ссылки и удаление исходного мероприятия', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-monthly-integrity-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const now = new Date().toISOString();
    database.run("INSERT INTO workspaces(id,code,name,created_at) VALUES ('ws-other','other','Другой институт',?)", now);
    const source = createManualPlan(database, 'ws-other', { planKind: 'organization', periodKind: 'calendar', year: 2026 });
    const item = createManualPlanItem(database, 'ws-other', source.id, { title: 'Чужое мероприятие' });
    const draft = createMonthlyPlan(database, workspaceId, { month: '2026-11', idempotencyKey: 'cross-workspace' }, context);
    assert.throws(() => database.run(`INSERT INTO monthly_plan_items(id,monthly_plan_id,plan_item_id,position,created_at,updated_at)
      VALUES ('forbidden',?,?,0,?,?)`, draft.id, item.id, now, now), /monthly_plan_source_workspace_mismatch/u);
    const ownDraft = createMonthlyPlan(database, 'ws-other', { month: '2026-11', idempotencyKey: 'own-workspace', planItemIds: [item.id] }, context);
    assert.equal(ownDraft.items.length, 1);
    assert.throws(() => database.run(`INSERT INTO monthly_plan_exports(id,workspace_id,monthly_plan_id,revision,idempotency_key,request_hash,snapshot_json,status,started_at,updated_at)
      VALUES ('foreign-export',?,?,1,'foreign-export','hash','{}','running',?,?)`, workspaceId, ownDraft.id, now, now), /monthly_plan_export_workspace_mismatch/u);
    assert.throws(() => database.run('DELETE FROM plan_items WHERE id = ?', item.id), /FOREIGN KEY constraint failed/u);
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.foreignKeyCheck(), []);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
