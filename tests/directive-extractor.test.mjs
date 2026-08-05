import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeDirective, extractDirective } from '../packages/work-management/src/extractor.mjs';

const text = `
РАСПОРЯЖЕНИЕ
от 5 августа 2026 года № 47-р
О подготовке отчёта по научной работе

РАСПОРЯЖАЮСЬ:
1. Подготовить и представить отчёт по НИР до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.
2. Разместить материалы на сайте не позднее 25 августа 2026 года. Ответственный: Петров Пётр Петрович. Контроль за исполнением возложить на Сидорова С.С.
Директор А.А. Смирнов
`;

test('распознаёт распоряжение, номер, дату и поручения', () => {
  assert.equal(looksLikeDirective(text), true);
  const result = extractDirective(text);
  assert.equal(result.kind, 'directive');
  assert.equal(result.documentNumber, '47-р');
  assert.equal(result.issuedAt, '2026-08-05');
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[0].dueDate, '2026-08-20');
  assert.match(result.assignments[0].executorRaw, /Иванов/);
  assert.equal(result.assignments[0].direction, 'science');
  assert.equal(result.assignments[1].dueDate, '2026-08-25');
  assert.match(result.assignments[1].controllerRaw, /Сидорова/);
});
