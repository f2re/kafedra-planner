import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizePlanLifecycleMode,
  nextPlanLifecycleMode,
  planLifecycleEmptyMessage
} from '../public/plans-lifecycle-segment.js';

const entry = await readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8');
const segment = await readFile(new URL('../public/plans-lifecycle-segment.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/plans-lifecycle-segment.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('lifecycle modes and keyboard order are deterministic', () => {
  assert.equal(normalizePlanLifecycleMode('archived'), 'archived');
  assert.equal(normalizePlanLifecycleMode('active'), 'active');
  assert.equal(normalizePlanLifecycleMode('anything-else'), 'active');
  assert.equal(nextPlanLifecycleMode('active', 'ArrowRight'), 'archived');
  assert.equal(nextPlanLifecycleMode('archived', 'ArrowRight'), 'active');
  assert.equal(nextPlanLifecycleMode('active', 'ArrowLeft'), 'archived');
  assert.equal(nextPlanLifecycleMode('archived', 'Home'), 'active');
  assert.equal(nextPlanLifecycleMode('active', 'End'), 'archived');
});

test('empty messages distinguish current plans and archive', () => {
  assert.equal(planLifecycleEmptyMessage('active'), 'Текущих планов по этим условиям нет.');
  assert.equal(planLifecycleEmptyMessage('archived'), 'Архивных планов по этим условиям нет.');
  assert.equal(planLifecycleEmptyMessage('unknown'), 'Текущих планов по этим условиям нет.');
});

test('entry loads the adapter after the existing lifecycle authority', () => {
  const lifecycleIndex = entry.indexOf("await import('./lifecycle-safe.js')");
  const segmentIndex = entry.indexOf("await import('./plans-lifecycle-segment.js')");
  assert.ok(lifecycleIndex >= 0);
  assert.ok(segmentIndex > lifecycleIndex);
  assert.doesNotMatch(segment, /\/api\//u);
  assert.doesNotMatch(segment, /localStorage|sessionStorage/u);
});

test('visible tabs delegate to one hidden compatibility select', () => {
  assert.match(segment, /plans-lifecycle-status/u);
  assert.match(segment, /select\.hidden = true/u);
  assert.match(segment, /select\.tabIndex = -1/u);
  assert.match(segment, /aria-hidden/u);
  assert.match(segment, /select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/u);
  assert.match(segment, /role', 'tablist/u);
  assert.match(segment, /role="tab"/u);
  assert.match(segment, /aria-selected/u);
  assert.match(segment, /ArrowLeft/u);
  assert.match(segment, /ArrowRight/u);
  assert.match(segment, /Home/u);
  assert.match(segment, /End/u);
});

test('empty-state synchronization cannot rewrite the same text in an observer loop', () => {
  assert.match(segment, /current !== message/u);
  assert.match(segment, /recognized\.has\(current\) && current !== message/u);
});

test('visual contract has 44px targets, visible focus and no mobile-specific mode', () => {
  assert.match(css, /min-height: 44px/u);
  assert.match(css, /focus-visible/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(css, /transition: none/u);
  assert.doesNotMatch(css, /@media \(max-width:/u);
  assert.doesNotMatch(segment, /touchstart|touchend|swipe|bottom-sheet|data-mobile-mode/u);
  assert.doesNotMatch(css, /animation:/u);
});

test('normal plans browser command runs the new contract only in desktop project', () => {
  const command = packageJson.scripts['test:browser:plans'];
  assert.match(command, /plans-lifecycle-segment\.spec\.mjs --project=desktop/u);
  assert.doesNotMatch(command, /plans-lifecycle-segment\.spec\.mjs --project=mobile/u);
});
