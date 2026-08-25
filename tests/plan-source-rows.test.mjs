import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { extractPlan } from '../packages/plans/src/extractor.mjs';
import { persistPlan, getPlan, listPlanSourceRows, materializePlanSourceRow } from '../packages/plans/src/service.mjs';

const migrationsDir = resolve('migrations');
const now = '2026-08-25T08:00:00.000Z';

function addDocument(database, workspaceId) {
  database.run(
    'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    'blob_plan_source_rows', 1, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '/tmp/plan-source-rows.docx', now
  );
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES ('doc_plan_source_rows',?,'План кафедры 2026','department_plan','processed','ver_plan_source_rows',?,?)
  `, workspaceId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
      processing_status,uploaded_at
    ) VALUES ('ver_plan_source_rows','doc_plan_source_rows',1,'blob_plan_source_rows',
      'План кафедры 2026.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx','processed',?)
  `, now);
}

function block(text, row, column) {
  return {
    text,
    locator: { table: 1, row, column },
    metadata: { table: 1, row, column }
  };
}

function planBlocks() {
  return [
    block('№', 1, 1), block('Мероприятие', 1, 2), block('Основание', 1, 3),
    block('Срок проведения', 1, 4), block('Ответственный', 1, 5), block('Результат', 1, 6),
    block('1', 2, 1), block('Провести заседание кафедры', 2, 2),
    // column 3 intentionally absent: mapped fields must still use the real Word column number.
    block('15 сентября 2026', 2, 4), block('Иванов Иван Иванович', 2, 5), block('Протокол', 2, 6),
    block('2', 3, 1), block('Подготовить материалы и провести обсуждение', 3, 2),
    block('Решение учёного совета № 7', 3, 3), block('до 20 октября 2026', 3, 4),
    block('Иванов Иван Иванович', 3, 5), block('Комплект материалов', 3, 6)
  ];
}

test('строки плана сохраняют реальные колонки и одна строка идемпотентно раскладывается на несколько задач', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-source-rows-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Руководитель Кафедры' });
    const ivanov = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович', managerId: manager.id });
    const petrov = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович', managerId: manager.id });
    addDocument(database, workspace.id);

    const blocks = planBlocks();
    const text = 'ПЛАН РАБОТЫ КАФЕДРЫ\nна 2026 календарный год\n' + blocks.map((item) => item.text).join('\n');
    const extracted = extractPlan({ text, blocks, title: 'План работы кафедры 2026', requestedType: 'department_plan' });
    assert.equal(extracted.items.length, 2);
    assert.equal(extracted.items[0].startsAt, '2026-09-15');
    assert.equal(extracted.items[0].responsibleRaw, 'Иванов Иван Иванович');
    assert.equal(extracted.sourceRows.filter((row) => row.role === 'item').length, 2);
    assert.deepEqual(extracted.sourceRows.find((row) => row.rowNumber === 3).unmapped.map((cell) => cell.text), [
      'Решение учёного совета № 7'
    ]);

    const plan = persistPlan(database, {
      workspaceId: workspace.id,
      documentVersionId: 'ver_plan_source_rows',
      documentTitle: 'План работы кафедры 2026',
      result: extracted,
      now
    });
    let source = listPlanSourceRows(database, workspace.id, plan.id);
    const row = source.items.find((item) => item.rowNumber === 3);
    assert.ok(row);
    assert.equal(row.items.length, 1);

    const input = {
      tasks: [
        {
          title: 'Подготовить комплект материалов', dueDate: '2026-10-15', direction: 'education',
          responsibleRaw: ivanov.display_name, responsiblePersonId: ivanov.id,
          expectedResult: 'Комплект материалов', executionMode: 'assigned',
          executorPersonIds: [ivanov.id, petrov.id], controllerPersonId: manager.id,
          keepUnmappedInComment: true
        },
        {
          title: 'Провести обсуждение материалов', startsAt: '2026-10-20', direction: 'organizational',
          responsibleRaw: petrov.display_name, responsiblePersonId: petrov.id,
          expectedResult: 'Протокол обсуждения', executionMode: 'assigned',
          executorPersonIds: [petrov.id], controllerPersonId: manager.id,
          keepUnmappedInComment: true
        }
      ]
    };

    const first = materializePlanSourceRow(
      database, workspace.id, plan.id, row.id, input, manager.id, '2026-08-25T08:10:00.000Z'
    );
    assert.equal(first.savedItemIds.length, 2);
    assert.equal(first.retainedItemIds.length, 0);
    source = first.sourceRows;
    const materialized = source.items.find((item) => item.id === row.id);
    assert.equal(materialized.items.length, 2);

    const stored = getPlan(database, workspace.id, plan.id);
    const derived = materialized.items.map((linked) => stored.items.find((item) => item.id === linked.id));
    assert.ok(derived.every(Boolean));
    assert.ok(derived[0].description.includes('Решение учёного совета № 7'));
    assert.equal(derived[0].assignment.executors.filter((item) => ['executor','coexecutor'].includes(item.role)).length, 2);
    assert.equal(derived[1].assignment.executors.filter((item) => ['executor','coexecutor'].includes(item.role)).length, 1);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM calendar_items
      WHERE source_kind='plan_item' AND source_id IN (?,?) AND status <> 'cancelled'
    `, derived[0].id, derived[1].id).n, 2);

    const countsBefore = {
      items: database.get('SELECT COUNT(*) AS n FROM plan_items WHERE plan_id=?', plan.id).n,
      links: database.get('SELECT COUNT(*) AS n FROM plan_source_row_items WHERE source_row_id=?', row.id).n,
      assignments: database.get(`
        SELECT COUNT(*) AS n FROM plan_item_assignments
        WHERE plan_item_id IN (?,?)
      `, derived[0].id, derived[1].id).n
    };
    materializePlanSourceRow(
      database, workspace.id, plan.id, row.id, input, manager.id, '2026-08-25T08:11:00.000Z'
    );
    assert.deepEqual({
      items: database.get('SELECT COUNT(*) AS n FROM plan_items WHERE plan_id=?', plan.id).n,
      links: database.get('SELECT COUNT(*) AS n FROM plan_source_row_items WHERE source_row_id=?', row.id).n,
      assignments: database.get(`
        SELECT COUNT(*) AS n FROM plan_item_assignments
        WHERE plan_item_id IN (?,?)
      `, derived[0].id, derived[1].id).n
    }, countsBefore);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
