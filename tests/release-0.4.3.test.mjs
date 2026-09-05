import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');
const version = '0.4.3';

test('0.4.3 синхронизирован в версии, lockfile и текущих документах', async () => {
  assert.equal((await text('VERSION')).trim(), version);
  assert.equal(JSON.parse(await text('package.json')).version, version);
  const lock = JSON.parse(await text('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);

  const markers = [
    ['README.md', 'Текущий рубеж: **`0.4.3`**'],
    ['README.en.md', 'Current milestone: **`0.4.3`**'],
    ['docs/ROADMAP.md', '## Текущий рубеж — `0.4.3`'],
    ['docs/UX_FLOWS.md', 'Статус: рабочие контуры версии `0.4.3`'],
    ['docs/VALIDATION.md', 'Актуальный рубеж: `0.4.3`'],
    ['docs/RELEASE_CANDIDATE.md', '# Release candidate 0.4.3'],
    ['docs/TARGET_ACCEPTANCE.md', 'Kafedra Planner 0.4.3, schema SQLite 31'],
    ['docs/releases/0.4.3.md', '# Kafedra Planner 0.4.3']
  ];
  for (const [path, marker] of markers) {
    assert.ok((await text(path)).includes(marker), `${path} должен содержать ${marker}`);
  }
});

test('0.4.3 включает годовой импорт протоколов без schema change', async () => {
  const meetings = await text('docs/MEETINGS.md');
  const imports = await text('packages/protocols/src/protocol-imports.mjs');
  const ui = await text('public/protocol-import.js');
  const migrations = await readdir('migrations');

  assert.match(meetings, /Протоколы за год/u);
  assert.match(imports, /protocol-year:/u);
  assert.match(imports, /needs_review/u);
  assert.match(ui, /Загрузить протоколы|protocol-import-input/u);
  assert.match(ui, /idempotency-key/u);
  assert.equal(migrations.some((name) => /^032_/u.test(name)), false);
});

test('0.4.3 выпускается build-once workflow без внешней оркестрации', async () => {
  const release = await text('.github/workflows/release.yml');
  assert.match(release, /^name: Release$/mu);
  assert.match(release, /^on:\n  workflow_dispatch:\n  push:\n    branches: \[release-run\]$/mu);
  assert.doesNotMatch(release, /^  (?:pull_request|workflow_run):/mu);
  assert.doesNotMatch(release, /^    branches: \[main\]$/mu);
  assert.match(release, /push:refs\/heads\/release-run/u);
  assert.match(release, /tests\/browser\/protocol-import\.spec\.mjs/u);
  assert.match(release, /build-full-bundle\.sh/u);
  assert.match(release, /systemd-deploy-selftest\.sh "\$OUT"/u);
  assert.equal([...release.matchAll(/build-full-bundle\.sh/g)].length, 1);
  assert.doesNotMatch(release, /gh workflow run/u);
  await assert.rejects(text('.github/workflows/release-gate.yml'), (error) => error?.code === 'ENOENT');
});
