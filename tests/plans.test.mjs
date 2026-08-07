import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { extractPlan, looksLikePlan, parsePlanDateWindow } from '../packages/plans/src/extractor.mjs';
import { getPlan, listPlans, persistPlan } from '../packages/plans/src/service.mjs';
import { search } from '../packages/storage/src/search.mjs';

const migrationsDir = resolve('migrations');

function tableBlocks(rows) {
  const blocks = [];
  rows.forEach((cells, row) => cells.forEach((text, column) => blocks.push({
    type: 'table_cell',
    text,
    locator: { kind: 'docx_table_cell', table: 1, row: row + 1, column: column + 1 },
    metadata: { table: 1, row: row + 1, column: column + 1 }
  })));
  return blocks;
}

test('разбирает табличный учебный план с датами, периодами и строкой без срока', () => {
  const rows = [
    ['№ п/п', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'],
    ['1', 'Провести заседание кафедры', '15 сентября 2026', 'Иванов Иван Иванович', 'Протокол'],
    ['2', 'Подготовить отчёт по НИР', 'до 20 октября', 'Петров Пётр Петрович', 'Отчёт'],
    ['3', 'Актуализировать методические материалы', 'ноябрь 2026', 'Сидоров Сидор Сидорович', 'Комплект материалов'],
    ['4', 'Подготовить предложения по практике', 'по мере необходимости', 'Иванов Иван Иванович', 'Предложения']
  ];
  const blocks = tableBlocks(rows);
  const text = `ПЛАН РАБОТЫ КАФЕДРЫ\nна 2026/2027 учебный год\n${rows.flat().join('\n')}`;
  assert.equal(looksLikePlan(text, blocks, 'План работы кафедры'), true);
  const result = extractPlan({ text, blocks, title: 'План работы кафедры', requestedType: 'plan' });
  assert.equal(result.kind, 'department');
  assert.equal(result.periodKind, 'academic');
  assert.equal(result.periodKey, '2026/27');
  assert.equal(result.items.length, 4);
  assert.equal(result.items[0].startsAt, '2026-09-15');
  assert.equal(result.items[1].dueDate, '2026-10-20');
  assert.deepEqual([result.items[2].startsAt, result.items[2].endsAt], ['2026-11-01', '2026-11-30']);
  assert.equal(result.items[3].startsAt, null);
  assert.ok(result.items[3].warnings.includes('date_missing'));
  assert.ok(result.warnings.includes('items_without_date'));
  assert.equal(parsePlanDateWindow('15 февраля', result).start, '2027-02-15');
});

test('сохраняет план идемпотентно, индексирует пункты и создаёт календарь с происхождением', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const ivanov = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович' });
    createPerson(database, workspace.id, { displayName: 'Сидоров Сидор Сидорович' });
    const now = '2026-08-07T06:00:00.000Z';
    database.run("INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES ('planblob',1,'text/plain','/tmp/plan',?)", now);
    database.run("INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES ('doc_plan',?,'План кафедры','unknown','processing','ver_plan',?,?)", workspace.id, now, now);
    database.run("INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at) VALUES ('ver_plan','doc_plan',1,'planblob','plan.txt','text/plain','text','extracting',?)", now);

    const rows = [
      ['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'],
      ['1', 'Провести заседание кафедры', '15 сентября 2026', 'Иванов Иван Иванович', 'Протокол'],
      ['2', 'Подготовить отчёт по НИР', 'до 20 октября', 'Петров Пётр Петрович', 'Отчёт'],
      ['3', 'Актуализировать методические материалы', 'ноябрь 2026', 'Сидоров Сидор Сидорович', 'Комплект материалов'],
      ['4', 'Подготовить предложения по практике', 'по мере необходимости', 'Иванов Иван Иванович', 'Предложения']
    ];
    const result = extractPlan({
      text: `ПЛАН РАБОТЫ КАФЕДРЫ на 2026/2027 учебный год\n${rows.flat().join('\n')}`,
      blocks: tableBlocks(rows), title: 'План кафедры', requestedType: 'plan'
    });
    const first = persistPlan(database, {
      workspaceId: workspace.id, documentVersionId: 'ver_plan', documentTitle: 'План кафедры', result, now
    });
    const second = persistPlan(database, {
      workspaceId: workspace.id, documentVersionId: 'ver_plan', documentTitle: 'План кафедры', result, now
    });

    assert.equal(first.id, second.id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plans').n, 1);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plan_items').n, 4);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='plan_item'").n, 3);
    const calendar = database.all("SELECT * FROM calendar_items WHERE source_kind='plan_item' ORDER BY starts_at");
    assert.ok(calendar.every((item) => item.origin_document_id === 'doc_plan'));
    assert.ok(calendar.every((item) => item.origin_kind === 'plan'));
    assert.ok(calendar.some((item) => item.item_kind === 'task' && item.starts_at === '2026-10-20'));
    assert.ok(calendar.some((item) => item.ends_at === '2026-11-30'));

    const stored = getPlan(database, workspace.id, first.id);
    assert.equal(stored.items.length, 4);
    assert.equal(stored.items.find((item) => item.item_no === '1').responsible_person_id, ivanov.id);
    assert.equal(stored.source_document_id, 'doc_plan');
    const review = database.get("SELECT * FROM review_items WHERE issue_code='plan_items_without_date'");
    assert.ok(review);
    assert.match(review.explanation, /1 пункт/);

    const sciencePlans = listPlans(database, workspace.id, { direction: 'science' });
    assert.equal(sciencePlans.length, 1);
    const responsiblePlans = listPlans(database, workspace.id, { responsible: 'Иванов' });
    assert.equal(responsiblePlans.length, 1);
    const found = search(database, workspace.id, 'методические материалы', 20);
    assert.ok(found.some((item) => item.source_kind === 'plan_item'));
    assert.ok(database.get("SELECT COUNT(*) AS n FROM entity_facets WHERE source_kind='plan_item'").n >= 4);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
