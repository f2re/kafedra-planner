import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('инспектор подключает структурный источник и ручную коррекцию', async () => {
  const [html, script] = await Promise.all([
    readFile('public/index.html', 'utf8'),
    readFile('public/structure-next.js', 'utf8')
  ]);
  assert.match(html, /structure-next\.js/);
  assert.match(script, /Источник документа/);
  assert.match(script, /Показать источник/);
  assert.match(script, /Исправить/);
  assert.match(script, /data-structure-block/);
  assert.match(script, /template-extractions/);
});
