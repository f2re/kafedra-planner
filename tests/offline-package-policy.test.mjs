import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { systemRequirements } from '../packages/system/src/preflight.mjs';

const run = promisify(execFile);
const collector = await readFile(new URL('../scripts/offline/collect-os-packages.sh', import.meta.url), 'utf8');
const installer = await readFile(new URL('../scripts/offline/install-os-packages.sh', import.meta.url), 'utf8');
const packageCache = await readFile(new URL('../scripts/offline/cache-os-packages.sh', import.meta.url), 'utf8');
const lib = await readFile(new URL('../scripts/offline/lib.sh', import.meta.url), 'utf8');
const deployment = await readFile(new URL('../scripts/offline/deployment-contract.mjs', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../scripts/offline/doctor.sh', import.meta.url), 'utf8');
const deployCore = await readFile(new URL('../deploy/install-core.sh', import.meta.url), 'utf8');
const preflightCli = await readFile(new URL('../scripts/system-preflight.mjs', import.meta.url), 'utf8');
const packageProfile = await readFile(new URL('../config/offline/os-packages.txt', import.meta.url), 'utf8');
const packageCachePath = resolve('scripts/offline/cache-os-packages.sh');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function currentOsProfile() {
  const script = `source ${JSON.stringify(resolve('scripts/offline/lib.sh'))}; detect_os_profile /etc/os-release`;
  const { stdout } = await run('bash', ['-lc', script]);
  const [family, id, version, architecture] = stdout.trimEnd().split('\n');
  assert.ok(family && id && version && architecture, `incomplete OS profile: ${stdout}`);
  return { family, id, version, architecture };
}

async function createPackagePayload(work) {
  const payload = join(work, 'payload');
  const packageRoot = join(work, 'deb-root');
  const controlRoot = join(packageRoot, 'DEBIAN');
  await mkdir(payload, { recursive: true });
  await mkdir(controlRoot, { recursive: true });
  await writeFile(join(controlRoot, 'control'), [
    'Package: kp-cache-fixture',
    'Version: 1.0',
    'Architecture: all',
    'Maintainer: Kafedra Planner tests',
    'Description: immutable package cache fixture',
    ''
  ].join('\n'));

  const fileName = 'kp-cache-fixture_1.0_all.deb';
  const debPath = join(payload, fileName);
  await run('dpkg-deb', ['--build', packageRoot, debPath]);
  const debDigest = sha256(await readFile(debPath));
  const requested = 'kp-cache-fixture\n';
  await writeFile(join(payload, 'requested-packages.txt'), requested);
  await writeFile(join(payload, 'manifest.sha256'), `${debDigest}  ${fileName}\n`);
  await writeFile(
    join(payload, 'packages.tsv'),
    `sha256\tpackage\tversion\tarchitecture\tfilename\n${debDigest}\tkp-cache-fixture\t1.0\tall\t${fileName}\n`
  );

  const profile = await currentOsProfile();
  await writeFile(join(payload, 'source-os.env'), [
    `OS_FAMILY=${profile.family}`,
    `OS_ID=${profile.id}`,
    `OS_VERSION_ID=${profile.version}`,
    `DEB_ARCHITECTURE=${profile.architecture}`,
    'DEPENDENCY_CLOSURE=full-airgap-v2',
    'TARGET_INSTALL_POLICY=additive-only-v2',
    'REFERENCE_APT_CHECK=passed',
    'APT_INSTALL_RECOMMENDS=false',
    `REQUESTED_PACKAGES_SHA256=${sha256(requested)}`,
    ''
  ].join('\n'));
  return payload;
}

test('build package layer requires healthy reference APT and publishes additive-only-v2 policy', () => {
  assert.match(collector, /apt-get check/u);
  assert.match(collector, /DEPENDENCY_CLOSURE=full-airgap-v2/u);
  assert.match(collector, /TARGET_INSTALL_POLICY=additive-only-v2/u);
  assert.match(collector, /REFERENCE_APT_CHECK=passed/u);
  assert.match(collector, /Dir::State::status=\$WORK\/empty-status/u);
  assert.match(lib, /TARGET_INSTALL_POLICY.*additive-only-v2/u);
  assert.match(deployment, /FORMAT_VERSION = 2/u);
  assert.match(deployment, /full-airgap-v2/u);
  assert.match(deployment, /additive-only-v2/u);
});

test('verified OS payload cache is profile-bound, atomic and never overwrites an immutable entry', () => {
  assert.match(packageCache, /KAFEDRA_OS_PACKAGE_CACHE_ROOT/u);
  assert.match(packageCache, /verify_os_package_set "\$SOURCE" 1/u);
  assert.match(packageCache, /sha256_of "\$SOURCE\/manifest\.sha256"/u);
  assert.match(packageCache, /mktemp -d/u);
  assert.match(packageCache, /mv -T -n/u);
  assert.match(packageCache, /chmod 0555 "\$TEMP"/u);
  assert.doesNotMatch(packageCache, /rm -rf -- "\$DESTINATION"/u);
  assert.ok(
    packageCache.indexOf('verify_os_package_set "$SOURCE" 1')
      < packageCache.indexOf('install -d -m 0755 "$KAFEDRA_OS_PACKAGE_CACHE_ROOT"'),
    'payload must be verified before the cache root is written'
  );
});

test('verified OS payload is cached once and corruption is rejected without replacement', async () => {
  const work = await mkdtemp(join(tmpdir(), 'kafedra-package-cache-'));
  try {
    const payload = await createPackagePayload(work);
    const cacheRoot = join(work, 'cache');
    const options = {
      env: { ...process.env, KAFEDRA_OS_PACKAGE_CACHE_ROOT: cacheRoot }
    };

    const first = await run('bash', [packageCachePath, payload], options);
    const destination = first.stdout.trim();
    assert.ok(destination.startsWith(`${cacheRoot}/`), destination);
    assert.equal((await stat(destination)).mode & 0o222, 0);
    for (const name of await readdir(destination)) {
      assert.equal((await stat(join(destination, name))).mode & 0o222, 0, `${name} must be read-only`);
    }

    const second = await run('bash', [packageCachePath, payload], options);
    assert.equal(second.stdout.trim(), destination);
    assert.deepEqual((await readdir(dirname(destination))).sort(), [basename(destination)]);

    const inventory = join(destination, 'packages.tsv');
    await chmod(destination, 0o755);
    await chmod(inventory, 0o644);
    await writeFile(inventory, 'corrupted inventory\n');
    await chmod(inventory, 0o444);
    await chmod(destination, 0o555);

    await assert.rejects(() => run('bash', [packageCachePath, payload], options));
    assert.equal(await readFile(inventory, 'utf8'), 'corrupted inventory\n');
  } finally {
    await run('chmod', ['-R', 'u+w', work]).catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
});

test('target installer is capability-aware and never repairs or replaces installed OS packages', () => {
  assert.match(installer, /apt-get check/u);
  assert.match(installer, /--no-remove --no-upgrade --no-install-recommends/u);
  assert.match(installer, /assert_additive_apt_plan/u);
  assert.match(installer, /SAFE_DEGRADED_EXIT=20/u);
  assert.match(installer, /FATAL_TRANSACTION_EXIT=70/u);
  assert.match(installer, /has_command unzip \|\| add_needed unzip/u);
  assert.match(installer, /has_command pdftotext \|\| add_needed poppler-utils/u);
  assert.match(installer, /tesseract --list-langs/u);
  assert.match(installer, /has_command soffice/u);
  assert.doesNotMatch(installer, /^\s*(?:sudo\s+)?apt(?:-get)?[^\n]*--fix-broken/mu);
  assert.doesNotMatch(installer, /--allow-downgrades/u);
  assert.doesNotMatch(installer, /apt-get[^\n]*=[0-9]/u);
  assert.doesNotMatch(installer, /"\$\{requested\[@\]\}"[^\n]*install/u);
});

test('APT simulation guard rejects removal and replacement of installed packages', async () => {
  const work = await mkdtemp(join(tmpdir(), 'kafedra-apt-plan-'));
  try {
    const safe = join(work, 'safe.txt');
    const upgrade = join(work, 'upgrade.txt');
    const removal = join(work, 'remove.txt');
    await writeFile(safe, 'Inst tesseract-ocr (5.3.0 Debian:12/stable [amd64])\n');
    await writeFile(upgrade, 'Inst libc6 [2.36-old] (2.36-new Debian:12/stable [amd64])\n');
    await writeFile(removal, 'Remv perl [5.36]\n');
    const script = `source ${JSON.stringify(resolve('scripts/offline/lib.sh'))}; assert_additive_apt_plan "$1"`;
    await run('bash', ['-lc', script, '_', safe]);
    await assert.rejects(() => run('bash', ['-lc', script, '_', upgrade]));
    await assert.rejects(() => run('bash', ['-lc', script, '_', removal]));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('document converters can degrade while strict full acceptance still requires all of them', () => {
  for (const id of ['unzip', 'pdftotext', 'pdftoppm', 'tesseract', 'libreoffice']) {
    assert.equal(systemRequirements.find((item) => item.id === id)?.required, false, `${id} must be optional for core startup`);
  }
  for (const id of ['tar', 'sha256sum', 'systemctl', 'runuser', 'useradd']) {
    assert.equal(systemRequirements.find((item) => item.id === id)?.required, true, `${id} must remain required`);
  }
  assert.match(preflightCli, /!result\.capabilities\.officeExtract/u);
  assert.match(preflightCli, /!result\.capabilities\.pdfText/u);
  assert.match(preflightCli, /!result\.capabilities\.ocr/u);
  assert.match(preflightCli, /!result\.capabilities\.officePreview/u);
  assert.match(deployCore, /install-os-packages\.sh" "\$BUNDLE_ROOT\/os-packages" --scope all/u);
  assert.match(deployCore, /KAFEDRA_DOCTOR_ALLOW_DEGRADED=true/u);
  assert.match(deployCore, /PACKAGE_STATUS >= 70/u);
  assert.match(deployCore, /PACKAGE_STATUS == 20/u);
  assert.match(doctor, /KAFEDRA_DOCTOR_ALLOW_DEGRADED/u);
  assert.match(doctor, /--require-full/u);
});

test('top-level package profile contains only application document capabilities', () => {
  const packages = packageProfile
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*/u, '').trim())
    .filter(Boolean);
  assert.deepEqual(packages, [
    'unzip',
    'poppler-utils',
    'tesseract-ocr',
    'tesseract-ocr-rus',
    'tesseract-ocr-eng',
    'libreoffice-core',
    'libreoffice-writer',
    'libreoffice-calc',
    'fontconfig',
    'fonts-dejavu-core'
  ]);
  for (const basePackage of ['systemd', 'coreutils', 'util-linux', 'passwd', 'tar', 'libc6', 'perl-base']) {
    assert.equal(packages.includes(basePackage), false);
  }
});

test('Astra Linux profile compatibility matches same series and rejects cross-series/cross-family', async () => {
  const script = `source ${JSON.stringify(resolve('scripts/offline/lib.sh'))}; os_profiles_compatible "$@"`;
  // Astra 1.7 series compatibility across update levels
  await run('bash', ['-lc', script, '_', 'astra', 'astra', '1.7_x86-64', 'amd64', 'astra', 'astra', '1.7.5_x86-64', 'amd64']);
  await run('bash', ['-lc', script, '_', 'astra', 'astra', '1.7', 'amd64', 'astra', 'astra', '1.7.4_x86-64', 'amd64']);
  // Astra 1.8 series compatibility
  await run('bash', ['-lc', script, '_', 'astra', 'astra', '1.8_x86-64', 'amd64', 'astra', 'astra', '1.8.1', 'amd64']);
  // Debian 12 compatibility
  await run('bash', ['-lc', script, '_', 'debian', 'debian', '12', 'amd64', 'debian', 'debian', '12.8', 'amd64']);
  // Cross-series and cross-family rejections
  await assert.rejects(() => run('bash', ['-lc', script, '_', 'astra', 'astra', '1.7_x86-64', 'amd64', 'astra', 'astra', '1.8_x86-64', 'amd64']));
  await assert.rejects(() => run('bash', ['-lc', script, '_', 'debian', 'debian', '12', 'amd64', 'astra', 'astra', '1.7_x86-64', 'amd64']));
  await assert.rejects(() => run('bash', ['-lc', script, '_', 'astra', 'astra', '1.7_x86-64', 'amd64', 'astra', 'astra', '1.7_x86-64', 'arm64']));
});

test('doctor script provides automated remediation mode and diagnose flag', () => {
  assert.match(doctor, /--repair/u);
  assert.match(doctor, /--auto-repair/u);
  assert.match(doctor, /--diagnose-apt/u);
  assert.match(doctor, /dpkg --configure -a/u);
  assert.match(doctor, /apt-get check/u);
  assert.match(doctor, /install-os-packages\.sh/u);
  assert.match(deployCore, /NODE_EXEC_OUTPUT/u);
  assert.match(deployCore, /doctor\.sh --repair/u);
  assert.match(installer, /dpkg --configure -a/u);
});
