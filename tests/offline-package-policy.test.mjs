import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { systemRequirements } from '../packages/system/src/preflight.mjs';

const run = promisify(execFile);
const collector = await readFile(new URL('../scripts/offline/collect-os-packages.sh', import.meta.url), 'utf8');
const installer = await readFile(new URL('../scripts/offline/install-os-packages.sh', import.meta.url), 'utf8');
const lib = await readFile(new URL('../scripts/offline/lib.sh', import.meta.url), 'utf8');
const deployment = await readFile(new URL('../scripts/offline/deployment-contract.mjs', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../scripts/offline/doctor.sh', import.meta.url), 'utf8');
const deploy = await readFile(new URL('../deploy/install.sh', import.meta.url), 'utf8');
const preflightCli = await readFile(new URL('../scripts/system-preflight.mjs', import.meta.url), 'utf8');
const packageProfile = await readFile(new URL('../config/offline/os-packages.txt', import.meta.url), 'utf8');

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
  assert.match(deploy, /install-os-packages\.sh" "\$BUNDLE_ROOT\/os-packages" --scope all/u);
  assert.match(deploy, /KAFEDRA_DOCTOR_ALLOW_DEGRADED=true/u);
  assert.match(deploy, /PACKAGE_STATUS >= 70/u);
  assert.match(deploy, /PACKAGE_STATUS == 20/u);
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

test('doctor script provides actionable remediation advice and diagnose flag', () => {
  assert.match(doctor, /--diagnose-apt/u);
  assert.match(doctor, /dpkg --configure -a/u);
  assert.match(doctor, /apt-get check/u);
  assert.match(doctor, /install-os-packages\.sh/u);
  assert.match(deploy, /NODE_EXEC_OUTPUT/u);
  assert.match(installer, /dpkg --configure -a/u);
});
