import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');
const count = (source, pattern) => [...source.matchAll(pattern)].length;

test('release builds once and verifies deployment before packaging or publication', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.equal(count(source, /build-full-bundle\.sh/g), 1);
  assert.equal(count(source, /systemd-deploy-selftest\.sh "\$OUT"/g), 1);

  const build = source.indexOf('build-full-bundle.sh');
  const deploy = source.indexOf('systemd-deploy-selftest.sh "$OUT"');
  const projectControl = source.indexOf('project-control-package.py');
  const createRelease = source.indexOf('gh release create "$TAG"');
  assert.ok(build >= 0 && deploy > build, 'deployment self-test must follow the single build');
  assert.ok(projectControl > deploy, 'Project Control must be derived only after deployment verification');
  assert.ok(createRelease > projectControl, 'GitHub Release creation must follow artifact verification');
});

test('release deployment path reuses the same installer for install update and forced rollback evidence', async () => {
  const workflow = await text('.github/workflows/release.yml');
  const selftest = await text('scripts/offline/systemd-deploy-selftest.sh');
  assert.match(workflow, /Verify install, update and rollback of the same artifact/u);
  assert.match(selftest, /run_installer\(\)/u);
  assert.match(selftest, /Тот же комплект должен безопасно проходить как повторный update/u);
  assert.match(selftest, /Installer не откатился после принудительного сбоя llama-server/u);
  assert.match(selftest, /Rollback не вернул legacy current/u);
  assert.doesNotMatch(workflow, /gh workflow run/u);
  assert.doesNotMatch(workflow, /actions\/runs/u);
});

test('release stops if main changes before build or publication', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /Require exact current main before build/u);
  assert.match(source, /Require exact current main before publication/u);
  assert.ok(count(source, /git\/ref\/heads\/main/g) >= 3);
  assert.match(source, /публикация \$SOURCE_SHA запрещена/u);
});
