import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  archiveDocument, archivePlan, documentImpact, planImpact, restoreDocument, restorePlan
} from '../packages/lifecycle/src/service.mjs';
import { CURRENT_SCHEMA_VERSION } from './helpers/current-schema.mjs';

const migrationsDir = resolve('migrations');
const now = '2026-08-25T12:00:00.000Z';

function addDocument(database, workspaceId, id, versionId, title) {
  const blob = `blob-${id}`;
  database.run(`
    INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?,100,'application/pdf',?,?)
  `, blob, `/tmp/${id}.pdf`, now);
  database.run(`
    INSERT INTO documents(
      id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at
    ) VALUES (?,?,?,'other','processed',?,?,?)
  `, id, workspaceId, title, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,
      detected_format,processing_status,uploaded_at
    ) VALUES (?,?,1,?,?,'application/pdf','pdf','processed',?)
  `, versionId, id, blob, `${title}.pdf`, now);
}

function addImportedPlan(database, workspaceId, planId, versionId, title) {
  database.run(`
    INSERT INTO plans(
      id,workspace_id,source_document_version_id,origin_kind,plan_kind,period_kind,
      period_key,year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at
    ) VALUES (?,?,?,'document','department','calendar','2026',2026,2026,?,'active',1,?,?,?)
  `, planId, workspaceId, versionId, title, JSON.stringify({ source: versionId }), now, now);
}

function addManualPlan(database, workspaceId, planId, title) {
  database.run(`
    INSERT INTO plans(
      id,workspace_id,source_document_version_id,origin_kind,plan_kind,period_kind,
      period_key,year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at
    ) VALUES (?,?,NULL,'manual','department','calendar','2027',2027,2027,?,'active',1,'{}',?,?)
  `, planId, workspaceId, title, now, now);
}

function addPlanWork(database, workspaceId, planId, itemId, assignmentId) {
  database.run(`
    INSERT INTO plan_items(
      id,plan_id,source_item_key,origin_kind,execution_mode,item_no,title,due_date,
      direction,expected_result,status,confidence,evidence_json,created_at,updated_at
    ) VALUES (?,?,'row:1','extracted','assigned','1','Подготовить отчёт','2026-10-20',
      'science','Отчёт','planned',1,?,?,?)
  `, itemId, planId, JSON.stringify({ locator: { table: 1, row: 2 } }), now, now);
  database.run(`
    INSERT INTO calendar_items(
      id,workspace_id,source_kind,source_id,item_kind,title,starts_at,ends_at,all_day,
      category,importance,status,created_at,updated_at,origin_kind,origin_id,origin_label
    ) VALUES (?,?,'plan_item',?,'task','Подготовить отчёт','2026-10-20','2026-10-20',1,
      'science','normal','open',?,?,'plan',?,'План кафедры')
  `, `cal-${itemId}`, workspaceId, itemId, now, now, planId);
  database.run(`
    INSERT INTO assignments(
      id,workspace_id,title,instruction_text,due_date,direction,priority,status,
      expected_result,report_required,confidence,evidence_json,created_at,updated_at
    ) VALUES (?,?,'Подготовить отчёт','Подготовить отчёт','2026-10-20','science','normal','open',
      'Отчёт',1,1,'{}',?,?)
  `, assignmentId, workspaceId, now, now);
  database.run(`
    INSERT INTO plan_item_assignments(
      plan_item_id,assignment_id,execution_mode,created_at,updated_at
    ) VALUES (?,?,'assigned',?,?)
  `, itemId, assignmentId, now, now);
}

test('миграция 26 → текущая схема добавляет lifecycle без изменения источников и доказательств', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-lifecycle-upgrade-'));
  const legacyDir = join(root, 'migrations-026');
  const databasePath = join(root, 'existing.sqlite3');
  await mkdir(legacyDir, { recursive: true });
  try {
    const names = (await readdir(migrationsDir))
      .filter((name) => /^\d+_.*\.sql$/u.test(name) && Number.parseInt(name, 10) <= 26)
      .sort();
    for (const name of names) await copyFile(join(migrationsDir, name), join(legacyDir, name));
    let database = new Database(databasePath, { migrationsDir: legacyDir });
    const workspace = ensureDefaultWorkspace(database);
    addDocument(database, workspace.id, 'doc-source', 'ver-source', 'Исходный план');
    addImportedPlan(database, workspace.id, 'plan-source', 'ver-source', 'План кафедры');
    addPlanWork(database, workspace.id, 'plan-source', 'item-source', 'assignment-source');
    assert.equal(database.getSchemaVersion(), 26);
    database.close();

    database = new Database(databasePath, { migrationsDir });
    try {
      assert.equal(database.getSchemaVersion(), CURRENT_SCHEMA_VERSION);
      assert.equal(database.get("SELECT lifecycle_status FROM documents WHERE id='doc-source'").lifecycle_status, 'active');
      assert.equal(database.get("SELECT status FROM plans WHERE id='plan-source'").status, 'active');
      assert.equal(database.get("SELECT source_document_version_id FROM plans WHERE id='plan-source'").source_document_version_id, 'ver-source');
      assert.match(database.get("SELECT evidence_json FROM plan_items WHERE id='item-source'").evidence_json, /table/u);
      assert.ok(database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_source_rows'"));
      assert.deepEqual(database.foreignKeyCheck(), []);
      assert.equal(database.quickCheck(), true);
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('архивирование документа и плана сохраняет пункты, календарь, поручения, evidence и blob', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-lifecycle-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addDocument(database, workspace.id, 'doc-old', 'ver-old', 'Черновой план');
    addDocument(database, workspace.id, 'doc-new', 'ver-new', 'Утверждённый план');
    addImportedPlan(database, workspace.id, 'plan-old', 'ver-old', 'План кафедры 2026');
    addManualPlan(database, workspace.id, 'plan-new', 'План кафедры 2027');
    addPlanWork(database, workspace.id, 'plan-old', 'item-old', 'assignment-old');

    const documentBefore = documentImpact(database, workspace.id, 'doc-old');
    assert.equal(documentBefore.plans, 1);
    assert.equal(documentBefore.planItems, 1);
    assert.equal(documentBefore.calendarItems, 1);
    assert.equal(documentBefore.assignments, 1);
    assert.equal(documentBefore.activeAssignments, 1);

    const archivedDocument = archiveDocument(database, workspace.id, 'doc-old', {
      replacementDocumentId: 'doc-new', reason: 'Загружена утверждённая версия'
    }, null, '2026-08-25T12:10:00.000Z');
    assert.equal(archivedDocument.lifecycle_status, 'archived');
    assert.equal(archivedDocument.replacement_document_id, 'doc-new');
    assert.equal(database.get("SELECT source_document_version_id FROM plans WHERE id='plan-old'").source_document_version_id, 'ver-old');
    assert.equal(database.get("SELECT plan_id FROM plan_items WHERE id='item-old'").plan_id, 'plan-old');
    assert.equal(database.get("SELECT source_id FROM calendar_items WHERE id='cal-item-old'").source_id, 'item-old');
    assert.equal(database.get("SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id='item-old'").assignment_id, 'assignment-old');
    assert.ok(database.get("SELECT sha256 FROM file_blobs WHERE sha256='blob-doc-old'"));

    const planBefore = planImpact(database, workspace.id, 'plan-old');
    assert.equal(planBefore.items, 1);
    assert.equal(planBefore.calendarItems, 1);
    assert.equal(planBefore.assignments, 1);
    const archivedPlan = archivePlan(database, workspace.id, 'plan-old', {
      replacementPlanId: 'plan-new', reason: 'Следующий рабочий период'
    }, null, '2026-08-25T12:11:00.000Z');
    assert.equal(archivedPlan.status, 'archived');
    assert.equal(archivedPlan.replacement_plan_id, 'plan-new');
    assert.equal(database.get("SELECT COUNT(*) AS count FROM plan_items WHERE plan_id='plan-old'").count, 1);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM assignments WHERE id='assignment-old'").count, 1);
    assert.match(database.get("SELECT evidence_json FROM plan_items WHERE id='item-old'").evidence_json, /locator/u);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM audit_log WHERE action='document.archived'").count, 1);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM audit_log WHERE action='plan.archived'").count, 1);

    const restoredPlan = restorePlan(database, workspace.id, 'plan-old', null, '2026-08-25T12:12:00.000Z');
    const restoredDocument = restoreDocument(database, workspace.id, 'doc-old', null, '2026-08-25T12:13:00.000Z');
    assert.equal(restoredPlan.status, 'active');
    assert.equal(restoredPlan.replacement_plan_id, null);
    assert.equal(restoredDocument.lifecycle_status, 'active');
    assert.equal(restoredDocument.replacement_document_id, null);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('замена защищена от ссылки на себя, другого workspace и циклов', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-lifecycle-guards-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    database.run("INSERT INTO workspaces(id,code,name,created_at) VALUES ('other-workspace','OTHER','Другая кафедра',?)", now);
    addDocument(database, workspace.id, 'doc-a', 'ver-a', 'Документ А');
    addDocument(database, workspace.id, 'doc-b', 'ver-b', 'Документ Б');
    addDocument(database, 'other-workspace', 'doc-other', 'ver-other', 'Чужой документ');
    addManualPlan(database, workspace.id, 'plan-a', 'План А');
    addManualPlan(database, workspace.id, 'plan-b', 'План Б');
    addManualPlan(database, 'other-workspace', 'plan-other', 'Чужой план');

    assert.throws(() => archiveDocument(database, workspace.id, 'doc-a', { replacementDocumentId: 'doc-a' }),
      (error) => error?.code === 'replacement_self_reference');
    assert.throws(() => archiveDocument(database, workspace.id, 'doc-a', { replacementDocumentId: 'doc-other' }),
      (error) => error?.code === 'replacement_document_not_found');
    assert.throws(() => archivePlan(database, workspace.id, 'plan-a', { replacementPlanId: 'plan-a' }),
      (error) => error?.code === 'replacement_self_reference');
    assert.throws(() => archivePlan(database, workspace.id, 'plan-a', { replacementPlanId: 'plan-other' }),
      (error) => error?.code === 'replacement_plan_not_found');

    archiveDocument(database, workspace.id, 'doc-a', { replacementDocumentId: 'doc-b' });
    database.run("UPDATE documents SET lifecycle_status='active' WHERE id='doc-a'");
    assert.throws(() => archiveDocument(database, workspace.id, 'doc-b', { replacementDocumentId: 'doc-a' }),
      (error) => error?.code === 'replacement_cycle');

    archivePlan(database, workspace.id, 'plan-a', { replacementPlanId: 'plan-b' });
    database.run("UPDATE plans SET status='active' WHERE id='plan-a'");
    assert.throws(() => archivePlan(database, workspace.id, 'plan-b', { replacementPlanId: 'plan-a' }),
      (error) => error?.code === 'replacement_cycle');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
