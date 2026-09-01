import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../public/plans-lifecycle-desktop.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/plans-lifecycle-desktop.css', import.meta.url), 'utf8');

test('desktop lifecycle adapter boots after the existing lifecycle authority', () => {
  const authority = bootstrap.indexOf("await import('./lifecycle-safe.js')");
  const enhancement = bootstrap.indexOf("await import('./plans-lifecycle-desktop.js')");
  assert.ok(authority >= 0, 'existing lifecycle controller must remain loaded');
  assert.ok(enhancement > authority, 'desktop adapter must load after the lifecycle authority');
});

test('adapter is desktop-only and restores the original select below 721 pixels', () => {
  assert.match(adapter, /const DESKTOP_QUERY = '\(min-width: 721px\)'/u);
  assert.match(adapter, /window\.matchMedia\(DESKTOP_QUERY\)/u);
  assert.match(adapter, /function captureVisibilityState\(/u);
  assert.match(adapter, /export function restoreVisibilityState\(/u);
  assert.match(adapter, /export function detachActive\(/u);
  assert.match(adapter, /restoreVisibilityState\(active\.select, active\.selectState\)/u);
  assert.match(adapter, /restoreVisibilityState\(active\.owner, active\.ownerState\)/u);
  assert.match(adapter, /else detachActive\(\)/u);
});

test('segment delegates to source events and has no parallel data or preference model', () => {
  assert.match(adapter, /const SOURCE_ID = 'plans-lifecycle-status'/u);
  assert.match(adapter, /plans-lifecycle-segment/u);
  assert.match(adapter, /dataLifecycleView|dataset\.lifecycleView/u);
  assert.match(adapter, /setAttribute\('role', 'tablist'\)/u);
  assert.match(adapter, /setAttribute\('role', 'tab'\)/u);
  assert.match(adapter, /aria-selected/u);
  assert.match(adapter, /dispatchEvent\(new Event\('input'/u);
  assert.match(adapter, /dispatchEvent\(new Event\('change'/u);
  assert.match(adapter, /ArrowLeft/u);
  assert.match(adapter, /ArrowRight/u);
  assert.match(adapter, /Home/u);
  assert.match(adapter, /End/u);
  assert.doesNotMatch(adapter, /\bfetch\s*\(/u);
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|indexedDB/u);
  assert.doesNotMatch(adapter, /\/api\/plans/u);
  assert.doesNotMatch(adapter, /bottom[- ]sheet|swipe|gesture|list.?detail/iu);
});

test('empty states distinguish current, archive and secondary constraints', () => {
  assert.match(adapter, /Текущих планов нет/u);
  assert.match(adapter, /Архив пуст/u);
  assert.match(adapter, /Планов по этим условиям нет\./u);
  assert.match(adapter, /hasSecondaryConstraint/u);
  assert.match(adapter, /\.plan-card, \[data-plan-id\]/u);
});

test('desktop control meets focus, target and reduced-motion contracts', () => {
  assert.match(styles, /@media \(min-width: 721px\)/u);
  assert.match(styles, /min-height: 44px/u);
  assert.match(styles, /min-width: 44px/u);
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /transition: none/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /animation: none !important/u);
});
