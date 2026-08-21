import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson, attachAssignmentReport } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import { listPlanFact } from '../packages/plan-fact/src/service.mjs';
import { search } from '../packages/storage/src/search.mjs';
import { claimOpenPlanItem, createManualPlan, createManualPlanItem, setPlanItemExecution } from '../packages/plans/src/manual.mjs';
import { getPlan } from '../packages/plans/src/service.mjs';
import { resolvePlanAccess } from '../packages/plans/src/access.mjs';
import { createSupportingDocument, deleteSupportingDocument, listSupportingDocuments } from '../packages/supporting-documents/src/service.mjs';

const migrationsDir = resolve('migrations');

function addDocument(database, workspaceId, id, versionId, originalName, {
  mediaType = 'application/pdf', detectedFormat = 'pdf', extractedText = null, now = '2026-08-17T09:00:00.000Z'
} = {}) {
  const blob = `blob_${id}`;
  database.run('INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)', blob, 1, mediaType, `/tmp/${id}`, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES (?,?,?,'other','processed',?,?,?)`, id, workspaceId, originalName.replace(/\.[^.]+$/, ''), versionId, now, now);
  database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at) VALUES (?,?,1,?,?,?,?, 'processed', ?, ?)`, versionId, id, blob, originalName, mediaType, detectedFormat, extractedText, now);
  return { id, versionId };
}

test('schema 20 обновляет существующий план без потери источника и разрешает ручные планы', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-schema20-'));
  const oldMigrations = join(dir, 'migrations18');
  const dbPath = join(dir, 'upgrade.sqlite3');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(oldMigrations);
  try {
    for (const name of await readdir(migrationsDir)) {
      if (!/^\d+_.*\.sql$/.test(name) || Number.parseInt(name, 10) > 18) continue;
      await copyFile(join(migrationsDir, name), join(oldMigrations, name));
    }
    let database = new Database(dbPath, { migrationsDir: oldMigrations });
    const workspace = ensureDefaultWorkspace(database);
    addDocument(database, workspace.id, 'doc_old_plan', 'ver_old_plan', 'old-plan.txt', { mediaType: 'text/plain', detectedFormat: 'text' });
    database.run(`INSERT INTO plans(id,workspace_id,source_document_version_id,plan_kind,period_kind,period_key,year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at) VALUES ('plan_old',?,'ver_old_plan','department','calendar','2026',2026,2026,'Существующий план','active',1,'{}','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`, workspace.id);
    database.run(`INSERT INTO plan_items(id,plan_id,source_item_key,item_no,title,direction,status,confidence,evidence_json,created_at,updated_at) VALUES ('item_old','plan_old','row:1','1','Существующий пункт','organizational','planned',1,'{}','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`);
    database.close();
    database = new Database(dbPath, { migrationsDir });
    try {
      assert.equal(database.get('SELECT MAX(version) AS version FROM schema_migrations').version, 20);
      const plan = database.get("SELECT * FROM plans WHERE id='plan_old'");
      const item = database.get("SELECT * FROM plan_items WHERE id='item_old'");
      assert.equal(plan.source_document_version_id, 'ver_old_plan');
      assert.equal(plan.origin_kind, 'document');
      assert.equal(item.origin_kind, 'extracted');
      assert.equal(item.execution_mode, 'track');
      assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
      assert.equal(database.quickCheck(), true);
    } finally { database.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ручной план замыкает календарь, поручение, self-claim, отчёт и сопроводительные документы', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-manual-plan-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  const now = '2026-08-17T09:00:00.000Z';
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Руководитель Кафедры' });
    const executor = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович', managerId: manager.id });
    const volunteer = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович', managerId: manager.id });
    const plan = createManualPlan(database, workspace.id, { title: 'План кафедры 2026', planKind: 'department', periodKind: 'calendar', yearStart: 2026, ownerPersonId: manager.id }, manager.id, now);
    assert.equal(plan.origin_kind, 'manual');
    assert.equal(plan.source_document_version_id, null);
    assert.equal(database.get("SELECT access_scope FROM object_access_policies WHERE object_kind='plan' AND object_id=?", plan.id).access_scope, 'workspace');
    const personal = createManualPlan(database, workspace.id, { title: 'Личный план', planKind: 'personal', periodKind: 'calendar', yearStart: 2026, ownerPersonId: manager.id }, manager.id, now);
    const staffContext = { enabled: true, authenticated: true, role: 'staff', personId: executor.id };
    assert.equal(resolvePlanAccess(database, workspace.id, staffContext, personal.id, 'read').allowed, false);
    const tracked = createManualPlanItem(database, workspace.id, plan.id, { title: 'Заседание кафедры', startsAt: '2026-09-15', direction: 'organizational', executionMode: 'track', expectedResult: 'Протокол' }, manager.id, now);
    assert.equal(tracked.assignment, null);
    const trackedCalendar = database.get("SELECT * FROM calendar_items WHERE source_kind='plan_item' AND source_id=?", tracked.id);
    assert.equal(trackedCalendar.origin_document_id, null);
    assert.equal(trackedCalendar.starts_at, '2026-09-15');
    const assigned = database.transaction(() => createManualPlanItem(database, workspace.id, plan.id, { title: 'Подготовить отчёт', dueDate: '2026-10-20', direction: 'science', executionMode: 'assigned', executorPersonIds: [executor.id], responsiblePersonId: executor.id, controllerPersonId: manager.id, expectedResult: 'Отчёт 100%' }, manager.id, now));
    assert.ok(assigned.assignment?.id);
    const assignmentId = assigned.assignment.id;
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plan_item_assignments WHERE plan_item_id=?', assigned.id).n, 1);
    setPlanItemExecution(database, workspace.id, assigned.id, { executionMode: 'assigned', executorPersonIds: [executor.id], controllerPersonId: manager.id }, manager.id, '2026-08-17T09:01:00.000Z');
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plan_item_assignments WHERE plan_item_id=?', assigned.id).n, 1);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM assignments WHERE id=?', assignmentId).n, 1);
    const open = database.transaction(() => createManualPlanItem(database, workspace.id, plan.id, { title: 'Подготовить выставку', dueDate: '2026-11-10', direction: 'organizational', executionMode: 'open', controllerPersonId: manager.id }, manager.id, now));
    assert.equal(open.assignment.claimed_by_person_id, null);
    const claimed = claimOpenPlanItem(database, workspace.id, open.id, volunteer.id, '2026-08-17T09:02:00.000Z');
    assert.equal(claimed.assignment.claimed_by_person_id, volunteer.id);
    const claimedAgain = claimOpenPlanItem(database, workspace.id, open.id, volunteer.id, '2026-08-17T09:03:00.000Z');
    assert.equal(claimedAgain.assignment.claimed_by_person_id, volunteer.id);
    assert.equal(database.get(`SELECT COUNT(*) AS n FROM assignment_executors WHERE assignment_id=? AND person_id=? AND role='executor'`, open.assignment.id, volunteer.id).n, 1);
    const planFact = listPlanFact(database, workspace.id, { limit: 100 }, new Date('2026-08-18T00:00:00Z'));
    assert.ok(planFact.items.some((item) => item.id === assignmentId));
    assert.ok(planFact.items.some((item) => item.id === open.assignment.id));
    addDocument(database, workspace.id, 'doc_report', 'ver_report', 'report.pdf', { extractedText: 'ОТЧЁТ\nПодготовить отчёт выполнено на 100 процентов.' });
    const submitted = attachAssignmentReport(database, workspace.id, assignmentId, { documentId: 'doc_report', actorPersonId: executor.id, note: 'Итоговый отчёт' }, '2026-10-19T12:00:00.000Z');
    assert.equal(submitted.status, 'submitted');
    assert.ok(listPlanFact(database, workspace.id, { limit: 100 }, new Date('2026-10-19T13:00:00Z')).items.some((item) => item.id === assignmentId && item.status === 'submitted'));
    const requisitesOnly = createSupportingDocument(database, workspace.id, { documentNumber: '12-03/26', documentDate: '2026-10-19', title: 'Подтверждение выполнения', targetKind: 'plan_item', targetId: assigned.id, relationKind: 'completion' }, executor.id, '2026-10-19T12:05:00.000Z');
    assert.equal(requisitesOnly.document_version_id, null);
    assert.equal(listSupportingDocuments(database, workspace.id, { targetKind: 'plan_item', targetId: assigned.id }).length, 1);
    const science = createScientificItem(database, workspace.id, { title: 'Статья по результатам работы', kind: 'article', authors: ['Иванов Иван Иванович'], publicationYear: 2026 }, '2026-10-19T12:10:00.000Z');
    const fileSupport = createSupportingDocument(database, workspace.id, { documentNumber: 'PUB-2026-7', documentDate: '2026-10-18', title: 'Справка о публикации', documentVersionId: 'ver_report', targetKind: 'scientific_item', targetId: science.id, relationKind: 'publication' }, executor.id, '2026-10-19T12:11:00.000Z');
    assert.equal(fileSupport.document_version_id, 'ver_report');
    deleteSupportingDocument(database, workspace.id, fileSupport.id, executor.id, '2026-10-19T12:12:00.000Z');
    assert.ok(database.get("SELECT id FROM document_versions WHERE id='ver_report'"));
    assert.ok(database.get("SELECT id FROM documents WHERE id='doc_report'"));
    assert.equal(database.get('SELECT status FROM supporting_documents WHERE id=?', fileSupport.id).status, 'deleted');
    const stored = getPlan(database, workspace.id, plan.id);
    assert.equal(stored.items.length, 3);
    assert.ok(stored.items.find((item) => item.id === assigned.id).supporting_documents.length === 1);
    const found = search(database, workspace.id, 'Подготовить отчёт', 50);
    assert.ok(found.some((item) => item.source_kind === 'plan_item' && item.source_id === assigned.id));
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
