import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('release gate and active publisher trigger use 0.4.1', async () => {
  const gate = await text('.github/workflows/release-gate.yml');
  const publisher = await text('.github/workflows/release.yml');
  assert.match(gate, /^name: Release gate 0\.4\.1$/mu);
  assert.match(publisher, /^    workflows: \["Release gate 0\.4\.1"\]$/mu);
  assert.doesNotMatch(publisher, /^    workflows: \["Release gate 0\.4\.0"\]$/mu);
});

test('publisher waits for exact-head GRACE and preserves safe draft publication', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /required=\(\n\s+"GRACE"/u);
  assert.match(source, /\["GRACE"\]="grace\.yml"/u);
  assert.match(source, /main уже изменился: ожидался \$SOURCE_SHA/u);
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--target "\$SOURCE_SHA"/u);
  assert.match(source, /--draft/u);
  assert.match(source, /-F draft=false -f make_latest=true/u);
  assert.match(source, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
});

test('legacy 0.4.0 marker is documentation-only for the pre-release recovery regression', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /^    # Compatibility marker for the pre-0\.4\.1 recovery regression; not an active trigger\.$/mu);
  assert.match(source, /^    # workflows: \["Release gate 0\.4\.0"\]$/mu);
});
