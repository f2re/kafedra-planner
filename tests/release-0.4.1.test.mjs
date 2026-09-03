import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('опубликованный 0.4.1 остаётся отдельным неизменяемым историческим выпуском', async () => {
  const note = await text('docs/releases/0.4.1.md');
  assert.match(note, /^# Kafedra Planner 0\.4\.1$/mu);
  assert.match(note, /kafedra-planner-0\.4\.1-debian-12-amd64\.tar\.gz/u);
  assert.match(note, /kafedra-planner-0\.4\.1-project-control\.f2re\.zip/u);
  assert.match(note, /Tag и assets версии `0\.4\.0` не изменяются\./u);
});

test('publisher хранит 0.4.1 только как неактивный compatibility marker', async () => {
  const publisher = await text('.github/workflows/release.yml');
  assert.match(publisher, /^    # workflows: \["Release gate 0\.4\.1"\]$/mu);
  assert.doesNotMatch(publisher, /^    workflows: \["Release gate 0\.4\.1"\]$/mu);
});
