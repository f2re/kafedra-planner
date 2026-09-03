import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const version = '0.4.0';
const escapedVersion = version.replaceAll('.', '\\.');

const text = (path) => readFile(path, 'utf8');

test('release gate and publisher use the current release version', async () => {
  const gate = await text('.github/workflows/release-gate.yml');
  const publisher = await text('.github/workflows/release.yml');
  assert.match(gate, new RegExp(`^name: Release gate ${escapedVersion}$`, 'mu'));
  assert.match(
    publisher,
    new RegExp(`workflows: \\\["Release gate ${escapedVersion}"\\\]`, 'u')
  );
});

test('publisher waits for exact-head GRACE and preserves safe draft publication', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /required=\(\n\s+"GRACE"/u);
  assert.match(source, /\["GRACE"\]="grace\.yml"/u);
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /-F draft=false -f make_latest=true/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
});
