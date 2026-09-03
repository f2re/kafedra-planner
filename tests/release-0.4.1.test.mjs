import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('release 0.4.1 synchronizes every authoritative version marker', async () => {
  const version = (await text('VERSION')).trim();
  const packageJson = JSON.parse(await text('package.json'));
  const lock = JSON.parse(await text('package-lock.json'));
  assert.equal(version, '0.4.1');
  assert.equal(packageJson.version, '0.4.1');
  assert.equal(lock.version, '0.4.1');
  assert.equal(lock.packages[''].version, '0.4.1');
});

test('release documentation identifies the completed patch scope', async () => {
  for (const path of [
    'README.md',
    'README.en.md',
    'docs/ROADMAP.md',
    'docs/UX_FLOWS.md',
    'docs/VALIDATION.md',
    'docs/RELEASE_CANDIDATE.md',
    'docs/TARGET_ACCEPTANCE.md',
    'docs/releases/0.4.1.md'
  ]) {
    assert.match(await text(path), /0\.4\.1/u, `${path} must identify 0.4.1`);
  }
  const ux = await text('docs/UX_FLOWS.md');
  assert.match(ux, /Текущие \| Архив/u);
  assert.match(ux, /721 px/u);
  assert.match(ux, /720 px/u);
});

test('release publisher is wired to the 0.4.1 gate and exact-head GRACE', async () => {
  const gate = await text('.github/workflows/release-gate.yml');
  const publisher = await text('.github/workflows/release.yml');
  assert.match(gate, /^name: Release gate 0\.4\.1$/mu);
  assert.match(publisher, /^\s{4}workflows: \["Release gate 0\.4\.1"\]$/mu);
  assert.match(publisher, /required=\(\n\s+"GRACE"/u);
  assert.match(publisher, /\["GRACE"\]="grace\.yml"/u);
});
