import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8');
const segment = await readFile(new URL('../public/plans-lifecycle-desktop.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/plans-lifecycle-desktop.css', import.meta.url), 'utf8');

test('desktop entry loads the lifecycle adapter after the existing lifecycle controller', () => {
  const authority = entry.indexOf("await import('./lifecycle-safe.js')");
  const adapter = entry.indexOf("await import('./plans-lifecycle-desktop.js')");
  assert.ok(authority >= 0 && adapter > authority);
  assert.doesNotMatch(segment, /\/api\//u);
  assert.doesNotMatch(segment, /localStorage|sessionStorage/u);
  assert.doesNotMatch(segment, /archivePlan|restorePlan|DELETE|PATCH/u);
});

test('visible segment delegates to one hidden compatibility select', () => {
  assert.match(segment, /SOURCE_ID = 'plans-lifecycle-status'/u);
  assert.match(segment, /select\.value = value/u);
  assert.match(segment, /new Event\('input', \{ bubbles: true \}\)/u);
  assert.match(segment, /new Event\('change', \{ bubbles: true \}\)/u);
  assert.match(segment, /data-plan-lifecycle-source/u);
  assert.match(segment, /MutationObserver/u);
});

test('current and archive expose explicit selection and desktop keyboard semantics', () => {
  assert.match(segment, /Текущие/u);
  assert.match(segment, /Архив/u);
  assert.match(segment, /plans-lifecycle-segment/u);
  assert.match(segment, /data-plan-lifecycle/u);
  assert.match(segment, /aria-selected/u);
  assert.match(segment, /role', 'tablist/u);
  assert.match(segment, /role', 'tab/u);
  assert.match(segment, /ArrowLeft/u);
  assert.match(segment, /ArrowRight/u);
  assert.match(segment, /Home/u);
  assert.match(segment, /End/u);
});

test('empty copies are mode-specific without replacing filtered empty state', () => {
  assert.match(segment, /Текущих планов нет/u);
  assert.match(segment, /Архив пуст/u);
  assert.match(segment, /Планов по этим условиям нет/u);
  assert.match(segment, /hasSecondaryCondition/u);
});

test('visual contract is desktop-only, 44px and no-motion', () => {
  assert.match(segment, /min-width: 721px/u);
  assert.match(css, /min-height: 44px/u);
  assert.match(css, /focus-visible/u);
  assert.match(css, /max-width: 720px/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(css, /transition: none/u);
  assert.doesNotMatch(css, /animation:/u);
  assert.doesNotMatch(segment, /swipe|bottom-sheet|drawer|touchstart/u);
});
