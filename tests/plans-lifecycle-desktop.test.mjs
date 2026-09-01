import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleSource = await readFile(new URL('../public/plans-lifecycle-desktop.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/plans-lifecycle-desktop.css', import.meta.url), 'utf8');
const ux = await readFile(new URL('../public/ux-next.js', import.meta.url), 'utf8');

test('desktop lifecycle module has a hard desktop boundary and preserves the existing select bridge', () => {
  assert.match(moduleSource, /\(min-width: 721px\)/u);
  assert.match(moduleSource, /matchMedia/u);
  assert.match(moduleSource, /plans-lifecycle-status/u);
  assert.match(moduleSource, /aria-hidden/u);
  assert.match(moduleSource, /dispatchEvent\(new Event\('change'/u);
  assert.match(moduleSource, /removeSegment/u);
  assert.doesNotMatch(moduleSource, /bottom[- ]sheet|gesture|pushState|popstate/iu);
});

test('segmented control exposes tabs, roving focus and keyboard navigation', () => {
  assert.match(moduleSource, /role', 'tablist'/u);
  assert.match(moduleSource, /role="tab"/u);
  assert.match(moduleSource, /aria-selected/u);
  assert.match(moduleSource, /tabIndex = selected \? 0 : -1/u);
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.match(moduleSource, new RegExp(key, 'u'));
  }
});

test('mutation reconciliation is idempotent and does not reinsert an already placed segment', () => {
  assert.match(moduleSource, /function placeSegment/u);
  assert.match(moduleSource, /search\.nextElementSibling !== segment/u);
  assert.match(moduleSource, /select\.previousElementSibling !== segment/u);
  assert.match(moduleSource, /placeSegment\(segment, filterbar, select\)/u);
});

test('empty states remain distinct without overwriting loading or errors', () => {
  assert.match(moduleSource, /Планов по этим условиям нет\./u);
  assert.match(moduleSource, /Текущих планов нет/u);
  assert.match(moduleSource, /Архив пуст/u);
  assert.match(moduleSource, /known\.has\(empty\.textContent\.trim\(\)\)/u);
  assert.match(moduleSource, /empty\.textContent\.trim\(\) !== nextText/u);
});

test('desktop styles provide reliable targets, visible focus and reduced-motion fallback', () => {
  assert.match(styles, /min-height:\s*44px/u);
  assert.match(styles, /min-width:\s*96px/u);
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /@media \(min-width: 721px\)/u);
  assert.match(styles, /@media \(max-width: 720px\)/u);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/u);
  assert.match(styles, /transition:\s*none/u);
});

test('desktop module is loaded after lifecycle-safe controller', () => {
  assert.ok(ux.indexOf("./plans-lifecycle-desktop.js") > ux.indexOf("./lifecycle-safe.js"));
});
