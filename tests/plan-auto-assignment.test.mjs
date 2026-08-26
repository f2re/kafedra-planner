import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createPersonAppointment, organizationSnapshot } from '../packages/organization/src/service.mjs';
import { extractPlan } from '../packages/plans/src/extractor.mjs';
import { persistPlan } from '../packages/plans/src/service.mjs';

const migrationsDir = resolve('migrations');
const now = '2026-08-26T07:00:00.000Z';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-plan-auto-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, database, workspace };
}

async function closeFixture(env) {
  env.database.close();
  await rm(env.root, { recursive: true, force: true });
}

function addDocument(database, workspaceId, suffix, originalName = 'План кафедры.docx') {
  const blob = `blob_auto_${suffix}`;
  const doc = `doc_auto_${suffix}`;
  const version = `ver_auto_${suffix}`;
  database.run(
    'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    blob, 1, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `/tmp/${suffix}.docx`, now
  );
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,?,'department_plan','processed',?,?,?)
  `, doc, workspaceId, `План ${suffix}`, version, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at
    ) VALUES (?,?,1,?,?,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx','processed',?)
  `, version, doc, blob, originalName, now);
  return version;
}

function block(text, row, column) {
  return {
    text,
    locator: { table: 1, row, column },
    metadata: { table: 1, row, column }
  };
}

function extractedPlan(responsibleRaw) {
  const blocks = [
    block('№', 1, 1), block('Мероприятие', 1, 2), block('Срок проведения', 1, 3),
    block('Ответственный', 1, 4), block('Результат', 1, 5),
    block('1', 2, 1), block('Подготовить годовой отчёт кафедры', 2, 2),
    block('до 20 декабря 2026', 2, 3), block(responsibleRaw, 2, 4), block('Годовой отчёт', 2, 5)
  ];
  return extractPlan({
    text: `ПЛАН РАБОТЫ КАФЕДРЫ\nна 2026 календарный год\n${blocks.map((item) => item.text).join('\n')}`,
    blocks,
    title: 'План работы кафедры 2026',
    requestedType: 'department_plan'
  });
}

test('импортированный пункт с однозначным сотрудником автоматически создаёт одно поручение и берёт руководителя из оргструктуры', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const manager = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович' });
    const employee = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const rootUnit = organizationSnapshot(database, workspace.id, { asOf: '2026-01-01', includeInactive: true }).tree[0];
    createPersonAppointment(database, workspace.id, employee.id, {
      unitId: rootUnit.id,
      managerPersonId: manager.id,
      appointmentKind: 'primary',
      validFrom: '2025-01-01',
      reason: 'Штатное назначение'
    }, manager.id, now);

    const versionId = addDocument(database, workspace.id, 'matched');
    const result = extractedPlan('Иванов Иван Иванович');
    const plan = persistPlan(database, {
      workspaceId: workspace.id,
      documentVersionId: versionId,
      documentTitle: 'План работы кафедры 2026',
      result,
      now
    });

    assert.equal(plan.items.length, 1);
    const item = plan.items[0];
    assert.equal(item.responsible_person_id, employee.id);
    assert.equal(item.responsible_raw, 'Иванов Иван Иванович');
    assert.equal(item.execution_mode, 'assigned');
    assert.ok(item.assignment);
    assert.equal(item.assignment.directive_id, null);
    assert.equal(item.assignment.executors.find((row) => row.role === 'executor')?.person_id, employee.id);
    assert.equal(item.assignment.executors.find((row) => row.role === 'controller')?.person_id, manager.id);
    assert.equal(item.assignment.evidence.automaticAssignment.rule, 'responsible_normalized_exact');
    assert.equal(item.assignment.evidence.automaticAssignment.controllerSource, 'appointment');

    database.run("UPDATE assignments SET status='completed', completed_at=?, updated_at=? WHERE id=?", now, now, item.assignment.id);
    const repeated = persistPlan(database, {
      workspaceId: workspace.id,
      documentVersionId: versionId,
      documentTitle: 'План работы кафедры 2026',
      result,
      now: '2026-08-26T07:05:00.000Z'
    });
    assert.equal(repeated.id, plan.id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plan_item_assignments WHERE plan_item_id=?', item.id).n, 1);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM assignments WHERE id=?', item.assignment.id).n, 1);
    assert.equal(database.get('SELECT status FROM assignments WHERE id=?', item.assignment.id).status, 'completed');
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM audit_log
      WHERE subject_kind='plan_item' AND subject_id=? AND action='plan_item.assignment_auto_created'
    `, item.id).n, 1);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    await closeFixture(env);
  }
});

test('неоднозначное или отсутствующее совпадение ФИО не создаёт поручение автоматически', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const versionId = addDocument(database, workspace.id, 'unmatched');
    const result = extractedPlan('Иванов И. И. / Петров П. П.');
    const plan = persistPlan(database, {
      workspaceId: workspace.id,
      documentVersionId: versionId,
      documentTitle: 'План работы кафедры 2026',
      result,
      now
    });
    const item = plan.items[0];
    assert.equal(item.responsible_person_id, null);
    assert.equal(item.execution_mode, 'track');
    assert.equal(item.assignment, null);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM assignments').n, 0);
  } finally {
    await closeFixture(env);
  }
});
