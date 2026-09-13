import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('release publishes the complete verified target-aware asset manifest', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /--target "\$SOURCE_SHA"/u);
  assert.match(source, /build-release-targets\.sh "\$OUT"/u);
  assert.match(source, /verify-release-targets\.sh "\$OUT"/u);
  assert.match(source, /\.release-targets\.tsv/u);
  assert.match(source, /\.release-assets\.txt/u);
  assert.match(source, /install-kafedra-planner\.sh/u);
  assert.match(source, /README-INSTALL\.txt/u);
  assert.match(source, /SHA256SUMS/u);
  assert.match(source, /sha256sum -c --strict SHA256SUMS/u);
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /gh release upload "\$TAG" --repo "\$GITHUB_REPOSITORY" "\$\{UPLOADS\[@\]\}"/u);
  assert.match(source, /"\$ACTUAL" == "\$EXPECTED"/u);
  assert.match(source, /select\(\.size <= 0\)/u);
  assert.match(source, /gh release edit "\$TAG" --repo "\$GITHUB_REPOSITORY" --draft=false --prerelease=false --latest/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
  assert.doesNotMatch(source, /seven verified assets/u);
  assert.doesNotMatch(source, /--prerelease(?:\s|$)/u);
});

test('Project Control is created only from already verified target archives', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  const deploy = source.indexOf('verify-release-targets.sh "$OUT"');
  const packageBuild = source.indexOf('project-control-package.py');
  assert.ok(deploy >= 0 && packageBuild > deploy);
  assert.match(source, /debian-12-amd64/u);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-\$\{TARGET\}-project-control\.f2re\.zip/u);
});
