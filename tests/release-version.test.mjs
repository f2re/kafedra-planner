import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const version = (await read('VERSION')).trim();
const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
const readme = await read('README.md');
const roadmap = await read('docs/ROADMAP.md');
const notes = await read('docs/RELEASE_0.4.1.md');

test('authoritative committed metadata identifies release 0.4.1', () => {
  assert.equal(version, '0.4.1');
  assert.equal(packageJson.version, '0.4.1');
  assert.equal(packageLock.version, '0.4.1');
  assert.equal(packageLock.packages?.['']?.version, '0.4.1');
  assert.match(readme, /0\.4\.1/u);
  assert.match(roadmap, /Текущий рубеж — `0\.4\.1`/u);
});

test('release notes describe only the selected merged user-visible scope', () => {
  assert.match(notes, /Unicode-safe/u);
  assert.match(notes, /Оформлятора/u);
  assert.match(notes, /Текущие \| Архив/u);
  assert.match(notes, /Мобильные режимы не добавлялись/u);
  assert.match(notes, /SQLite schema остаётся `31`/u);
  assert.match(notes, /не являются draft или prerelease/u);
});

test('temporary version updater is absent from the release tree', async () => {
  await assert.rejects(
    access(new URL('.github/workflows/release-prepare-0.4.1.yml', root), constants.F_OK),
    { code: 'ENOENT' }
  );
});
