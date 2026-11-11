import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { persistPlan } from '../packages/plans/src/persist.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createMonthlyPlan, getMonthlyPlan, updateMonthlyPlan } from '../packages/plans/src/monthly.mjs';
import { createEventTemplate, defaultEventTemplateDefinition } from '../packages/plans/src/event-templates.mjs';
import { updatePlanEventDetails } from '../packages/plans/src/event-details.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../packages/backup/src/service.mjs';

const migrationsDir = resolve('migrations');
const migrationName = '033_event_templates.sql';
const context = { authenticated: true, enabled: false, role: 'admin' };
const digest = (db, tables) => createHash('sha256').update(JSON.stringify(tables.map((table) => [table, db.all(`SELECT * FROM ${table} ORDER BY 1`) ]))).digest('hex');

async function priorMigrations(root, failed = false) {
  const dir = join(root, failed ? 'failed33' : 'schema32');
  await mkdir(dir, { recursive: true });
  for (const file of await readdir(migrationsDir)) {
    if (/^\d+_.*\.sql$/u.test(file) && Number.parseInt(file, 10) <= 32) await copyFile(join(migrationsDir, file), join(dir, file));
  }
  if (failed) await writeFile(join(dir, migrationName), `${await readFile(join(migrationsDir, migrationName), 'utf8')}\nSELECT * FROM forced_event_templates_failure;\n`);
  return dir;
}

test('schema32→33: rollback, старые составы и ключи, repeat, исходники и новые таблицы в backup/restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-event-migration-'));
  let db;
  try {
    const dataDir = join(root, 'data'); const blobDir = join(dataDir, 'blobs');
    const databasePath = join(dataDir, 'kafedra-planner.sqlite3');
    const applicationDir = join(root, 'app'); const configPath = join(root, 'kafedra.env');
    await mkdir(blobDir, { recursive: true }); await mkdir(applicationDir, { recursive: true });
    await writeFile(join(applicationDir, 'VERSION'), '0.4.12\n'); await writeFile(configPath, 'KAFEDRA_HOST=127.0.0.1\n');
    db = new Database(databasePath, { migrationsDir: await priorMigrations(root) });
    const ws = ensureDefaultWorkspace(db).id;
    const now = '2026-11-11T12:00:00.000Z';
    const content = 'План кафедры на 2026 год\nНаучный семинар 18 ноября 2026, аудитория 201';
    const sha = createHash('sha256').update(content).digest('hex'); const blobPath = join(blobDir, sha);
    await writeFile(blobPath, content);
    db.run('INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)', sha, Buffer.byteLength(content), 'text/plain', blobPath, now);
    db.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
      VALUES ('event-source',?,'План кафедры','department_plan','processed','event-source-v1',?,?)`, ws, now, now);
    db.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at)
      VALUES ('event-source-v1','event-source',1,?,'plan.txt','text/plain','text','processed',?,?)`, sha, content, now);
    const plan = persistPlan(db, { workspaceId: ws, documentVersionId: 'event-source-v1', result: {
      kind: 'department', periodKind: 'calendar', periodKey: '2026', yearStart: 2026, yearEnd: 2026, title: 'План кафедры', confidence: 1,
      items: [{ sourceItemKey: 'line:2', title: 'Научный семинар', startsAt: '2026-11-18', direction: 'science', confidence: 1,
        evidence: { locator: { kind: 'text_line', line: 2 }, sourceText: content.split('\n')[1] } }]
    }, now });
    const itemId = plan.items[0].id;
    const oldInput = { month: '2026-11', title: 'Ноябрь', templateId: null, planItemIds: [itemId] };
    const oldHash = createHash('sha256').update(JSON.stringify(oldInput)).digest('hex');
    db.run(`INSERT INTO monthly_plans(id,workspace_id,month_key,title,idempotency_key,request_hash,created_at,updated_at)
      VALUES ('old-month',?,'2026-11','Ноябрь','old-create',?,?,?)`, ws, oldHash, now, now);
    db.run(`INSERT INTO monthly_plan_items(id,monthly_plan_id,plan_item_id,position,title_override,note,created_at,updated_at)
      VALUES ('old-member','old-month',?,0,'Участие в семинаре','Сохранённая правка',?,?)`, itemId, now, now);
    const sourceTables = ['documents', 'document_versions', 'plans', 'plan_items', 'calendar_items'];
    const sourceDigest = digest(db, sourceTables);
    const oldMember = db.get('SELECT * FROM monthly_plan_items WHERE id=?', 'old-member');
    db.close(); db = null;
    const failed = await priorMigrations(root, true);
    assert.throws(() => new Database(databasePath, { migrationsDir: failed }), /forced_event_templates_failure/u);
    db = new Database(databasePath, { readonly: true });
    assert.equal(db.getSchemaVersion(), 32);
    assert.equal(db.get("SELECT name FROM sqlite_master WHERE name='plan_event_templates'"), undefined);
    assert.deepEqual(db.get('SELECT * FROM monthly_plan_items WHERE id=?', 'old-member'), oldMember);
    assert.equal(digest(db, sourceTables), sourceDigest);
    assert.equal(db.quickCheck(), true); assert.deepEqual(db.foreignKeyCheck(), []);
    db.close(); db = null;

    db = new Database(databasePath, { migrationsDir });
    const currentVersion = Math.max(...(await readdir(migrationsDir)).filter((file) => /^\d+_.*\.sql$/u.test(file)).map((file) => Number.parseInt(file, 10)));
    assert.equal(db.getSchemaVersion(), currentVersion);
    assert.equal(digest(db, sourceTables), sourceDigest);
    const migratedMember = db.get('SELECT * FROM monthly_plan_items WHERE id=?', 'old-member');
    assert.deepEqual(Object.fromEntries(Object.keys(oldMember).map((key) => [key, migratedMember[key]])), { ...oldMember });
    assert.equal(migratedMember.location_override, null);
    assert.equal(migratedMember.custom_values_json, '{}');
    db.migrate(migrationsDir);
    assert.equal(db.getSchemaVersion(), currentVersion);
    assert.equal(digest(db, sourceTables), sourceDigest);
    const retry = createMonthlyPlan(db, ws, { ...oldInput, idempotencyKey: 'old-create' }, context);
    assert.equal(retry.id, 'old-month'); assert.equal(retry.duplicateRequest, true);

    const definition = defaultEventTemplateDefinition();
    definition.fields.push({ key: 'custom_count', source: 'custom', label: 'Участники', type: 'number', visible: true, required: false, width: 10 });
    const template = createEventTemplate(db, ws, { title: 'План мероприятий', definition, idempotencyKey: 'template' }, context, now);
    const draft = updateMonthlyPlan(db, ws, 'old-month', { expectedRevision: retry.revision, eventTemplateVersionId: template.currentVersionId, departmentText: 'Кафедра метеорологии' }, context, now);
    updatePlanEventDetails(db, ws, itemId, { expectedRevision: 0, location: 'Аудитория 201', templateVersionId: template.currentVersionId, customValues: { custom_count: '12' } }, context, now);
    db.run(`INSERT INTO plan_event_selection_runs(id,workspace_id,event_template_version_id,department_text,month_key,method,prompt_version,input_sha256,source_snapshot_json,result_json,created_at,idempotency_key,request_hash)
      VALUES ('selection-1',?,?,'Кафедра метеорологии','2026-11','deterministic','plan-selection-v1','test-hash',?,'{}',?,'selection-key','request-hash')`,
    ws, template.currentVersionId, JSON.stringify({ items: [{ id: itemId, sourceVersionId: 'event-source-v1' }] }), now);
    db.run(`UPDATE monthly_plan_items SET selection_run_id='selection-1',selection_evidence_json=? WHERE id='old-member'`, JSON.stringify({ method: 'operator_selected', source: 'event-source-v1' }));
    assert.throws(() => db.run("UPDATE plan_event_selection_runs SET result_json='{}' WHERE id='selection-1'"), /event_selection_immutable/u);
    assert.throws(() => db.run("UPDATE monthly_plan_items SET selection_evidence_json='{}' WHERE id='old-member'"), /monthly_event_selection_evidence_immutable/u);
    const current = getMonthlyPlan(db, ws, draft.id, context);
    assert.equal(current.items[0].effective.title, 'Участие в семинаре');
    assert.equal(current.items[0].effective.location, 'Аудитория 201');
    assert.equal(current.items[0].effective.customValues.custom_count, '12');
    assert.equal(digest(db, sourceTables), sourceDigest);
    const durable = ['plan_event_templates', 'plan_event_template_versions', 'plan_item_details', 'plan_event_selection_runs', 'monthly_plans', 'monthly_plan_items', 'monthly_plan_exports'];
    const beforeBackup = digest(db, durable);
    assert.equal(db.quickCheck(), true); assert.deepEqual(db.foreignKeyCheck(), []);
    db.close(); db = null;
    const backup = await createBackup({ databasePath, dataDir, blobDir, configPath, applicationDir, versionPath: join(applicationDir, 'VERSION'),
      backupDir: join(root, 'backups'), includeApplication: true, keep: 1, reason: 'event-template-migration' });
    assert.equal((await verifyBackup({ archivePath: backup.archivePath })).status, 'ok');
    const restored = join(root, 'restored');
    await restoreBackup({ archivePath: backup.archivePath, targetDataDir: restored, targetConfigPath: join(root, 'restored.env'), targetApplicationDir: join(root, 'restored-app'), apply: true, force: true });
    db = new Database(join(restored, 'kafedra-planner.sqlite3'), { readonly: true });
    assert.equal(digest(db, sourceTables), sourceDigest);
    assert.equal(digest(db, durable), beforeBackup);
    assert.equal(getMonthlyPlan(db, ws, 'old-month', context).items[0].effective.customValues.custom_count, '12');
    assert.equal(await readFile(db.get('SELECT storage_path FROM file_blobs WHERE sha256=?', sha).storage_path, 'utf8'), content);
    assert.equal(db.quickCheck(), true); assert.deepEqual(db.foreignKeyCheck(), []);
  } finally { db?.close(); await rm(root, { recursive: true, force: true }); }
});

test('чистая схема защищает связи шаблона, полей и серверного подбора между пространствами', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-event-integrity-'));
  const db = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const ws = ensureDefaultWorkspace(db).id; const now = new Date().toISOString();
    db.run("INSERT INTO workspaces(id,code,name,created_at) VALUES ('ws-other','other','Другое пространство',?)", now);
    const otherTemplate = createEventTemplate(db, 'ws-other', { title: 'Чужой шаблон', idempotencyKey: 'other' }, context);
    const ownTemplate = createEventTemplate(db, ws, { title: 'Свой шаблон', idempotencyKey: 'own' }, context);
    assert.throws(() => db.run('UPDATE plan_event_templates SET current_version_id=?,current_version=1 WHERE id=?', otherTemplate.currentVersionId, ownTemplate.id), /event_template_version_mismatch/u);
    assert.throws(() => db.run(`INSERT INTO plan_event_template_versions(id,template_id,workspace_id,version_no,title,definition_json,created_at,idempotency_key,request_hash)
      VALUES ('bad-version',?,?,2,'Чужая версия','{}',?,'bad','bad')`, ownTemplate.id, 'ws-other', now), /event_template_workspace_mismatch/u);
    const plan = createManualPlan(db, ws, { title: 'План', planKind: 'department', periodKind: 'calendar', year: 2026 });
    const item = createManualPlanItem(db, ws, plan.id, { title: 'Семинар' });
    assert.throws(() => db.run(`INSERT INTO plan_item_details(plan_item_id,workspace_id,location,revision,created_at,updated_at)
      VALUES (?,'ws-other','Чужое значение',1,?,?)`, item.id, now, now), /event_details_workspace_mismatch/u);
    const draft = createMonthlyPlan(db, ws, { month: '2026-11', planItemIds: [item.id], idempotencyKey: 'draft' }, context);
    assert.throws(() => db.run('UPDATE monthly_plans SET event_template_version_id=? WHERE id=?', otherTemplate.currentVersionId, draft.id), /monthly_event_template_workspace_mismatch/u);
    const runSql = `INSERT INTO plan_event_selection_runs(id,workspace_id,event_template_version_id,department_text,month_key,method,prompt_version,input_sha256,source_snapshot_json,result_json,created_at,idempotency_key,request_hash)
      VALUES (?,?,?,'Кафедра','2026-11','deterministic','v1','hash','{}','{}',?,?,?)`;
    assert.throws(() => db.run(runSql, 'bad-run', ws, otherTemplate.currentVersionId, now, 'bad-run', 'bad-run'), /event_selection_workspace_mismatch/u);
    db.run(runSql, 'other-run', 'ws-other', otherTemplate.currentVersionId, now, 'other-run', 'other-run');
    assert.throws(() => db.run("UPDATE monthly_plan_items SET selection_run_id='other-run' WHERE id=?", draft.items[0].id), /monthly_event_selection_workspace_mismatch/u);
    assert.equal(db.quickCheck(), true); assert.deepEqual(db.foreignKeyCheck(), []);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
