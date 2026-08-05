import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, normalizeTemplateInput } from '../packages/templates/src/extractor.mjs';

test('шаблон извлекает поле из той же ячейки XLSX без поиска по случайному тексту', () => {
  const template = normalizeTemplateInput({
    name: 'Отчёт',
    fields: [{
      key: 'publications',
      label: 'Публикации',
      type: 'number',
      strategy: 'line',
      anchor: 'Публикации',
      sourceLocator: { kind: 'xlsx_cell', sheet: 'Отчёт', cell: 'B7' }
    }]
  });
  const result = applyTemplate(template, {
    text: 'Публикации\n999',
    originalName: 'report.xlsx',
    blocks: [
      { type: 'xlsx_cell', text: '12', locator: { kind: 'xlsx_cell', sheet: 'Отчёт', cell: 'B7' } },
      { type: 'xlsx_cell', text: '999', locator: { kind: 'xlsx_cell', sheet: 'Черновик', cell: 'B7' } }
    ]
  });
  assert.equal(result.values.publications, 12);
  assert.equal(result.evidence.publications.locator.sheet, 'Отчёт');
  assert.equal(result.missing.length, 0);
});

test('структурная привязка сохраняется при нормализации шаблона', () => {
  const template = normalizeTemplateInput({
    name: 'Приказ',
    fields: [{
      key: 'number',
      label: 'Номер',
      strategy: 'block',
      sourceLocator: { kind: 'docx_table_cell', table: 1, row: 2, column: 3 }
    }]
  });
  assert.deepEqual(template.fields[0].sourceLocator, {
    kind: 'docx_table_cell',
    table: 1,
    row: 2,
    column: 3
  });
});
