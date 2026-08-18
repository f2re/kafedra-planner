import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlan } from '../packages/plans/src/extractor.mjs';

function tableBlocks(rows) {
  return rows.flatMap((cells, row) => cells.map((text, column) => ({
    type: 'table_cell',
    text,
    locator: { kind: 'docx_table_cell', table: 1, row: row + 1, column: column + 1 },
    metadata: { table: 1, row: row + 1, column: column + 1 }
  })));
}

test('слово «мероприятие» в названии не превращает пункт плана в заголовок', () => {
  const rows = [
    ['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'],
    ['1', 'Мероприятие образца', '15 августа 2025', 'Иванов Иван Иванович', 'Протокол']
  ];
  const result = extractPlan({
    title: 'План работы кафедры',
    requestedType: 'department_plan',
    text: `ПЛАН РАБОТЫ КАФЕДРЫ\nна 2025 год\n${rows.flat().join('\n')}`,
    blocks: tableBlocks(rows)
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Мероприятие образца');
  assert.equal(result.items[0].startsAt, '2025-08-15');
  assert.equal(result.items[0].responsibleRaw, 'Иванов Иван Иванович');
});

test('повторная строка заголовков не сохраняется как мероприятие', () => {
  const rows = [
    ['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'],
    ['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'],
    ['1', 'Провести заседание кафедры', '15 августа 2025', 'Иванов Иван Иванович', 'Протокол']
  ];
  const result = extractPlan({
    title: 'План работы кафедры',
    requestedType: 'department_plan',
    text: `ПЛАН РАБОТЫ КАФЕДРЫ\nна 2025 год\n${rows.flat().join('\n')}`,
    blocks: tableBlocks(rows)
  });

  assert.deepEqual(result.items.map((item) => item.title), ['Провести заседание кафедры']);
});
