import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const version = '0.4.0';

test('publisher follows the current release gate and write permissions contract', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /permissions:\n\s+actions: write\n\s+contents: write/u);
  assert.match(source, new RegExp(`Release gate ${version.replaceAll('.', '\\.')}`, 'u'));
});
