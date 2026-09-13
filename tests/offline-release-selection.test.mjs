import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceWrapper = new URL('../scripts/offline/install-from-archive.sh', import.meta.url);

async function makeBundle(root, name, profile) {
  const stage = join(root, `stage-${name.replace(/[^a-z0-9]/giu, '-')}`);
  const bundleRoot = join(stage, 'kafedra-planner-test', 'os-packages');
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(join(bundleRoot, 'source-os.env'), [
    `OS_FAMILY=${profile.family}`,
    `OS_ID=${profile.id}`,
    `OS_VERSION_ID=${profile.version}`,
    `DEB_ARCHITECTURE=${profile.arch}`,
    'DEPENDENCY_CLOSURE=full-airgap-v2',
    'TARGET_INSTALL_POLICY=additive-only-v2',
    ''
  ].join('\n'));
  const archive = join(root, name);
  const tar = spawnSync('tar', ['-czf', archive, '-C', stage, 'kafedra-planner-test'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  return archive;
}

async function fixture(t, osRelease, bundles) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-release-select-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const wrapper = join(root, 'install-kafedra-planner.sh');
  await copyFile(sourceWrapper, wrapper);
  const releaseFile = join(root, 'os-release');
  await writeFile(releaseFile, osRelease);
  for (const bundle of bundles) await makeBundle(root, bundle.name, bundle.profile);
  return { root, wrapper, releaseFile };
}

function select({ wrapper, releaseFile }) {
  return spawnSync('bash', [wrapper, '--print-selection'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAFEDRA_OS_RELEASE_FILE: releaseFile,
      KAFEDRA_DPKG_ARCHITECTURE: 'amd64'
    }
  });
}

const profiles = [
  { name: 'kafedra-planner-0.4.5-debian-12-amd64.tar.gz', profile: { family: 'debian', id: 'debian', version: '12', arch: 'amd64' } },
  { name: 'kafedra-planner-0.4.5-astra-1.7.5-amd64.tar.gz', profile: { family: 'astra', id: 'astra', version: '1.7.5', arch: 'amd64' } },
  { name: 'kafedra-planner-0.4.5-astra-1.8.1-amd64.tar.gz', profile: { family: 'astra', id: 'astra', version: '1.8.1', arch: 'amd64' } }
];

test('generic installer selects the unique Astra 1.7 archive by embedded source profile', async (t) => {
  const f = await fixture(t, 'ID=astra\nNAME="Astra Linux Special Edition"\nVERSION_ID="1.7.6"\n', profiles);
  const result = select(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(basename(result.stdout.trim()), profiles[1].name);
});

test('generic installer selects Astra 1.8 and Debian 12 independently', async (t) => {
  const astra = await fixture(t, 'ID=astra\nPRETTY_NAME="Astra Linux Special Edition"\nVERSION_ID="1.8.2"\n', profiles);
  let result = select(astra);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(basename(result.stdout.trim()), profiles[2].name);

  const debian = await fixture(t, 'ID=debian\nVERSION_ID="12.11"\n', profiles);
  result = select(debian);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(basename(result.stdout.trim()), profiles[0].name);
});

test('generic installer fails before installation when no compatible archive exists', async (t) => {
  const f = await fixture(t, 'ID=astra\nNAME="Astra Linux"\nVERSION_ID="1.8"\n', [profiles[0], profiles[1]]);
  const result = select(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Нет совместимого offline bundle/u);
  assert.match(result.stderr, /Доступные архивы/u);
});

test('generic installer rejects ambiguous compatible archives instead of picking the first file', async (t) => {
  const duplicate = {
    name: 'kafedra-planner-0.4.5-astra-1.7-second-amd64.tar.gz',
    profile: { family: 'astra', id: 'astra', version: '1.7.9', arch: 'amd64' }
  };
  const f = await fixture(t, 'ID=astra\nNAME="Astra Linux"\nVERSION_ID="1.7.5"\n', [profiles[1], duplicate]);
  const result = select(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Найдено несколько совместимых offline bundle/u);
});
