import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { REQUIRED_MAIN_CHECKS, mainProtectionPayload } from '../scripts/github/required-checks.mjs';

const read = (path) => readFile(path, 'utf8');

async function expectMissing(path) {
  await assert.rejects(
    read(path),
    (error) => error?.code === 'ENOENT',
    `${path} must be removed`
  );
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test('pull request keeps one complete project check and main push repeats only smoke', async () => {
  const source = await read('.github/workflows/ci.yml');
  assert.match(source, /^name: Проверка$/mu);
  assert.match(source, /^  quality:\n    if: github\.event_name != 'push'\n    name: Проверка$/mu);
  assert.match(source, /^  post-merge-smoke:\n    if: github\.event_name == 'push'\n    name: Post-merge smoke$/mu);

  for (const command of [
    'npm run check',
    'npm run docs:check',
    'npm test'
  ]) {
    assert.equal(occurrences(source, command), 1, `${command} must run only in PR/manual quality`);
  }
  assert.equal(occurrences(source, 'npm run smoke'), 2, 'smoke runs in PR evidence and once after merge');
  assert.equal(occurrences(source, 'npm ci --ignore-scripts --no-audit --no-fund'), 2,
    'both isolated jobs use locked dependencies');

  for (const forbidden of [
    /playwright/iu,
    /Full offline/iu,
    /Project Control/iu,
    /host Node/iu,
    /bundle:offline/iu,
    /systemd/iu,
    /backup:selftest/iu
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('specialized browser workflows are manual diagnostics', async () => {
  for (const path of [
    '.github/workflows/organization.yml',
    '.github/workflows/science-import.yml',
    '.github/workflows/science-lifecycle.yml',
    '.github/workflows/science-reports.yml'
  ]) {
    const source = await read(path);
    assert.match(source, /^on:\n  workflow_dispatch:\n/mu, path);
    assert.doesNotMatch(source, /^  push:/mu, path);
    assert.doesNotMatch(source, /^  pull_request:/mu, path);
  }
});

test('release-scale work is one explicit workflow and never follows ordinary main pushes', async () => {
  const source = await read('.github/workflows/release.yml');
  assert.match(source, /^name: Release$/mu);
  assert.match(source, /^on:\n  workflow_dispatch:\n  push:\n    branches: \[release-run\]$/mu);
  assert.doesNotMatch(source, /^    branches: \[main\]$/mu);
  assert.doesNotMatch(source, /^  pull_request:/mu);
  assert.doesNotMatch(source, /^  workflow_run:/mu);
  assert.match(source, /^  release-gate:/mu);
  assert.match(source, /build-release-targets\.sh "\$OUT"/u);
  assert.match(source, /verify-release-targets\.sh "\$OUT"/u);
  await expectMissing('.github/workflows/release-gate.yml');
});

test('GRACE runs on governed PRs or manually and never repeats after merge', async () => {
  const source = await read('.github/workflows/grace.yml');
  assert.match(source, /^on:\n  pull_request:\n    branches: \[main\]\n    paths:\n      - '\.grace\/\*\*'\n  workflow_dispatch:$/mu);
  assert.doesNotMatch(source, /^  push:/mu);
  assert.doesNotMatch(source, /post-merge/iu);
  assert.match(source, /M-\(DATABASE\|BACKUP\|MIGRATION-RUNNER\)/u);
  assert.match(source, /Run selected GRACE lint and scope gate/u);
  assert.match(source, /Require selected GRACE jobs/u);
  for (const forbidden of [
    /branches: \['\*\*'\]/u,
    /Require every exact-SHA project check/u,
    /grace-merge-gate\.mjs/u,
    /checks: read/u,
    /actions: read/u,
    /npm ci/u,
    /playwright/iu,
    /--run-commands/u
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('branch protection requires only the always-present pull request check', async () => {
  assert.deepEqual(REQUIRED_MAIN_CHECKS, ['Проверка']);
  assert.deepEqual(mainProtectionPayload().required_status_checks.contexts, ['Проверка']);
  const source = await read('scripts/github/configure-main-protection.sh');
  assert.match(source, /scripts\/github\/required-checks\.mjs/u);
  assert.doesNotMatch(source, /grace-required-checks\.mjs/u);
});

test('obsolete one-off orchestration and GRACE polling helpers are removed', async () => {
  await expectMissing('.github/workflows/archive-dummy-probe-293-auto.yml');
  await expectMissing('.github/workflows/release-0.4.1-prep.yml');
  await expectMissing('scripts/github/grace-merge-gate.mjs');
  await expectMissing('scripts/github/grace-required-checks.mjs');
});
