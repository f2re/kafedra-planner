import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../public/plans-next.js', import.meta.url), 'utf8');
const segment = await readFile(new URL('../public/plans-lifecycle-segment.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/plans-lifecycle-segment.css', import.meta.url), 'utf8');

test('plans entry loads the lifecycle segment once without backend coupling', () => {
  assert.match(entry, /plans-lifecycle-segment\.js/u);
  assert.doesNotMatch(segment, /\/api\//u);
  assert.doesNotMatch(segment, /localStorage|sessionStorage/u);
  assert.doesNotMatch(segment, /archivePlan|restorePlan|DELETE|PATCH/u);
});

test('segment delegates to the existing lifecycle select as the single state authority', () => {
  assert.match(segment, /resolveLifecycleOptions/u);
  assert.match(segment, /HTMLSelectElement/u);
  assert.match(segment, /select\.value = value/u);
  assert.match(segment, /new Event\('input', \{ bubbles: true \}\)/u);
  assert.match(segment, /new Event\('change', \{ bubbles: true \}\)/u);
  assert.match(segment, /data-plans-lifecycle-enhanced/u);
  assert.match(segment, /MutationObserver/u);
});

test('current and archive controls expose explicit accessible selection semantics', () => {
  assert.match(segment, /Текущие/u);
  assert.match(segment, /Архив/u);
  assert.match(segment, /plans-lifecycle-segment/u);
  assert.match(segment, /dataLifecycleView/u);
  assert.match(segment, /aria-selected/u);
  assert.match(segment, /role', 'tablist/u);
  assert.match(segment, /role', 'tab/u);
  assert.match(segment, /ArrowLeft/u);
  assert.match(segment, /ArrowRight/u);
});

test('visual contract preserves reliable target size and reduced motion', () => {
  assert.match(css, /min-height: 44px/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(css, /transition: none/u);
  assert.match(css, /focus-visible/u);
  assert.match(css, /@media \(max-width: 720px\)/u);
  assert.doesNotMatch(css, /animation:/u);
});
