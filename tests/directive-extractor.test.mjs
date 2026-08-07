import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDirective, looksLikeDirective } from '../packages/work-management/src/extractor.mjs';

async function fixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

test('golden: приказ извлекает номер, дату, primary/coexecutors и точные evidence locators', async () => {
  const text = await fixture('directive-order.txt');
  assert.equal(looksLikeDirective(text), true);
  const result = extractDirective(text);
  assert.equal(result.kind, 'order');
  assert.equal(result.documentNumber, '42-к');
  assert.equal(result.issuedAt, '2026-08-07');
  assert.equal(result.evidence.number.locator.startLine, 2);
  assert.equal(result.evidence.issuedAt.locator.startLine, 2);
  assert.equal(result.evidence.title.locator.startLine, 3);
  assert.equal(result.evidence.issuer.locator.startLine, 8);
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[0].dueDate, '2026-09-15');
  assert.equal(result.assignments[0].executorRaw, 'Иванов Иван Иванович');
  assert.deepEqual(result.assignments[0].coexecutorRaws, ['Петров Пётр Петрович', 'Сидоров Сергей Сергеевич']);
  assert.equal(result.assignments[0].evidence.fields.executor.locator.startLine, 6);
  assert.equal(result.assignments[0].evidence.fields.coexecutors.length, 2);
  assert.doesNotMatch(result.assignments[1].instructionText, /Ректор/u);
});

test('golden: указ сохраняет поручение без исполнителя и не теряет остальные пункты', async () => {
  const text = await fixture('directive-decree.txt');
  const result = extractDirective(text);
  assert.equal(result.kind, 'decree');
  assert.equal(result.documentNumber, '17-у');
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[0].dueDate, '2026-09-30');
  assert.equal(result.assignments[0].executorRaw, null);
  assert.equal(result.assignments[1].dueDate, null);
  assert.equal(result.assignments[1].executorRaw, 'Орлов Олег Олегович');
});

test('golden: ненумерованное распоряжение берёт только строку с действием, а не подпись', async () => {
  const text = await fixture('directive-unnumbered.txt');
  const result = extractDirective(text);
  assert.equal(result.kind, 'directive');
  assert.equal(result.assignments.length, 1);
  assert.match(result.assignments[0].instructionText, /Подготовить материалы/u);
  assert.doesNotMatch(result.assignments[0].instructionText, /Директор|ознакомлены/u);
});

test('явно выбранный оператором тип имеет приоритет над эвристикой заголовка', () => {
  const result = extractDirective('РАСПОРЯЖЕНИЕ\nот 1 августа 2026 года № 1\nПоручаю: подготовить отчёт.', { requestedType: 'order' });
  assert.equal(result.kind, 'order');
  assert.ok(result.evidence.kind);
});
