import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDepartmentProtocol, looksLikeDepartmentProtocol } from '../packages/protocols/src/extractor.mjs';

const fixture = await readFile(new URL('./fixtures/protocol.txt', import.meta.url), 'utf8');

test('распознаёт протокол кафедры', () => {
  assert.equal(looksLikeDepartmentProtocol(fixture), true);
});

test('извлекает основные поля и пункты', () => {
  const result = extractDepartmentProtocol(fixture);
  assert.equal(result.protocolNumber, '7');
  assert.equal(result.meetingDate, '2026-08-05');
  assert.equal(result.chairperson, 'Иванов Иван Иванович');
  assert.equal(result.secretary, 'Петрова Анна Сергеевна');
  assert.equal(result.agendaItems.length, 2);
  assert.match(result.agendaItems[0].decisionText, /Подготовить сводный отчёт/);
  assert.equal(result.agendaItems[0].dueDate, '2026-09-15');
  assert.equal(result.agendaItems[0].responsibleRaw, 'Сидоров П.П.');
  assert.ok(result.confidence >= 0.9);
});
