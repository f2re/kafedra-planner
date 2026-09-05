import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('опубликованный 0.4.2 остаётся отдельным неизменяемым историческим выпуском', async () => {
  const note = await text('docs/releases/0.4.2.md');
  assert.match(note, /^# Kafedra Planner 0\.4\.2$/mu);
  assert.match(note, /Оформлятор/u);
  assert.match(note, /schema[^\n]*31|схем[^\n]*31/iu);
});

test('текущий release workflow остаётся version-neutral после 0.4.2', async () => {
  const release = await text('.github/workflows/release.yml');
  assert.match(release, /^name: Release$/mu);
  assert.match(release, /^on:\n  workflow_dispatch:\n/mu);
  assert.doesNotMatch(release, /Release gate 0\.4\.2/u);
  await assert.rejects(text('.github/workflows/release-gate.yml'), (error) => error?.code === 'ENOENT');
});

test('операторский контракт, введённый в 0.4.2, не регрессирует', async () => {
  const readme = await text('README.md');
  const docomator = await text('docs/DOCOMATOR_PEOPLE_IMPORT.md');
  const integration = await text('public/docomator-integration.js');
  const transport = await text('packages/integrations/src/docomator.mjs');
  const archiveInstaller = await text('scripts/offline/install-from-archive.sh');
  const transactionInstaller = await text('deploy/install.sh');
  const http = await text('apps/api/src/http-utils.mjs');

  assert.match(readme, /systemctl restart kafedra-planner-api\.service kafedra-planner-worker\.service/u);
  assert.match(docomator, /Адрес Оформлятора/u);
  assert.match(integration, /name="url"/u);
  assert.match(integration, />Подключить</u);
  assert.match(transport, /new Set\(\['ok', 'ready'\]\)/u);
  assert.match(archiveInstaller, /--no-same-owner/u);
  assert.match(archiveInstaller, /--no-same-permissions/u);
  assert.doesNotMatch(archiveInstaller, /chown -R root:root "\$ROOT"/u);
  assert.match(transactionInstaller, /public\/docomator-integration\.js/u);
  assert.match(http, /'cache-control': 'no-store'/u);
});
