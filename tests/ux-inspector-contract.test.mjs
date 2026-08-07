import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('следующая UX-итерация содержит инспектор, фильтры, перенос и восстановление черновика', async () => {
  const [entrypoint, baseScript, styles, index] = await Promise.all([
    readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/ux-base.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/ux-next.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  ]);
  assert.match(index, /src="\/ux-next\.js"/);
  assert.match(entrypoint, /import\(['"]\.\/plans-next\.js['"]\)/);
  assert.match(entrypoint, /import\(['"]\.\/ux-base\.js['"]\)/);
  assert.match(baseScript, /data-filter-category/);
  assert.match(baseScript, /data-calendar-item/);
  assert.match(baseScript, /dragstart/);
  assert.match(baseScript, /\/api\/calendar\/\$\{encodeURIComponent\(updated\.id\)\}\/undo/);
  assert.match(baseScript, /\/api\/templates\/draft/);
  assert.match(baseScript, /resume-template-draft/);
  assert.match(baseScript, /openDocumentInspector/);
  assert.match(styles, /\.ux-inspector/);
  assert.match(styles, /\.drag-target/);
  assert.match(styles, /\.template-draft-banner/);
});
