import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('главный пользовательский поток остаётся календарным и предсказуемым', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-view-panel="calendar"/);
  assert.match(html, /class="view active" data-view-panel="calendar"/);
  assert.match(html, /data-calendar-mode="month"/);
  assert.match(html, /data-calendar-mode="week"/);
  assert.match(html, /data-calendar-mode="tasks"/);
  assert.match(html, /id="notification-button"/);
  assert.match(html, /id="event-sheet"[^>]+role="dialog"[^>]+aria-modal="true"/);
});

test('мастер шаблона содержит последовательные этапы и проверку до сохранения', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-wizard-step="1"/);
  assert.match(html, /data-wizard-step="2"/);
  assert.match(html, /data-wizard-step="3"/);
  assert.match(html, /id="preview-template"/);
  assert.match(html, /id="save-template"/);
  assert.match(html, /Оригинальный файл не изменяется/);
});
