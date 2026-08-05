import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeScientificMaterial, extractScientificMaterial } from '../packages/science/src/extractor.mjs';

test('извлекает статью, DOI, авторов и классификации', () => {
  const text = `УДК 551.509\nИванов И.И., Петров П.П.\nМетоды локального прогноза конвективных осадков\nАннотация. Рассмотрен локальный прогноз осадков.\nКлючевые слова: наукастинг, радар.\nDOI: 10.1234/weather.2026.17\nЖурнал Метеорология, 2026\nСтатья входит в РИНЦ и перечень ВАК.`;
  assert.equal(looksLikeScientificMaterial(text), true);
  const result = extractScientificMaterial(text, 'article.txt');
  assert.equal(result.kind, 'article');
  assert.equal(result.doi, '10.1234/weather.2026.17');
  assert.equal(result.publicationYear, 2026);
  assert.ok(result.authors.length >= 2);
  assert.ok(result.classifications.some((item) => item.kind === 'vak'));
  assert.ok(result.classifications.some((item) => item.kind === 'rinc'));
});
