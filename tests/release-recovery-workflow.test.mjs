import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');
const count = (source, pattern) => [...source.matchAll(pattern)].length;

test('release builds every target once and verifies deployment before packaging or publication', async () => {
  const workflow = await text('.github/workflows/release.yml');
  const builder = await text('scripts/offline/build-release-targets.sh');
  const reference = await text('scripts/offline/reference-build.sh');
  const verifier = await text('scripts/offline/verify-release-targets.sh');
  assert.equal(count(workflow, /build-release-targets\.sh "\$OUT"/g), 1);
  assert.equal(count(workflow, /verify-release-targets\.sh "\$OUT"/g), 1);
  assert.equal(count(reference, /build-full-bundle\.sh/g), 1);
  assert.match(builder, /debian:12/u);
  assert.match(builder, /registry\.astralinux\.ru\/library\/astra\/ubi17:latest/u);
  assert.match(builder, /registry\.astralinux\.ru\/library\/astra\/ubi18:latest/u);
  assert.match(verifier, /KAFEDRA_SELFTEST_BASE_IMAGE="\$image"/u);

  const build = workflow.indexOf('build-release-targets.sh "$OUT"');
  const deploy = workflow.indexOf('verify-release-targets.sh "$OUT"');
  const projectControl = workflow.indexOf('project-control-package.py');
  const createRelease = workflow.indexOf('gh release create "$TAG"');
  assert.ok(build >= 0 && deploy > build, 'matching deployment self-test must follow target builds');
  assert.ok(projectControl > deploy, 'Project Control must be derived only after deployment verification');
  assert.ok(createRelease > projectControl, 'GitHub Release creation must follow artifact verification');
});

test('release deployment path reuses the same installer for install update rollback and cached repair evidence', async () => {
  const workflow = await text('.github/workflows/release.yml');
  const selftest = await text('scripts/offline/systemd-deploy-selftest.sh');
  assert.match(workflow, /Verify install, update and rollback of every same artifact/u);
  assert.match(selftest, /KAFEDRA_SELFTEST_BASE_IMAGE/u);
  assert.match(selftest, /run_installer\(\)/u);
  assert.match(selftest, /Тот же комплект должен безопасно проходить как повторный update/u);
  assert.match(selftest, /Installer не откатился после принудительного сбоя llama-server/u);
  assert.match(selftest, /Rollback не вернул legacy current/u);
  assert.match(selftest, /\/var\/cache\/kafedra-planner\/os-packages/u);
  assert.match(selftest, /doctor\.sh --repair/u);
  assert.doesNotMatch(workflow, /gh workflow run/u);
  assert.doesNotMatch(workflow, /actions\/runs/u);
});

test('GRACE runs the heavy target bundle gate only for offline deployment risk', async () => {
  const grace = await text('.github/workflows/grace.yml');
  assert.match(grace, /M-OFFLINE-BUNDLE/u);
  assert.match(grace, /Build and verify every supported target bundle/u);
  assert.match(grace, /build-release-targets\.sh "\$OUT"/u);
  assert.match(grace, /verify-release-targets\.sh "\$OUT"/u);
  assert.match(grace, /needs: \[contract, database, deployment\]/u);
});

test('release stops if main changes before build or publication', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /Require exact current main before build/u);
  assert.match(source, /Require exact current main before publication/u);
  assert.ok(count(source, /git\/ref\/heads\/main/g) >= 3);
  assert.match(source, /публикация \$SOURCE_SHA запрещена/u);
});
