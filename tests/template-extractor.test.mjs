import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, matchesTemplate } from '../packages/templates/src/extractor.mjs';

const documentText = `ПРИКАЗ О НАЗНАЧЕНИИ\nДата приказа: 05.08.2026\nОтветственный:\nИванов Иван Иванович\nКоличество: 12\nОснование:\nПротокол заседания кафедры\nКонец основания`;

const template = {
  matcher: { requiredPhrases: ['ПРИКАЗ О НАЗНАЧЕНИИ', 'Дата приказа:'] },
  fields: [
    { key: 'order_date', label: 'Дата приказа', type: 'date', strategy: 'after_label', anchor: 'Дата приказа:', required: true },
    { key: 'responsible', label: 'Ответственный', type: 'string', strategy: 'next_line', anchor: 'Ответственный:', required: true },
    { key: 'count', label: 'Количество', type: 'number', strategy: 'after_label', anchor: 'Количество:', required: true },
    { key: 'reason', label: 'Основание', type: 'text', strategy: 'between', anchor: 'Основание:', endAnchor: 'Конец основания', required: false }
  ]
};

test('шаблон сопоставляется по обязательным фразам', () => {
  assert.equal(matchesTemplate(template, { text: documentText, originalName: 'приказ-12.txt' }), true);
  assert.equal(matchesTemplate(template, { text: 'другой документ', originalName: 'приказ-12.txt' }), false);
});

test('поля извлекаются детерминированно и получают типы', () => {
  const result = applyTemplate(template, { text: documentText, originalName: 'приказ-12.txt' });
  assert.equal(result.values.order_date, '2026-08-05');
  assert.equal(result.values.responsible, 'Иванов Иван Иванович');
  assert.equal(result.values.count, 12);
  assert.equal(result.values.reason, 'Протокол заседания кафедры');
  assert.deepEqual(result.missing, []);
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.evidence.responsible.locator, { startLine: 4, endLine: 4 });
});
