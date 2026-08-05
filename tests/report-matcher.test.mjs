import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreReportCandidate } from '../packages/reports/src/matcher.mjs';

test('отчёт уверенно сопоставляется по номеру, исполнителю и смыслу', () => {
  const result = scoreReportCandidate({
    document: {
      title: 'Отчёт по распоряжению № 47-р',
      text: 'Иванов Иван Иванович подготовил отчёт по научно-исследовательской работе. Поручение выполнено.',
      date: '2026-08-18'
    },
    assignment: {
      title: 'Подготовить отчёт по НИР',
      instructionText: 'Подготовить отчёт по научно-исследовательской работе',
      expectedResult: 'Отчёт по НИР',
      documentNumber: '47-р',
      dueDate: '2026-08-20',
      direction: 'science',
      executors: [{ displayName: 'Иванов Иван Иванович' }]
    }
  });
  assert.ok(result.score >= 0.65, `score=${result.score}`);
  assert.ok(result.reasons.some((reason) => reason.code === 'directive_number'));
  assert.ok(result.reasons.some((reason) => reason.code === 'executor'));
});

test('посторонний документ не получает высокий балл', () => {
  const result = scoreReportCandidate({
    document: { title: 'Смета закупок', text: 'Поставка мебели и расходных материалов', date: '2026-05-01' },
    assignment: { title: 'Подготовить отчёт по НИР', instructionText: 'Научный отчёт', dueDate: '2026-08-20', executors: [] }
  });
  assert.ok(result.score < 0.28, `score=${result.score}`);
});
