import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  parseVersion,
  requiredOfflineNodeVersion,
  requiredOfflineRuntimePolicy,
  satisfiesNodeEngine
} from '../scripts/offline/runtime-contract.mjs';

const packagePolicy = {
  engines: { node: '>=24.15.0 <25' },
  kafedra: {
    offlineRuntime: {
      node: '24.19.0',
      distBaseUrl: 'https://nodejs.org/dist',
      archives: {
        'linux-x64': {
          file: 'node-v24.19.0-linux-x64.tar.gz',
          sha256: 'f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4'
        },
        'linux-arm64': {
          file: 'node-v24.19.0-linux-arm64.tar.gz',
          sha256: 'd28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f'
        }
      }
    }
  }
};

test('контракт версий сравнивает semver без зависимости от host Node', () => {
  assert.deepEqual(parseVersion('v24.19.0'), [24, 19, 0]);
  assert.deepEqual(parseVersion('25.6.0'), [25, 6, 0]);
  assert.equal(compareVersions('24.19.0', '24.15.0'), 1);
  assert.equal(compareVersions('24.15.0', '24.15.0'), 0);
});

test('runtime приложения ограничен LTS 24, но это не ограничение версии host сборщика', () => {
  const engine = '>=24.15.0 <25';
  assert.equal(satisfiesNodeEngine('24.15.0', engine), true);
  assert.equal(satisfiesNodeEngine('24.19.0', engine), true);
  assert.equal(satisfiesNodeEngine('24.14.1', engine), false);
  assert.equal(satisfiesNodeEngine('25.6.0', engine), false);
  assert.equal(satisfiesNodeEngine('26.0.0', engine), false);
});

test('версия runtime поставки задаётся отдельно и должна входить в engines.node', () => {
  assert.equal(requiredOfflineNodeVersion(packagePolicy), '24.19.0');
  assert.throws(
    () => requiredOfflineNodeVersion({ ...packagePolicy, kafedra: { offlineRuntime: { ...packagePolicy.kafedra.offlineRuntime, node: '25.6.0' } } }),
    /не входит в engines\.node/u
  );
});

test('policy фиксирует официальный Linux runtime и digest для обеих архитектур', () => {
  const policy = requiredOfflineRuntimePolicy(packagePolicy);
  assert.equal(policy.version, '24.19.0');
  assert.equal(policy.archives['linux-x64'].file, 'node-v24.19.0-linux-x64.tar.gz');
  assert.match(policy.archives['linux-x64'].sha256, /^[0-9a-f]{64}$/u);
  assert.equal(policy.archives['linux-arm64'].file, 'node-v24.19.0-linux-arm64.tar.gz');
  assert.throws(
    () => requiredOfflineRuntimePolicy({
      ...packagePolicy,
      kafedra: {
        offlineRuntime: {
          ...packagePolicy.kafedra.offlineRuntime,
          archives: {
            ...packagePolicy.kafedra.offlineRuntime.archives,
            'linux-x64': { file: 'node-v24.19.0-linux-x64.tar.gz', sha256: 'bad' }
          }
        }
      }
    }),
    /SHA-256/u
  );
});
