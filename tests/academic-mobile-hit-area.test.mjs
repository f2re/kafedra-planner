import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile academic upload keeps file drop and submit actions in separate hit layers', async () => {
  const css = await readFile(new URL('../public/academic-performance-next.css', import.meta.url), 'utf8');
  const mobile = css.match(/@media \(max-width: 680px\) \{([\s\S]*?)\n\}/u)?.[1] || '';

  assert.match(mobile, /\.academic-file-drop\s*\{[^}]*position:\s*relative/u);
  assert.match(mobile, /\.academic-file-drop\s*\{[^}]*overflow:\s*hidden/u);
  assert.match(mobile, /\.academic-modal-actions\s*\{[^}]*position:\s*relative/u);
  assert.match(mobile, /\.academic-modal-actions\s*\{[^}]*z-index:\s*2/u);
  assert.match(mobile, /\.academic-modal-actions\s*\{[^}]*background:\s*var\(--surface\)/u);
});
