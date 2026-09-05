import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');
const version = '0.4.2';

test('0.4.2 синхронизирован в версии, lockfile и release-документах', async () => {
  assert.equal((await text('VERSION')).trim(), version);
  assert.equal(JSON.parse(await text('package.json')).version, version);
  const lock = JSON.parse(await text('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);

  const markers = [
    ['README.md', 'Текущий рубеж: **`0.4.2`**'],
    ['README.en.md', 'Current milestone: **`0.4.2`**'],
    ['docs/ROADMAP.md', '## Текущий рубеж — `0.4.2`'],
    ['docs/UX_FLOWS.md', 'Статус: рабочие контуры версии `0.4.2`'],
    ['docs/VALIDATION.md', 'Актуальный рубеж: `0.4.2`'],
    ['docs/RELEASE_CANDIDATE.md', '# Release candidate 0.4.2'],
    ['docs/TARGET_ACCEPTANCE.md', 'Kafedra Planner 0.4.2, schema SQLite 31'],
    ['docs/releases/0.4.2.md', '# Kafedra Planner 0.4.2']
  ];
  for (const [path, marker] of markers) {
    assert.ok((await text(path)).includes(marker), `${path} должен содержать ${marker}`);
  }
});

test('0.4.2 использует один ручной exact-main release workflow', async () => {
  const release = await text('.github/workflows/release.yml');
  assert.match(release, /^name: Release$/mu);
  assert.match(release, /^on:\n  workflow_dispatch:\n/mu);
  assert.match(release, /git\/ref\/heads\/main/u);
  assert.match(release, /--target "\$SOURCE_SHA"/u);
  assert.match(release, /\[\[ "\$OBJECT_SHA" == "\$SOURCE_SHA" \]\]/u);
  await assert.rejects(text('.github/workflows/release-gate.yml'), (error) => error?.code === 'ENOENT');
});

test('операторский контракт 0.4.2 содержит прямой URL, безопасное обновление и команды systemd', async () => {
  const readme = await text('README.md');
  const docomator = await text('docs/DOCOMATOR_PEOPLE_IMPORT.md');
  const integration = await text('public/docomator-integration.js');
  const transport = await text('packages/integrations/src/docomator.mjs');
  const archiveInstaller = await text('scripts/offline/install-from-archive.sh');
  const transactionInstaller = await text('deploy/install.sh');
  const http = await text('apps/api/src/http-utils.mjs');

  assert.match(readme, /systemctl restart kafedra-planner-api\.service kafedra-planner-worker\.service/u);
  assert.match(docomator, /Адрес Оформлятора/u);
  assert.match(docomator, /http:\/\/192\.168\.1\.50:8080/u);
  assert.match(integration, /name="url"/u);
  assert.match(integration, />Подключить</u);
  assert.match(transport, /new Set\(\['ok', 'ready'\]\)/u);
  assert.match(archiveInstaller, /--no-same-owner/u);
  assert.match(archiveInstaller, /--no-same-permissions/u);
  assert.doesNotMatch(archiveInstaller, /chown -R root:root "\$ROOT"/u);
  assert.match(transactionInstaller, /public\/docomator-integration\.js/u);
  assert.match(http, /'cache-control': 'no-store'/u);
});
