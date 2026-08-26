import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('publisher 0.3.3 публикует полный проверяемый набор release assets', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /--target "\$SOURCE_SHA"/u);
  assert.match(source, /"\$ARCHIVE"/u);
  assert.match(source, /"\$ARCHIVE\.sha256"/u);
  assert.match(source, /install-kafedra-planner\.sh/u);
  assert.match(source, /README-INSTALL\.txt/u);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-project-control\.f2re\.zip/u);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-project-control\.f2re\.zip\.sha256/u);
  assert.match(source, /SHA256SUMS/u);
  assert.match(source, /sha256sum -c --strict SHA256SUMS/u);
  assert.match(source, /\.assets \| length' <<<"\$RELEASE"\)" -ge 7/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
  assert.match(source, /--latest/u);
  assert.doesNotMatch(source, /--prerelease/u);
});
