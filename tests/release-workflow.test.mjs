import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');
const count = (source, pattern) => [...source.matchAll(pattern)].length;

async function expectMissing(path) {
  await assert.rejects(text(path), (error) => error?.code === 'ENOENT');
}

test('release is one version-neutral explicit workflow', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /^name: Release$/mu);
  assert.match(source, /^on:\n  workflow_dispatch:\n  push:\n    branches: \[release-run\]$/mu);
  assert.doesNotMatch(source, /^  workflow_run:/mu);
  assert.doesNotMatch(source, /^  pull_request:/mu);
  assert.doesNotMatch(source, /^    branches: \[main\]$/mu);
  await expectMissing('.github/workflows/release-gate.yml');
});

test('release-run is only a reusable exact-main trigger', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /case "\$GITHUB_EVENT_NAME:\$GITHUB_REF" in/u);
  assert.match(source, /workflow_dispatch:refs\/heads\/main\|push:refs\/heads\/release-run/u);
  assert.match(source, /\[\[ "\$MAIN_SHA" == "\$GITHUB_SHA" \]\]/u);
  assert.match(source, /Release разрешён только вручную из main или через release-run/u);
});

test('release uses native job dependencies and exact current main', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /^  release-gate:/mu);
  assert.match(source, /needs: \[preflight, verify, browser\]/u);
  assert.match(source, /^    needs: release-gate$/mu);
  assert.match(source, /git\/ref\/heads\/main/u);
  assert.match(source, /\[\[ "\$MAIN_SHA" == "\$GITHUB_SHA" \]\]/u);
  assert.match(source, /\[\[ "\$MAIN_SHA" == "\$SOURCE_SHA" \]\]/u);
});

test('release never polls or redispatches external Actions', async () => {
  const source = await text('.github/workflows/release.yml');
  for (const forbidden of [
    /gh workflow run/u,
    /actions\/runs/u,
    /workflow_run:/u,
    /required=\(/u,
    /recovered_from/u,
    /sleep\s+\d+/u,
    /actions: write/u
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('release project verification is not duplicated inside the publisher', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.equal(count(source, /npm run check/g), 1);
  assert.equal(count(source, /npm test/g), 1);
  assert.equal(count(source, /npm run smoke/g), 1);
  assert.equal(count(source, /npm run backup:selftest/g), 1);
  assert.equal(count(source, /npx playwright install --with-deps chromium/g), 1);
});

test('draft publication is verified by release id and stale failed drafts are removed', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /select\(\.tag_name == \$tag and \.draft == true\) \| \.id/u);
  assert.match(source, /gh api --method DELETE "repos\/\$GITHUB_REPOSITORY\/releases\/\$DRAFT_ID"/u);
  assert.match(source, /RELEASE_ID=.*select\(\.tag_name == \$tag and \.draft == true and \.target_commitish == \$sha\)/su);
  assert.match(source, /echo "RELEASE_ID=\$RELEASE_ID" >> "\$GITHUB_ENV"/u);
  assert.match(source, /RELEASE_JSON="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"\)"/u);
  assert.match(source, /\[\[ "\$\(jq -r '\.target_commitish' <<<"\$RELEASE_JSON"\)" == "\$SOURCE_SHA" \]\]/u);
  assert.doesNotMatch(source, /RELEASE_JSON="\$\(gh api "repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$TAG"\)"/u);
});
