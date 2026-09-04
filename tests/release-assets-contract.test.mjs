import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('универсальный publisher публикует только проверенный build-once набор из семи assets', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /--target "\$SOURCE_SHA"/u);
  assert.match(source, /Собрать полный автономный bundle один раз/u);
  assert.match(source, /bash scripts\/offline\/systemd-deploy-selftest\.sh "\$OUT"/u);
  assert.match(source, /--archive "\$ARCHIVE"/u);
  assert.match(source, /"\$ARCHIVE\.sha256"/u);
  assert.match(source, /install-kafedra-planner\.sh/u);
  assert.match(source, /README-INSTALL\.txt/u);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-project-control\.f2re\.zip/u);
  assert.match(source, /SHA256SUMS/u);
  assert.match(source, /sha256sum -c --strict SHA256SUMS/u);
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /gh release upload "\$TAG"/u);
  assert.match(source, /EXPECTED="\$\(printf '%s\\n'/u);
  assert.match(source, /Набор release assets отличается от проверенного/u);
  assert.match(source, /\.assets\[\]\.name/u);
  assert.match(source, /\.assets\[\] \| select\(\.size <= 0\)/u);
  assert.match(source, /--draft=false --prerelease=false --latest/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
  assert.doesNotMatch(source, /gh workflow run/u);
  assert.doesNotMatch(source, /npm test/u);
});
