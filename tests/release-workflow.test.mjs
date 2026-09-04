import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('release gate and publisher are version-neutral', async () => {
  const gate = await text('.github/workflows/release-gate.yml');
  const publisher = await text('.github/workflows/release.yml');
  assert.match(gate, /^name: Release gate$/mu);
  assert.match(publisher, /^    workflows: \["Release gate"\]$/mu);
  assert.doesNotMatch(gate, /^name: Release gate \d+\.\d+\.\d+$/mu);
  assert.doesNotMatch(publisher, /workflows: \["Release gate \d+\.\d+\.\d+"\]/u);
});

test('heavy release gate runs on main, not every feature pull request', async () => {
  const gate = await text('.github/workflows/release-gate.yml');
  assert.match(gate, /push:\n\s+branches: \[main\]/u);
  assert.match(gate, /workflow_dispatch:/u);
  assert.doesNotMatch(gate, /pull_request:/u);
  assert.match(gate, /tests\/browser\/protocol-import\.spec\.mjs/u);
  assert.match(gate, /npm run backup:selftest/u);
});

test('publisher consumes gate evidence without workflow fan-in or duplicate test suites', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.doesNotMatch(source, /required=\(/u);
  assert.doesNotMatch(source, /gh workflow run/u);
  assert.doesNotMatch(source, /npm test/u);
  assert.doesNotMatch(source, /playwright test/u);
  assert.match(source, /main изменился: ожидался \$SOURCE_SHA/u);
  assert.match(source, /Собрать полный автономный bundle один раз/u);
  assert.match(source, /systemd-deploy-selftest\.sh "\$OUT"/u);
  assert.match(source, /project-control-package\.py/u);
});

test('publisher creates a safe draft on exact SHA, checks seven assets and verifies the tag', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--target "\$SOURCE_SHA"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /README-INSTALL\.txt/u);
  assert.match(source, /SHA256SUMS/u);
  assert.match(source, /Набор release assets отличается от проверенного/u);
  assert.match(source, /gh release edit "\$TAG" .*--draft=false --prerelease=false --latest/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
});
