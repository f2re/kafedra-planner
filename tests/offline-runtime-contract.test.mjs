import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  parseVersion,
  satisfiesNodeEngine
} from '../scripts/offline/runtime-contract.mjs';

test('контракт разбирает версии Node.js', () => {
  assert.deepEqual(parseVersion('v24.18.0'), [24, 18, 0]);
  assert.deepEqual(parseVersion('25'), [25, 0, 0]);
  assert.equal(compareVersions('24.18.0', '24.15.0'), 1);
  assert.equal(compareVersions('24.15.0', '24.15.0'), 0);
});

test('контракт строго применяет engines.node проекта', () => {
  const engine = '>=24.15.0 <25';
  assert.equal(satisfiesNodeEngine('24.15.0', engine), true);
  assert.equal(satisfiesNodeEngine('24.18.0', engine), true);
  assert.equal(satisfiesNodeEngine('24.14.1', engine), false);
  assert.equal(satisfiesNodeEngine('25.0.0', engine), false);
});
