import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocumentation } from '../scripts/docs-consistency.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docs-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'packages/config/src'), { recursive: true });
  await mkdir(join(root, 'config'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"scripts":{}}');
  await writeFile(join(root, 'packages/config/src/index.mjs'), '');
  await writeFile(join(root, 'config/settings.json'), '{}');
  return root;
}

test('documentation checker preserves package prefixes in inline and relative paths', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'docs/audit.md'), [
    '`packages/config/src/index.mjs`',
    '[Конфигурация](../packages/config/src/index.mjs)',
    '`config/settings.json`'
  ].join('\n'));
  assert.deepEqual(await checkDocumentation({ root }), []);
});

test('documentation checker still rejects missing package and root configuration paths', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'README.md'), '`packages/config/src/missing.mjs`\n`config/missing.json`');
  const errors = await checkDocumentation({ root });
  assert.deepEqual(errors.map((item) => item.target).sort(), ['config/missing.json', 'packages/config/src/missing.mjs']);
});
