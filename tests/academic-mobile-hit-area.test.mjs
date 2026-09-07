import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile academic upload removes the large file-drop hit area after a file is selected', async () => {
  const [css, ui, browser] = await Promise.all([
    readFile(new URL('../public/academic-performance-next.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/academic-performance-next.js', import.meta.url), 'utf8'),
    readFile(new URL('./browser/academic-performance.spec.mjs', import.meta.url), 'utf8')
  ]);
  const mobile = css.match(/@media \(max-width: 680px\) \{([\s\S]*?)\n\}/u)?.[1] || '';

  assert.match(mobile, /\.academic-file-drop\s*\{[^}]*overflow:\s*hidden/u);
  assert.match(ui, /input\.closest\('\.academic-file-drop'\)\?\.classList\.add\('hidden'\)/u);
  assert.match(ui, /reselect\.dataset\.academicFileReselect\s*=\s*'1'/u);
  assert.match(ui, /\$ap\('input\[name="file"\]'\s*,\s*form\)\?\.click\(\)/u);
  assert.match(browser, /upload\.locator\('button\[type="submit"\]'\)\.click\(\)/u);
  assert.doesNotMatch(browser, /force:\s*true/u);
});
