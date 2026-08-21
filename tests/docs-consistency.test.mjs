import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDocumentation } from '../scripts/docs-consistency.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docs-check-'));
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'scripts', 'offline'), { recursive: true });
  await mkdir(join(root, 'deploy', 'systemd'), { recursive: true });
  await mkdir(join(root, 'config', 'offline'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node check.mjs', good: 'node good.mjs' } }));
  await writeFile(join(root, 'scripts', 'offline', 'doctor.sh'), '#!/bin/sh\n');
  await writeFile(join(root, 'scripts', 'doctor.mjs'), '');
  await writeFile(join(root, 'deploy', 'systemd', 'kafedra-planner-api.service'), '[Service]\n');
  await writeFile(join(root, 'config', 'offline', 'os-packages.txt'), 'unzip\n');
  await writeFile(join(root, 'docs', 'other.md'), '# Other\n');
  return root;
}

test('documentation checker accepts existing commands and paths', async () => {
  const root = await fixture();
  await writeFile(join(root, 'README.md'), [
    '[Документ](docs/other.md)',
    'npm run good',
    '`scripts/offline/doctor.sh`',
    '`config/offline/os-packages.txt`',
    '/opt/kafedra-planner/current/scripts/doctor.mjs',
    'kafedra-planner-api.service'
  ].join('\n'));
  assert.deepEqual(await checkDocumentation({ root }), []);
});

test('documentation checker reports stale npm, file and Markdown references', async () => {
  const root = await fixture();
  await writeFile(join(root, 'README.md'), [
    '[Нет файла](docs/missing.md)',
    'npm run missing-command',
    '`scripts/offline/missing.sh`',
    '`deploy/systemd/kafedra-planner-missing.service`',
    '/opt/kafedra-planner/current/scripts/missing.mjs'
  ].join('\n'));
  const errors = await checkDocumentation({ root });
  assert.deepEqual(new Set(errors.map((item) => item.kind)), new Set([
    'markdown-link',
    'npm-script',
    'repo-path',
    'installed-script',
    'systemd-unit'
  ]));
  assert.ok(errors.some((item) => item.target === 'missing-command'));
  assert.ok(errors.some((item) => item.target === 'docs/missing.md'));
});
