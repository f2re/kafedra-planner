import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createSupportingDocument } from '../packages/supporting-documents/src/service.mjs';
import {
  archiveDocument,
  archivePlan,
  documentLifecycleImpact,
  listLifecycleDocuments,
  listLifecyclePlans,
  planLifecycleImpact,
  restoreDocument,
  restorePlan,
  updateDocumentLifecycleMetadata,
  updatePlanLifecycleMetadata
} from '../packages/lifecycle/src/service.mjs';

const migrationsDir = resolve('migrations');

function addDocument(database, workspaceId, suffix, title, now = '2026-08-26T06:00:00.000Z') {
  const documentId = `doc_${suffix}`;
  const versionId = `docv_${suffix}`;
  const sha = `sha_${suffix}`;
  database.run(`
    INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?, 12, 'text/plain', ?, ?)
  `, sha, `/tmp/${sha}`, now);
  database.run(`
    INSERT INTO documents(
      id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at
    ) VALUES (?, ?, ?, 'other', 'processed', ?, ?, ?)
  `, documentId, workspaceId, title, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
      processing_status,extracted_text,uploaded_at
    ) VALUES (?, ?, 1, ?, ?, 'text/plain', 'txt', 'processed', ?, ?)
  `, versionId, documentId, sha, `${title}.txt`, title, now);
  return { documentId, versionId, sha };
}

function addImportedPlan(database, workspaceId, source, suffix, now = '2026-08-26T06:00:00.000Z') {
  const planId = `plan_import_${suffix}`;
  const itemId = `planitem_import_${suffix}`;
  database.run(`
    INSERT INTO plans(
      id,workspace_id,source_document_version_id,origin_kind,plan_kind,period_kind,period_key,
      year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at
    ) VALUES (?, ?, ?, 'document', 'department', 'calendar', '2026', 2026, 2026,
      ?, 'active', 1, '{}', ?, ?)
  `, planId, workspaceId, source.versionId, `Импортированный план ${suffix}`, now, now);
  database.run(`
    INSERT INTO plan_items(
      id,plan_id,source_item_key,origin_kind,execution_mode,item_no,title,direction,status,
      confidence,evidence_json,created_at,updated_at
    ) VALUES (?, ?, 'row:1', 'extracted', 'track', '1', ?, 'organizational', 'planned',
      1, ?, ?, ?)
  `, itemId, planId, `Пункт ${suffix}`, JSON.stringify({ documentVersionId: source.versionId }), now, now);
  database.run(`
    INSERT INTO calendar_items(
      id,workspace_id,source_kind,source_id,item_kind,title,starts_at,all_day,category,status,
      importance,origin_document_id,created_at,updated_at
    ) VALUES (?, ?, 'plan_item', ?, 'task', ?, '2026-12-20', 1, 'organizational', 'open',
      'normal', ?, ?, ?)
  `, `cal_import_${suffix}`, workspaceId, itemId, `Пункт ${suffix}`, source.documentId, now, now);
  return { planId, itemId };
}

test('документ архивируется обратимо, не перепривязывая версии, планы и календарь', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-document-lifecycle-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const otherWorkspaceId = 'workspace_other';
    database.run(
      'INSERT INTO workspaces(id,code,name,created_at) VALUES (?,?,?,?)',
      otherWorkspaceId, 'OTHER', 'Другая область', '2026-08-26T06:00:00.000Z'
    );
    const original = addDocument(database, workspace.id, 'original', 'Ошибочно загруженный документ');
    const replacement = addDocument(database, workspace.id, 'replacement', 'Исправленный документ');
    const other = addDocument(database, otherWorkspaceId, 'other', 'Чужой документ');
    const imported = addImportedPlan(database, workspace.id, original, 'original');

    const impact = documentLifecycleImpact(database, workspace.id, original.documentId);
    assert.equal(impact.counts.versions, 1);
    assert.equal(impact.counts.plans, 1);
    assert.equal(impact.counts.planItems, 1);
    assert.equal(impact.counts.calendarItems, 1);

    const renamed = updateDocumentLifecycleMetadata(database, workspace.id, original.documentId, {
      title: 'Уточнённое название', displayKind: 'basis'
    }, null, '2026-08-26T06:10:00.000Z');
    assert.equal(renamed.title, 'Уточнённое название');
    assert.equal(renamed.display_kind, 'basis');

    const archived = archiveDocument(database, workspace.id, original.documentId, {
      replacementDocumentId: replacement.documentId,
      reason: 'Загружена исправленная редакция'
    }, null, '2026-08-26T06:11:00.000Z');
    assert.equal(archived.lifecycle_state, 'archived');
    assert.equal(archived.replacement_document_id, replacement.documentId);
    assert.equal(listLifecycleDocuments(database, workspace.id, { status: 'active' })
      .some((item) => item.id === original.documentId), false);
    assert.equal(listLifecycleDocuments(database, workspace.id, { status: 'archived' })[0].replacement_title,
      'Исправленный документ');

    assert.equal(database.get('SELECT blob_sha256 FROM document_versions WHERE id = ?', original.versionId).blob_sha256, original.sha);
    assert.equal(database.get('SELECT source_document_version_id FROM plans WHERE id = ?', imported.planId).source_document_version_id, original.versionId);
    assert.equal(database.get('SELECT origin_document_id FROM calendar_items WHERE source_id = ?', imported.itemId).origin_document_id, original.documentId);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM plan_items WHERE id = ?', imported.itemId).count, 1);

    assert.throws(
      () => archiveDocument(database, workspace.id, replacement.documentId, { replacementDocumentId: replacement.documentId }),
      (error) => error?.code === 'lifecycle_replacement_self'
    );
    assert.throws(
      () => archiveDocument(database, workspace.id, replacement.documentId, { replacementDocumentId: other.documentId }),
      (error) => error?.code === 'lifecycle_replacement_not_found'
    );

    restoreDocument(database, workspace.id, original.documentId, null, '2026-08-26T06:12:00.000Z');
    database.run(
      "UPDATE documents SET lifecycle_state='active', replacement_document_id=? WHERE id=?",
      replacement.documentId, original.documentId
    );
    assert.throws(
      () => archiveDocument(database, workspace.id, replacement.documentId, { replacementDocumentId: original.documentId }),
      (error) => error?.code === 'lifecycle_replacement_cycle'
    );
    database.run('UPDATE documents SET replacement_document_id=NULL WHERE id=?', original.documentId);

    const restored = restoreDocument(database, workspace.id, original.documentId, null, '2026-08-26T06:13:00.000Z');
    assert.equal(restored.lifecycle_state, 'active');
    assert.equal(restored.replacement_document_id, null);
    assert.ok(database.get(`
      SELECT id FROM audit_log
      WHERE subject_kind='document' AND subject_id=? AND action='document.archived'
    `, original.documentId));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('архив плана сохраняет пункты, поручение, календарь, отчёты и сопроводительные связи', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-plan-lifecycle-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Руководитель Архива' });
    const executor = createPerson(database, workspace.id, {
      displayName: 'Исполнитель Архива', managerId: manager.id
    });
    const original = createManualPlan(database, workspace.id, {
      title: 'Первоначальный план', planKind: 'department', periodKind: 'calendar', yearStart: 2026,
      ownerPersonId: manager.id
    }, manager.id);
    const replacement = createManualPlan(database, workspace.id, {
      title: 'Новый утверждённый план', planKind: 'department', periodKind: 'calendar', yearStart: 2026,
      ownerPersonId: manager.id
    }, manager.id);
    const otherWorkspaceId = 'workspace_plan_other';
    database.run(
      'INSERT INTO workspaces(id,code,name,created_at) VALUES (?,?,?,?)',
      otherWorkspaceId, 'PLAN-OTHER', 'Другая область планов', '2026-08-26T07:00:00.000Z'
    );
    const otherPlanId = 'plan_other_workspace';
    database.run(`
      INSERT INTO plans(
        id,workspace_id,origin_kind,plan_kind,period_kind,period_key,year_start,year_end,
        title,status,confidence,evidence_json,created_at,updated_at
      ) VALUES (?,?,'manual','department','calendar','2026',2026,2026,?,'active',1,'{}',?,?)
    `, otherPlanId, otherWorkspaceId, 'Чужой план', '2026-08-26T07:00:00.000Z', '2026-08-26T07:00:00.000Z');

    const item = createManualPlanItem(database, workspace.id, original.id, {
      title: 'Подготовить итоговый отчёт', startsAt: '2026-09-01', dueDate: '2026-09-20',
      executionMode: 'assigned', executorPersonIds: [executor.id], responsiblePersonId: executor.id,
      controllerPersonId: manager.id, expectedResult: 'Итоговый отчёт'
    }, manager.id);
    createSupportingDocument(database, workspace.id, {
      documentNumber: 'АРХ-1', documentDate: '2026-09-19', title: 'Подтверждение',
      targetKind: 'plan_item', targetId: item.id, relationKind: 'completion'
    }, executor.id);

    const impact = planLifecycleImpact(database, workspace.id, original.id);
    assert.equal(impact.counts.planItems, 1);
    assert.equal(impact.counts.calendarItems, 2);
    assert.equal(impact.counts.assignments, 1);
    assert.equal(impact.counts.activeAssignments, 1);
    assert.equal(impact.counts.supportingDocuments, 1);

    updatePlanLifecycleMetadata(database, workspace.id, original.id, {
      title: 'Уточнённый первоначальный план', planKind: 'department'
    }, manager.id, '2026-08-26T07:10:00.000Z');
    const before = {
      items: database.get('SELECT COUNT(*) AS count FROM plan_items WHERE plan_id=?', original.id).count,
      calendar: database.get('SELECT COUNT(*) AS count FROM calendar_items WHERE source_id=?', item.id).count,
      assignmentId: database.get('SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id=?', item.id).assignment_id,
      support: database.get(`
        SELECT COUNT(*) AS count FROM supporting_document_links
        WHERE target_kind='plan_item' AND target_id=?
      `, item.id).count
    };

    const archived = archivePlan(database, workspace.id, original.id, {
      replacementPlanId: replacement.id, reason: 'Утверждён новый план'
    }, manager.id, '2026-08-26T07:11:00.000Z');
    assert.equal(archived.lifecycle_state, 'archived');
    assert.equal(archived.replacement_plan_id, replacement.id);
    assert.equal(listLifecyclePlans(database, workspace.id, { status: 'active' }).items
      .some((plan) => plan.id === original.id), false);
    const archivedList = listLifecyclePlans(database, workspace.id, { status: 'archived' }).items;
    assert.equal(archivedList.find((plan) => plan.id === original.id).replacement_title, 'Новый утверждённый план');

    assert.equal(database.get('SELECT COUNT(*) AS count FROM plan_items WHERE plan_id=?', original.id).count, before.items);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM calendar_items WHERE source_id=?', item.id).count, before.calendar);
    assert.equal(database.get('SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id=?', item.id).assignment_id, before.assignmentId);
    assert.equal(database.get(`
      SELECT COUNT(*) AS count FROM supporting_document_links
      WHERE target_kind='plan_item' AND target_id=?
    `, item.id).count, before.support);

    assert.throws(
      () => archivePlan(database, workspace.id, replacement.id, { replacementPlanId: replacement.id }),
      (error) => error?.code === 'lifecycle_replacement_self'
    );
    assert.throws(
      () => archivePlan(database, workspace.id, replacement.id, { replacementPlanId: otherPlanId }),
      (error) => error?.code === 'lifecycle_replacement_not_found'
    );

    const restored = restorePlan(database, workspace.id, original.id, manager.id, '2026-08-26T07:12:00.000Z');
    assert.equal(restored.lifecycle_state, 'active');
    assert.equal(restored.replacement_plan_id, null);
    assert.ok(database.get(`
      SELECT id FROM audit_log
      WHERE subject_kind='plan' AND subject_id=? AND action='plan.archived'
    `, original.id));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
