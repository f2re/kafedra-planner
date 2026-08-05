import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPlanMetrics,
  extractReportFacts,
  looksLikeReportFacts,
  normalizeMetricName
} from '../packages/reports/src/facts.mjs';

test('извлекает единый ключ показателя из плана и отчёта', () => {
  const plan = extractPlanMetrics('Подготовить не менее 5 статей ВАК и представить отчёт до 20 августа 2026 года.');
  const report = extractReportFacts(`ОТЧЁТ\nПоказатель: статьи ВАК; план: 5; факт: 4\nПоручение выполнено частично.`);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, 'статья_вак');
  assert.equal(plan[0].targetNumeric, 5);
  assert.equal(report.metrics.length, 1);
  assert.equal(report.metrics[0].key, plan[0].key);
  assert.equal(report.metrics[0].actualNumeric, 4);
  assert.equal(report.resultState, 'partial');
  assert.equal(report.progressPercent, 80);
});

test('распознаёт отношение факт к плану и не завышает прогресс выше ста процентов', () => {
  const partial = extractReportFacts('ОТЧЁТ\nВыполнено 6 из 10 мероприятий.\nВыполнено частично.');
  const over = extractReportFacts('ОТЧЁТ\nПоказатель: статьи; план: 3; факт: 4\nПоручение выполнено.');

  assert.equal(partial.metrics[0].targetNumeric, 10);
  assert.equal(partial.metrics[0].actualNumeric, 6);
  assert.equal(partial.progressPercent, 60);
  assert.equal(over.progressPercent, 100);
});

test('не считает произвольный документ отчётом без отчётных признаков', () => {
  assert.equal(looksLikeReportFacts('Общий информационный материал без результатов', 'Справочный материал'), false);
  assert.equal(looksLikeReportFacts('Факт: 4\nПоручение выполнено', 'Отчёт'), true);
  assert.equal(normalizeMetricName('Количество статей ВАК'), 'статья_вак');
});
