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

test('ordinary CI is one compact project check', async () => {
  const source = await read('.github/workflows/ci.yml');
  assert.match(source, /^name: Проверка$/mu);
  for (const command of [
    'npm ci --ignore-scripts --no-audit --no-fund',
    'npm run check',
    'npm run docs:check',
    'npm test',
    'npm run smoke'
  ]) {
    assert.ok(source.includes(command), `ci.yml must contain ${command}`);
  }
  const jobs = [...source.matchAll(/^  ([a-zA-Z0-9_-]+):\n    name:/gmu)].map((match) => match[1]);
  assert.deepEqual(jobs, ['quality']);
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

test('release-scale gate is not a feature pull-request workflow', async () => {
  const source = await read('.github/workflows/release-gate.yml');
  assert.match(source, /^  push:\n    branches: \[main\]$/mu);
  assert.match(source, /^  workflow_dispatch:$/mu);
  assert.doesNotMatch(source, /^  pull_request:/mu);
  assert.match(source, /release-browser-desktop-mobile/u);
  assert.match(source, /release-migrations-backup/u);
});

test('GRACE is selected by governed risk and never polls external checks', async () => {
  const source = await read('.github/workflows/grace.yml');
  assert.match(source, /paths:\n\s+- '\.grace\/\*\*'/u);
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

test('branch protection requires only the always-present ordinary check', async () => {
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
