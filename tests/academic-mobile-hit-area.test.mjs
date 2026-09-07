import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('academic upload keeps scrollable content and submit footer structurally separate', async () => {
  const [css, ui, browser] = await Promise.all([
    readFile(new URL('../public/academic-performance-upload.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/academic-performance-next.js', import.meta.url), 'utf8'),
    readFile(new URL('./browser/academic-performance.spec.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(ui, /body\.className = 'academic-modal-body academic-upload-body'/u);
  assert.match(ui, /form\.classList\.remove\('academic-modal-body'\)/u);
  assert.match(ui, /actions\.classList\.add\('academic-upload-actions'\)/u);
  assert.match(ui, /form\.insertBefore\(body, actions\)/u);
  assert.match(ui, /form\.dataset\.academicUploadLayout = '1'/u);
  assert.match(css, /\.academic-upload-form\s*\{[^}]*overflow:\s*hidden/u);
  assert.match(css, /\.academic-upload-body\s*\{[^}]*overflow:\s*auto/u);
  assert.match(css, /\.academic-upload-actions\s*\{[^}]*flex:\s*0 0 auto/u);
  assert.match(browser, /upload\.locator\('button\[type="submit"\]'\)\.click\(\)/u);
  assert.doesNotMatch(browser, /force:\s*true/u);
});

test('selected file remains inside the scroll body while reselect stays available', async () => {
  const ui = await readFile(new URL('../public/academic-performance-next.js', import.meta.url), 'utf8');
  assert.match(ui, /input\.closest\('\.academic-file-drop'\)\?\.classList\.add\('hidden'\)/u);
  assert.match(ui, /reselect\.dataset\.academicFileReselect\s*=\s*'1'/u);
  assert.match(ui, /\$ap\('input\[name="file"\]'\s*,\s*form\)\?\.click\(\)/u);
});
