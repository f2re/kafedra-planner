import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');
const version = '0.4.3';

test('0.4.3 синхронизирован в версии, lockfile и release-документах', async () => {
  assert.equal((await text('VERSION')).trim(), version);
  assert.equal(JSON.parse(await text('package.json')).version, version);
  const lock = JSON.parse(await text('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);

  const markers = [
    ['README.md', 'Текущий рубеж: **`0.4.3`**'],
    ['README.en.md', 'Current milestone: **`0.4.3`**'],
    ['docs/ROADMAP.md', '## Текущий рубеж — `0.4.3`'],
    ['docs/UX_FLOWS.md', 'Статус: рабочие контуры версии `0.4.3`'],
    ['docs/VALIDATION.md', 'Актуальный рубеж: `0.4.3`'],
    ['docs/RELEASE_CANDIDATE.md', '# Release candidate 0.4.3'],
    ['docs/TARGET_ACCEPTANCE.md', 'Kafedra Planner 0.4.3, schema SQLite 31'],
    ['docs/releases/0.4.3.md', '# Kafedra Planner 0.4.3']
  ];
  for (const [path, marker] of markers) assert.ok((await text(path)).includes(marker), `${path} должен содержать ${marker}`);
});

test('0.4.3 включает годовой импорт протоколов без schema change', async () => {
  const meetings = await text('docs/MEETINGS.md');
  const readme = await text('README.md');
  const migrationFiles = await import('node:fs/promises').then(({ readdir }) => readdir('migrations'));
  assert.match(meetings, /Протоколы за год/u);
  assert.match(meetings, /Готово|готово/u);
  assert.match(meetings, /Нужно проверить|проверить/u);
  assert.match(readme, /пакетн\w* загрузк\w* протокол/u);
  assert.equal(migrationFiles.some((name) => /^032_/u.test(name)), false);
});

test('0.4.3 публикуется универсальным build-once pipeline', async () => {
  const gate = await text('.github/workflows/release-gate.yml');
  const publisher = await text('.github/workflows/release.yml');
  const deploy = await text('scripts/offline/systemd-deploy-selftest.sh');
  assert.match(gate, /^name: Release gate$/mu);
  assert.match(gate, /tests\/browser\/protocol-import\.spec\.mjs/u);
  assert.match(publisher, /workflows: \["Release gate"\]/u);
  assert.match(publisher, /systemd-deploy-selftest\.sh "\$OUT"/u);
  assert.doesNotMatch(publisher, /gh workflow run/u);
  assert.doesNotMatch(publisher, /npm test/u);
  assert.match(deploy, /forced-core-rollback/u);
});
