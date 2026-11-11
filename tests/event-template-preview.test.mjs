import test from 'node:test';
import assert from 'node:assert/strict';
import { eventTerm, fieldValue, previewTable } from '../public/event-template-editor.js';
import { eventTerm as exportedTerm, eventFieldText } from '../packages/plan-docx/src/event-template-export.mjs';

test('предпросмотр и DOCX показывают один срок с интервалом, дедлайном и явным пустым значением', () => {
  const cases = [
    { startsAt: '2026-11-15', endsAt: '2026-11-17', dueDate: '2026-11-20', dateText: null },
    { startsAt: null, dueDate: '2026-12-05', dateText: null },
    { startsAt: '2026-11-15', dateText: '' },
    { startsAt: '2026-11-15', dateText: 'По отдельному графику' },
    { startsAt: null, endsAt: null, dueDate: null, dateText: null }
  ];
  for (const value of cases) assert.equal(eventTerm(value), exportedTerm(value));
  assert.equal(eventTerm({ starts_at: '2026-11-15', ends_at: '2026-11-17', due_date: '2026-11-20' }), '15 ноября 2026 — 17 ноября 2026; до 20 ноября 2026');
  const fields = [{ key: 'date', source: 'date' }, { key: 'custom_date', source: 'custom', type: 'date' }, { key: 'custom_count', source: 'custom', type: 'number' }];
  const effective = { ...cases[0], customValues: { custom_date: '2026-12-05', custom_count: '0' } };
  for (const field of fields) assert.equal(String(fieldValue(field, { effective })), eventFieldText(field, effective));
});

test('предпросмотр экранирует пользовательский текст и передаёт ширины без запрещённых CSP inline styles', () => {
  const definition = { fields: [{ key: 'title', source: 'title', label: '<img src=x>', required: true, visible: true, width: 60 }, { key: 'location', source: 'location', label: 'Место', visible: false, width: 40 }], layout: { orientation: 'portrait', showRowNumbers: true } };
  const html = previewTable(definition, [{ title: '<script>alert(1)</script>', location: 'Скрыто' }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes(' style='));
  assert.ok(html.includes('data-preview-width="95"'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('Скрыто'));
});
