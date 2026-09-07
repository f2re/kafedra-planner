import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('опубликованный 0.4.3 остаётся отдельным неизменяемым историческим выпуском', async () => {
  const note = await text('docs/releases/0.4.3.md');
  assert.match(note, /^# Kafedra Planner 0\.4\.3$/mu);
  assert.match(note, /Протоколы за год/u);
  assert.match(note, /schema[^\n]*31|схем[^\n]*31/iu);
});

test('годовой импорт, выпущенный в 0.4.3, не регрессирует', async () => {
  const meetings = await text('docs/MEETINGS.md');
  const imports = await text('packages/protocols/src/protocol-imports.mjs');
  const ui = await text('public/protocol-import.js');

  assert.match(meetings, /Протоколы за год/u);
  assert.match(imports, /protocol-year:/u);
  assert.match(imports, /needs_review/u);
  assert.match(ui, /Загрузить протоколы|protocol-import-input/u);
  assert.match(ui, /idempotency-key/u);
});

test('текущий release workflow остаётся version-neutral после 0.4.3', async () => {
  const release = await text('.github/workflows/release.yml');
  assert.match(release, /^name: Release$/mu);
  assert.match(release, /^on:\n  workflow_dispatch:\n  push:\n    branches: \[release-run\]$/mu);
  assert.doesNotMatch(release, /Release gate 0\.4\.3/u);
  assert.doesNotMatch(release, /^  (?:pull_request|workflow_run):/mu);
  assert.doesNotMatch(release, /^    branches: \[main\]$/mu);
  await assert.rejects(text('.github/workflows/release-gate.yml'), (error) => error?.code === 'ENOENT');
});
