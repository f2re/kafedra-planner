import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { extractPlan } from '../packages/plans/src/extractor.mjs';
import { setPlanItemExecution } from '../packages/plans/src/manual.mjs';
import {
  getPlan,
  getPlanSourceRowDecisionImpact,
  listPlanSourceRows,
  materializePlanSourceRow,
  persistPlan,
  persistPlanSourceRows,
  setPlanSourceRowInclusion
} from '../packages/plans/src/service.mjs';

const migrationsDir = resolve('migrations');
const now = '2026-08-31T16:30:00.000Z';

function addDocument(database, workspaceId, suffix = 'decision') {
  const blob = `blob_${suffix}`;
  const document = `doc_${suffix}`;
  const version = `ver_${suffix}`;
  database.run(
    'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    blob, 1, 'text/plain', `/tmp/${suffix}.txt`, now
  );
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,?,'department_plan','processed',?,?,?)
  `, document, workspaceId, 'План кафедры', version, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
      processing_status,uploaded_at
    ) VALUES (?,?,1,?,'План кафедры.txt','text/plain','txt','processed',?)
  `, version, document, blob, now);
  return version;
}

function extractedPlan() {
  const blocks = [
    { text: '№', locator: { table: 1, row: 1, column: 1 }, metadata: { table: 1, row: 1, column: 1 } },
    { text: 'Мероприятие', locator: { table: 1, row: 1, column: 2 }, metadata: { table: 1, row: 1, column: 2 } },
    { text: 'Срок', locator: { table: 1, row: 1, column: 3 }, metadata: { table: 1, row: 1, column: 3 } },
    { text: '1', locator: { table: 1, row: 2, column: 1 }, metadata: { table: 1, row: 2, column: 1 } },
    { text: 'Провести заседание кафедры', locator: { table: 1, row: 2, column: 2 }, metadata: { table: 1, row: 2, column: 2 } },
    { text: '15 сентября 2026', locator: { table: 1, row: 2, column: 3 }, metadata: { table: 1, row: 2, column: 3 } }
  ];
  return extractPlan({
    text: `ПЛАН РАБОТЫ КАФЕДРЫ\nна 2026 календарный год\n${blocks.map((row) => row.text).join('\n')}`,
    blocks,
    title: 'План кафедры 2026',
    requestedType: 'department_plan'
  });
}

function createFixture(database, workspaceId, suffix = 'decision') {
  const version = addDocument(database, workspaceId, suffix);
  const result = extractedPlan();
  const plan = persistPlan(database, {
    workspaceId,
    documentVersionId: version,
    documentTitle: 'План кафедры 2026',
    result,
    now
  });
  const source = listPlanSourceRows(database, workspaceId, plan.id);
  const row = source.items.find((item) => item.role === 'item');
  assert.ok(row);
  assert.equal(row.items.length, 1);
  return { plan, row, result };
}

test('простая ошибочная строка исключается и возвращается без потери источника', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-source-decision-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const { plan, row, result } = createFixture(database, workspace.id);
    const itemId = row.items[0].id;

    const impact = getPlanSourceRowDecisionImpact(database, workspace.id, plan.id, row.id);
    assert.equal(impact.mode, 'immediate');
    assert.equal(impact.canExclude, true);

    const excluded = setPlanSourceRowInclusion(
      database,
      workspace.id,
      plan.id,
      row.id,
      { inclusionStatus: 'excluded', reason: 'Распознано как заголовок' },
      null,
      '2026-08-31T16:31:00.000Z'
    );
    assert.equal(excluded.inclusionStatus, 'excluded');
    assert.equal(database.get('SELECT inclusion_status FROM plan_source_rows WHERE id = ?', row.id).inclusion_status, 'excluded');
    assert.equal(database.get('SELECT status FROM plan_items WHERE id = ?', itemId).status, 'cancelled');
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM calendar_items
      WHERE source_kind = 'plan_item' AND source_id = ? AND status <> 'cancelled'
    `, itemId).n, 0);
    assert.equal(getPlan(database, workspace.id, plan.id).items.some((item) => item.id === itemId), false);
    assert.equal(database.get(
      'SELECT COUNT(*) AS n FROM plan_source_row_decisions WHERE source_row_id = ?', row.id
    ).n, 1);

    const repeated = setPlanSourceRowInclusion(
      database,
      workspace.id,
      plan.id,
      row.id,
      { inclusionStatus: 'excluded' },
      null,
      '2026-08-31T16:32:00.000Z'
    );
    assert.equal(repeated.idempotent, true);
    assert.equal(database.get(
      'SELECT COUNT(*) AS n FROM plan_source_row_decisions WHERE source_row_id = ?', row.id
    ).n, 1);

    persistPlanSourceRows(database, plan.id, result.sourceRows, '2026-08-31T16:33:00.000Z');
    assert.equal(database.get('SELECT inclusion_status FROM plan_source_rows WHERE id = ?', row.id).inclusion_status, 'excluded');
    assert.throws(
      () => materializePlanSourceRow(database, workspace.id, plan.id, row.id, {
        tasks: [{ title: 'Не должно сохраниться' }]
      }),
      (error) => error?.code === 'plan_source_row_excluded'
    );

    const restored = setPlanSourceRowInclusion(
      database,
      workspace.id,
      plan.id,
      row.id,
      { inclusionStatus: 'included', reason: 'Проверено оператором' },
      null,
      '2026-08-31T16:34:00.000Z'
    );
    assert.equal(restored.inclusionStatus, 'included');
    assert.equal(database.get('SELECT status FROM plan_items WHERE id = ?', itemId).status, 'planned');
    assert.equal(getPlan(database, workspace.id, plan.id).items.some((item) => item.id === itemId), true);
    assert.equal(database.get(
      'SELECT COUNT(*) AS n FROM plan_source_row_decisions WHERE source_row_id = ?', row.id
    ).n, 2);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('активное автоматическое поручение требует явного подтверждения', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-source-confirm-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const person = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const { plan, row } = createFixture(database, workspace.id, 'confirm');
    const itemId = row.items[0].id;
    setPlanItemExecution(database, workspace.id, itemId, {
      executionMode: 'assigned',
      executorPersonIds: [person.id],
      responsiblePersonId: person.id
    }, null, '2026-08-31T16:35:00.000Z');

    const impact = getPlanSourceRowDecisionImpact(database, workspace.id, plan.id, row.id);
    assert.equal(impact.mode, 'confirm');
    assert.equal(impact.summary.activeAssignments, 1);

    assert.throws(
      () => setPlanSourceRowInclusion(
        database, workspace.id, plan.id, row.id, { inclusionStatus: 'excluded' }, null,
        '2026-08-31T16:36:00.000Z'
      ),
      (error) => error?.code === 'plan_source_row_decision_confirmation_required'
        && error.details?.impact?.summary?.activeAssignments === 1
    );

    setPlanSourceRowInclusion(
      database,
      workspace.id,
      plan.id,
      row.id,
      { inclusionStatus: 'excluded', confirmImpact: true },
      null,
      '2026-08-31T16:37:00.000Z'
    );
    const assignment = database.get(`
      SELECT a.* FROM assignments a
      JOIN plan_item_assignments pia ON pia.assignment_id = a.id
      WHERE pia.plan_item_id = ?
    `, itemId);
    assert.equal(assignment.status, 'cancelled');

    setPlanSourceRowInclusion(
      database,
      workspace.id,
      plan.id,
      row.id,
      { inclusionStatus: 'included' },
      null,
      '2026-08-31T16:38:00.000Z'
    );
    assert.equal(database.get('SELECT status FROM assignments WHERE id = ?', assignment.id).status, 'open');
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('выполненная или вручную исправленная работа блокирует автоматическое исключение', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-source-blocked-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const { plan, row } = createFixture(database, workspace.id, 'blocked');
    const itemId = row.items[0].id;
    database.run(
      "UPDATE plan_items SET status = 'completed', updated_at = ? WHERE id = ?",
      '2026-08-31T16:39:00.000Z',
      itemId
    );
    const impact = getPlanSourceRowDecisionImpact(database, workspace.id, plan.id, row.id);
    assert.equal(impact.mode, 'blocked');
    assert.equal(impact.canExclude, false);
    assert.throws(
      () => setPlanSourceRowInclusion(
        database,
        workspace.id,
        plan.id,
        row.id,
        { inclusionStatus: 'excluded', confirmImpact: true },
        null,
        '2026-08-31T16:40:00.000Z'
      ),
      (error) => error?.code === 'plan_source_row_decision_blocked'
    );
    assert.equal(database.get('SELECT inclusion_status FROM plan_source_rows WHERE id = ?', row.id).inclusion_status, 'included');
    assert.equal(database.get(
      'SELECT COUNT(*) AS n FROM plan_source_row_decisions WHERE source_row_id = ?', row.id
    ).n, 0);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
