import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8');
const segment = await readFile(new URL('../public/plans-lifecycle-desktop.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/plans-lifecycle-desktop.css', import.meta.url), 'utf8');

test('desktop plans entry loads the lifecycle adapter after the existing lifecycle authority', () => {
  const lifecycleIndex = entry.indexOf("await import('./lifecycle-safe.js')");
  const segmentIndex = entry.indexOf("await import('./plans-lifecycle-desktop.js')");
  assert.ok(lifecycleIndex >= 0, 'existing lifecycle module must remain loaded');
  assert.ok(segmentIndex > lifecycleIndex, 'desktop adapter must load after lifecycle authority');
  assert.doesNotMatch(segment, /\/api\//u);
  assert.doesNotMatch(segment, /localStorage|sessionStorage/u);
  assert.doesNotMatch(segment, /archivePlan|restorePlan|DELETE|PATCH/u);
});

test('the existing hidden select remains the single lifecycle state bridge', () => {
  assert.match(segment, /SOURCE_ID = 'plans-lifecycle-status'/u);
  assert.match(segment, /resolveLifecycleOptions/u);
  assert.match(segment, /HTMLSelectElement/u);
  assert.match(segment, /select\.value = value/u);
  assert.match(segment, /select\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/u);
  assert.match(segment, /select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/u);
  assert.match(segment, /aria-hidden/u);
  assert.match(segment, /MutationObserver/u);
});

test('current and archive expose explicit keyboard and selection semantics', () => {
  assert.match(segment, /Текущие/u);
  assert.match(segment, /Архив/u);
  assert.match(segment, /plans-lifecycle-segment/u);
  assert.match(segment, /role', 'tablist/u);
  assert.match(segment, /role', 'tab/u);
  assert.match(segment, /aria-selected/u);
  assert.match(segment, /ArrowLeft/u);
  assert.match(segment, /ArrowRight/u);
  assert.match(segment, /Home/u);
  assert.match(segment, /End/u);
  assert.match(segment, /Текущих планов нет/u);
  assert.match(segment, /Архив пуст/u);
});

test('visual contract is desktop-generic, no-motion and reliably targetable', () => {
  assert.match(css, /min-height: 44px/u);
  assert.match(css, /focus-visible/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(css, /transition: none/u);
  assert.doesNotMatch(css, /@media \(max-width:/u);
  assert.doesNotMatch(css, /animation:/u);
  assert.doesNotMatch(segment, /touchstart|touchend|pointerdown|swipe|bottom-sheet/u);
});
