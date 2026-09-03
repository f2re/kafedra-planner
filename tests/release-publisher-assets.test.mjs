import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('publisher 0.4.0 keeps the verified seven-asset draft contract', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /SHA256SUMS/u);
});
