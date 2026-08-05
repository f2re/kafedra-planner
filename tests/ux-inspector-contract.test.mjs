import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('следующая UX-итерация содержит инспектор, фильтры, перенос и восстановление черновика', async () => {
  const [script, styles, index] = await Promise.all([
    readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/ux-next.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  ]);
  assert.match(index, /src="\/ux-next\.js"/);
  assert.match(script, /data-filter-category/);
  assert.match(script, /data-calendar-item/);
  assert.match(script, /dragstart/);
  assert.match(script, /\/api\/calendar\/\$\{encodeURIComponent\(updated\.id\)\}\/undo/);
  assert.match(script, /\/api\/templates\/draft/);
  assert.match(script, /resume-template-draft/);
  assert.match(script, /openDocumentInspector/);
  assert.match(styles, /\.ux-inspector/);
  assert.match(styles, /\.drag-target/);
  assert.match(styles, /\.template-draft-banner/);
});
