import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('release publishes exactly the verified canonical assets', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /--target "\$SOURCE_SHA"/u);
  assert.match(source, /"\$ARCHIVE"/u);
  assert.match(source, /"\$ARCHIVE\.sha256"/u);
  assert.match(source, /"\$OUT\/install-kafedra-planner\.sh"/u);
  assert.match(source, /"\$OUT\/README-INSTALL\.txt"/u);
  assert.match(source, /"\$PACKAGE"/u);
  assert.match(source, /"\$PACKAGE\.sha256"/u);
  assert.match(source, /"\$OUT\/SHA256SUMS"/u);
  assert.match(source, /sha256sum -c --strict SHA256SUMS/u);
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /gh release upload "\$TAG" --repo "\$GITHUB_REPOSITORY"/u);
  assert.match(source, /"\$ACTUAL" == "\$EXPECTED"/u);
  assert.match(source, /select\(\.size <= 0\)/u);
  assert.match(source, /gh release edit "\$TAG" --repo "\$GITHUB_REPOSITORY" --draft=false --prerelease=false --latest/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
  assert.doesNotMatch(source, /--prerelease(?:\s|$)/u);
});

test('Project Control is created from the same archive after deployment verification', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  const deploy = source.indexOf('systemd-deploy-selftest.sh "$OUT"');
  const packageBuild = source.indexOf('--archive "$ARCHIVE"');
  assert.ok(deploy >= 0 && packageBuild > deploy);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-project-control\.f2re\.zip/u);
});
