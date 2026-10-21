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
  assert.match(sheetJs, /gap-repair/);
  assert.match(sheetJs, /formula-calc/);
  assert.match(sheetJs, /archive-query/);
  assert.match(sheetJs, /assistant-settings-panel/);
  assert.match(sheetJs, /handleTestConnection/);
  assert.match(sheetJs, /handleSaveSettings/);
  assert.match(sheetJs, /copyTableToClipboard/);
  assert.match(sheetJs, /text\/tab-separated-values/);
  assert.match(sheetJs, /contentEditable/);
  assert.match(sheetJs, /kafedra\.assistant\.draft/);
  assert.match(sheetJs, /kafedra\.assistant\.history/);

  // Assistant CSS
  assert.match(sheetCss, /\.assistant-sheet/);
  assert.match(sheetCss, /\.assistant-backdrop/);
  assert.match(sheetCss, /\.assistant-table/);
  assert.match(sheetCss, /\.assistant-settings-panel/);
  assert.match(sheetCss, /\.assistant-gap-list/);
  assert.match(sheetCss, /\.assistant-gap-toolbar/);
  assert.match(sheetCss, /\.assistant-apply-all-btn/);
  assert.match(sheetCss, /\.assistant-gap-details/);
  assert.match(sheetCss, /prefers-reduced-motion/);

  // Apply all & single apply contracts
  assert.match(sheetJs, /assistant-apply-all-btn/);
  assert.match(sheetJs, /assistant-copy-all-btn/);
  assert.match(sheetJs, /assistant-toggle-details-btn/);
  assert.match(sheetJs, /assistant-apply-item-btn/);
  assert.match(sheetJs, /computeRepairedText/);
  assert.match(sheetJs, /applySingleItem/);
});

test('computeRepairedText and applySingleItem update text seamlessly without user hassle', async () => {
  const { computeRepairedText, applySingleItem } = await import('../public/assistant-sheet.js');

  const original = 'Заседание кафедры.\nПрисутствовали: Иванов, Петров.';
  const items = [
    { field: 'Дата заседания', status: 'missing', currentValue: null, suggestedValue: '2026-04-15' },
    { field: 'Докладчик', status: 'missing', currentValue: null, suggestedValue: 'Иванов И.И.' }
  ];

  // 1. If LLM provided cohesive repairedText, computeRepairedText prioritizes it
  const repairedFromLlm = computeRepairedText(original, items, 'Заседание кафедры от 15.04.2026.\nДокладчик: Иванов И.И.');
  assert.equal(repairedFromLlm, 'Заседание кафедры от 15.04.2026.\nДокладчик: Иванов И.И.');

  // 2. Fallback computation when LLM did not provide repairedText
  const computed = computeRepairedText(original, items, '');
  assert.ok(computed.includes('Заседание кафедры.'));
  assert.ok(computed.includes('Дата заседания: 2026-04-15'));
  assert.ok(computed.includes('Докладчик: Иванов И.И.'));

  // 3. Current value replacement
  const textWithErr = 'Срок сдачи: до конца недели.';
  const replaceItems = [
    { field: 'Срок сдачи', status: 'invalid', currentValue: 'до конца недели', suggestedValue: '2026-05-01' }
  ];
  const replaced = computeRepairedText(textWithErr, replaceItems, '');
  assert.equal(replaced, 'Срок сдачи: 2026-05-01.');

  // 4. Single item apply
  const singleReplaced = applySingleItem(textWithErr, replaceItems[0]);
  assert.equal(singleReplaced, 'Срок сдачи: 2026-05-01.');
});
