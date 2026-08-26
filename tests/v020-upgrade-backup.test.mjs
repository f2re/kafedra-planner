import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import { createManualPlan } from '../packages/plans/src/manual.mjs';
import { createOrganizationPosition, createPersonAppointment, organizationSnapshot } from '../packages/organization/src/service.mjs';
import { updateScienceEditorial, transitionScienceLifecycle } from '../packages/science-lifecycle/src/service.mjs';
import { linkSciencePlan } from '../packages/science-lifecycle/src/plan-link.mjs';
import { collectV020DatabaseEvidence, compareAcceptanceEvidence020 } from '../packages/system/src/acceptance-020.mjs';

const migrationsDir = resolve('migrations');

async function migrationsThrough(root, maxVersion) {
  const target = join(root, `migrations-${maxVersion}`);
  await mkdir(target, { recursive: true });
  for (const name of (await readdir(migrationsDir)).filter((item) => /^\d+_.*\.sql$/u.test(item)).sort()) {
    if (Number(name.match(/^(\d+)/u)?.[1] || 0) <= maxVersion) await copyFile(join(migrationsDir, name), join(target, basename(name)));
  }
  return target;
}

function sqlLiteral(path) {
  return `'${String(path).replaceAll("'", "''")}'`;
}

test('схема 19 обновляется до 27 и восстанавливается без изменения устойчивых таблиц 0.2.0', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-v020-upgrade-'));
  const path = join(root, 'database.sqlite3');
  const restoredPath = join(root, 'restored.sqlite3');
  const oldMigrations = await migrationsThrough(root, 19);
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let actor;
  let employee;
  let plan;
  let science;
  try {
    workspace = ensureDefaultWorkspace(database);
    const legacyCreatedAt = '2025-01-01T00:00:00.000Z';
    actor = createPerson(database, workspace.id, { displayName: 'Руководитель До 0.2.0', position: 'Заведующий кафедрой' }, legacyCreatedAt);
    employee = createPerson(database, workspace.id, { displayName: 'Сотрудник До 0.2.0', position: 'Доцент', managerId: actor.id }, legacyCreatedAt);
    plan = createManualPlan(database, workspace.id, {
      title: 'План до 0.2.0', planKind: 'department', periodKind: 'calendar', yearStart: 2026
    }, actor.id);
    science = createScientificItem(database, workspace.id, {
      title: 'Научная карточка до 0.2.0', kind: 'article', authors: ['Сотрудник До 0.2.0'], publicationYear: 2025
    });
    assert.equal(database.getSchemaVersion(), 19);
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir });
  try {
    assert.equal(database.getSchemaVersion(), 27);
    const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
    const position = createOrganizationPosition(database, workspace.id, { name: 'Старший научный сотрудник' }, actor.id);
    createPersonAppointment(database, workspace.id, employee.id, {
      unitId: rootUnit.id, positionId: position.id, managerPersonId: actor.id,
      validFrom: '2026-01-01', reason: 'Уточнение кадровой истории'
    }, actor.id);
    updateScienceEditorial(database, workspace.id, science.id, {
      title: 'Уточнённая научная карточка', nextAction: 'Подготовить продолжение', nextActionDue: '2026-11-01',
      reason: 'Проверено по карточке публикации'
    }, actor.id);
    database.run("UPDATE scientific_items SET lifecycle_status = 'idea' WHERE id = ?", science.id);
    transitionScienceLifecycle(database, workspace.id, science.id, {
      status: 'drafting', eventDate: '2026-08-20', note: 'Работа продолжена'
    }, actor.id);
    linkSciencePlan(database, workspace.id, science.id, {
      planId: plan.id, title: 'Подготовить продолжение статьи', dueDate: '2026-11-01', executionMode: 'track'
    }, actor.id);
    const now = '2026-08-20T12:00:00.000Z';
    database.run(`
      INSERT INTO science_import_runs(
        id,workspace_id,source_name,idempotency_key,request_hash,status,mapping_json,options_json,
        total_rows,imported_rows,created_by_person_id,created_at,updated_at,completed_at
      ) VALUES ('import_v020',?,'legacy.csv','legacy-import','hash','completed','{"title":0}','{}',1,1,?,?,?,?)
    `, workspace.id, actor.id, now, now, now);
    database.run(`
      INSERT INTO science_import_rows(
        id,run_id,row_no,source_json,normalized_json,status,scientific_item_id,dedupe_key,created_at
      ) VALUES ('import_row_v020','import_v020',2,'["Научная карточка"]','{"title":"Научная карточка"}','imported',?,'title:science',?)
    `, science.id, now);
    database.run(`
      INSERT INTO science_report_runs(
        id,workspace_id,idempotency_key,request_hash,title,format,filters_json,fields_json,status,row_count,
        created_by_person_id,created_at,updated_at,completed_at
      ) VALUES ('report_v020',?,'report-key','report-hash','Проверочный отчёт','csv','{}','["title"]','completed',1,?,?,?,?)
    `, workspace.id, actor.id, now, now, now);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
  }

  const before = collectV020DatabaseEvidence(path);
  const sqlite = new DatabaseSync(path, { readOnly: true });
  try { sqlite.exec(`VACUUM INTO ${sqlLiteral(restoredPath)}`); } finally { sqlite.close(); }
  const after = collectV020DatabaseEvidence(restoredPath);
  const comparison = compareAcceptanceEvidence020(
    { database: { v020: before }, application: {}, acceptance: {} },
    { database: { v020: after }, application: {}, acceptance: {} }
  );
  assert.equal(comparison.status, 'equal');
  assert.equal(before.tables.person_appointments.rows >= 2, true);
  assert.equal(before.tables.scientific_item_revisions.rows, 1);
  assert.equal(before.tables.scientific_lifecycle_events.rows, 1);
  assert.equal(before.tables.science_import_runs.rows, 1);
  assert.equal(before.tables.science_import_rows.rows, 1);
  assert.equal(before.tables.science_report_runs.rows, 1);
  await rm(root, { recursive: true, force: true });
});
