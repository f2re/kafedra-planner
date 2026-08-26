import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDocumentation } from '../scripts/docs-consistency.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docs-check-'));
  await mkdir(join(root, 'docs', 'releases'), { recursive: true });
  await mkdir(join(root, 'scripts', 'offline'), { recursive: true });
  await mkdir(join(root, 'deploy', 'systemd'), { recursive: true });
  await mkdir(join(root, 'config', 'offline'), { recursive: true });
  await mkdir(join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(join(root, 'VERSION'), '0.3.3\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({
    version: '0.3.3', scripts: { check: 'node check.mjs', good: 'node good.mjs' }
  }));
  await writeFile(join(root, 'scripts', 'offline', 'doctor.sh'), '#!/bin/sh\n');
  await writeFile(join(root, 'scripts', 'doctor.mjs'), '');
  await writeFile(join(root, 'deploy', 'systemd', 'kafedra-planner-api.service'), '[Service]\n');
  await writeFile(join(root, 'config', 'offline', 'os-packages.txt'), 'unzip\n');
  await writeFile(join(root, 'docs', 'other.md'), '# Other\n');
  await writeFile(join(root, 'docs', 'releases', '0.3.3.md'), '# Kafedra Planner 0.3.3\n');
  await writeFile(join(root, 'README.en.md'), '> Current milestone: **`0.3.3`**\n');
  await writeFile(join(root, 'docs', 'ROADMAP.md'), '## Текущий рубеж — `0.3.3`\n');
  await writeFile(join(root, 'docs', 'RELEASE_CANDIDATE.md'), '# Release candidate 0.3.3\n');
  await writeFile(join(root, 'docs', 'VALIDATION.md'), 'Актуальный рубеж: `0.3.3`\n');
  await writeFile(join(root, 'docs', 'UX_FLOWS.md'), 'Статус: рабочие контуры версии `0.3.3`\n');
  await writeFile(join(root, '.github', 'workflows', 'release-gate.yml'), 'name: Release gate 0.3.3\n');
  await writeFile(join(root, '.github', 'workflows', 'release.yml'), 'workflows: ["Release gate 0.3.3"]\n');
  return root;
}

test('documentation checker accepts existing commands, paths and release markers', async () => {
  const root = await fixture();
  await writeFile(join(root, 'README.md'), [
    '> Текущий рубеж: **`0.3.3`**',
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
    '> Текущий рубеж: **`0.3.3`**',
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

test('documentation checker reports drift between VERSION and current release markers', async () => {
  const root = await fixture();
  await writeFile(join(root, 'README.md'), '> Текущий рубеж: **`0.3.2`**\n');
  await writeFile(join(root, 'docs', 'ROADMAP.md'), '## Текущий рубеж — `0.3.2`\n');
  const errors = await checkDocumentation({ root });
  const releaseErrors = errors.filter((item) => item.kind === 'release-version');
  assert.equal(releaseErrors.length, 2);
  assert.ok(errors.some((item) => item.file === 'README.md' && item.target === '0.3.2'));
  assert.ok(errors.some((item) => item.file === 'docs/ROADMAP.md' && item.target === '0.3.2'));
});
