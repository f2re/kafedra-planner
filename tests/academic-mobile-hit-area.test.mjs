import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('academic upload moves feedback out of the scroll body and keeps submit unchanged', async () => {
  const [css, ui, browser] = await Promise.all([
    readFile(new URL('../public/academic-performance-upload.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/academic-performance-next.js', import.meta.url), 'utf8'),
    readFile(new URL('./browser/academic-performance.spec.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(ui, /feedback\.className = 'academic-upload-feedback'/u);
  assert.match(ui, /const state = \$ap\('\[data-academic-upload-state\]', body\)/u);
  assert.match(ui, /const error = \$ap\('\[data-academic-error\]', body\)/u);
  assert.match(ui, /if \(state\) feedback\.append\(state\)/u);
  assert.match(ui, /if \(error\) feedback\.append\(error\)/u);
  assert.match(ui, /actions\.prepend\(feedback\)/u);
  assert.match(ui, /actions\.insertBefore\(reselect, cancel \|\| actions\.firstChild\)/u);
  assert.match(browser, /upload\.locator\('button\[type="submit"\]'\)\.click\(\)/u);
  assert.doesNotMatch(browser, /force:\s*true/u);
});

test('after file selection the scroll body cannot participate in pointer hit testing', async () => {
  const [css, ui] = await Promise.all([
    readFile(new URL('../public/academic-performance-upload.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/academic-performance-next.js', import.meta.url), 'utf8')
  ]);

  assert.match(ui, /state\.textContent = `Выбран файл: \$\{file\.name\}`/u);
  assert.match(ui, /\$ap\('\[data-academic-file-reselect\]', form\)\?\.classList\.remove\('hidden'\)/u);
  assert.match(ui, /form\.classList\.add\('academic-file-selected'\)/u);
  assert.match(ui, /\$ap\('input\[name="file"\]'\s*,\s*form\)\?\.click\(\)/u);
  assert.match(css, /\.academic-upload-form\.academic-file-selected \.academic-upload-body\s*\{[^}]*max-height:\s*0/u);
  assert.match(css, /\.academic-upload-form\.academic-file-selected \.academic-upload-body\s*\{[^}]*pointer-events:\s*none/u);
  assert.match(css, /\.academic-upload-reselect\.hidden\s*\{[^}]*display:\s*none/u);
});
