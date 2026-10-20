import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('assistant UI elements and contracts are present in index.html, app.js and CSS', async () => {
  const [indexHtml, appJs, sheetJs, sheetCss] = await Promise.all([
    readFile('public/index.html', 'utf8'),
    readFile('public/app.js', 'utf8'),
    readFile('public/assistant-sheet.js', 'utf8'),
    readFile('public/assistant-sheet.css', 'utf8')
  ]);

  // Topbar button
  assert.match(indexHtml, /id="open-assistant"/);
  assert.match(indexHtml, /aria-label="Ассистент кафедры"/);
  assert.match(indexHtml, /title="Ассистент кафедры · Alt\+A"/);

  // App.js binding
  assert.match(appJs, /createAssistantSheet/);
  assert.match(appJs, /open-assistant/);

  // Assistant sheet module
  assert.match(sheetJs, /export function createAssistantSheet/);
  assert.match(sheetJs, /table-extract/);
  assert.match(sheetJs, /formula-calc/);
  assert.match(sheetJs, /archive-query/);
  assert.match(sheetJs, /copyTableToClipboard/);
  assert.match(sheetJs, /text\/tab-separated-values/);
  assert.match(sheetJs, /contentEditable/);
  assert.match(sheetJs, /kafedra\.assistant\.draft/);
  assert.match(sheetJs, /kafedra\.assistant\.history/);

  // Assistant CSS
  assert.match(sheetCss, /\.assistant-sheet/);
  assert.match(sheetCss, /\.assistant-backdrop/);
  assert.match(sheetCss, /\.assistant-table/);
  assert.match(sheetCss, /prefers-reduced-motion/);
});
