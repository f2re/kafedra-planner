import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { periodicPanelKey, setTextIfChanged } from '../public/dom-stability.js';

test('stable text reconciliation writes only when the visible value changes', () => {
  let writes = 0;
  const node = {
    value: '',
    get textContent() { return this.value; },
    set textContent(value) { writes += 1; this.value = value; }
  };

  assert.equal(setTextIfChanged(node, 'Событие · 2026-09-07'), true);
  assert.equal(setTextIfChanged(node, 'Событие · 2026-09-07'), false);
  assert.equal(writes, 1);
  assert.equal(setTextIfChanged(node, 'Задача · 2026-09-07'), true);
  assert.equal(writes, 2);
});

test('periodic completion panel key is stable until task state really changes', () => {
  assert.equal(periodicPanelKey({ id: 'periodic-1', status: 'open' }), 'periodic-1:open');
  assert.equal(periodicPanelKey({ id: 'periodic-1', status: 'open' }), 'periodic-1:open');
  assert.equal(periodicPanelKey({ id: 'periodic-1', status: 'completed' }), 'periodic-1:completed');
  assert.equal(periodicPanelKey(null), '');
});

test('observer-backed UI modules use idempotent guards instead of self-triggering DOM writes', async () => {
  const [fastForm, periodic] = await Promise.all([
    readFile(new URL('../public/fast-form-disclosure.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/periodic-completion-next.js', import.meta.url), 'utf8')
  ]);
  assert.match(fastForm, /setTextIfChanged\(summary,/u);
  assert.doesNotMatch(fastForm, /summary\.textContent\s*=/u);
  assert.match(periodic, /periodicCompletionKey === key/u);
  assert.match(periodic, /panel\.dataset\.periodicCompletionKey = key/u);
});
