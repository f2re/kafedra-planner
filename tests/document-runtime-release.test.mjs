import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const archiveInstaller = await readFile(new URL('../scripts/offline/install-from-archive.sh', import.meta.url), 'utf8');
const strictPreflight = await readFile(new URL('../scripts/offline/full-document-preflight.sh', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../scripts/offline/doctor.sh', import.meta.url), 'utf8');
const ocr = await readFile(new URL('../scripts/recognition/ocr.py', import.meta.url), 'utf8');
const fullBuilder = await readFile(new URL('../scripts/offline/build-full-bundle.sh', import.meta.url), 'utf8');

test('published archive entrypoint executes strict document preflight before application transaction', () => {
  assert.match(archiveInstaller, /ARCHIVE="\$\{1:-\}"/u);
  assert.match(fullBuilder, /source\.replace\('ARCHIVE="\$\{1:-\}"'/u);
  const preflightIndex = archiveInstaller.indexOf('full-document-preflight.sh');
  const transactionIndex = archiveInstaller.indexOf('"$BUNDLE_ROOT/install.sh"');
  assert.ok(preflightIndex >= 0, 'strict preflight must be referenced');
  assert.ok(transactionIndex > preflightIndex, 'application transaction must start only after strict preflight');
  assert.match(archiveInstaller, /sha256sum -c --strict/u);
  assert.match(archiveInstaller, /Небезопасный путь в архиве/u);
  assert.match(archiveInstaller, /ссылку или специальный файл/u);
});

test('strict full-bundle gate caches payload, installs additively and runs a real OCR before activation', () => {
  const cacheIndex = strictPreflight.indexOf('cache-os-packages.sh');
  const packageIndex = strictPreflight.indexOf('install-os-packages.sh');
  const fullIndex = strictPreflight.indexOf('--require-full');
  const smokeIndex = strictPreflight.indexOf('--self-test');
  assert.ok(cacheIndex >= 0 && packageIndex > cacheIndex && fullIndex > packageIndex && smokeIndex > fullIndex);
  assert.match(strictPreflight, /KAFEDRA_OS_PACKAGE_CACHE_ROOT/u);
  assert.match(strictPreflight, /current\.path/u);
  assert.match(strictPreflight, /Полный bundle не может быть активирован/u);
  assert.match(strictPreflight, /Текущий релиз приложения, SQLite и пользовательские данные не переключались/u);
  assert.doesNotMatch(strictPreflight, /--fix-broken/u);
  assert.doesNotMatch(strictPreflight, /--allow-downgrades/u);
  assert.doesNotMatch(strictPreflight, /apt-get[^\n]*=[0-9]/u);
});

test('repair resolves the retained package cache and finishes with strict acceptance', () => {
  assert.match(doctor, /KAFEDRA_OS_PACKAGE_CACHE/u);
  assert.match(doctor, /current\.path/u);
  assert.match(doctor, /os-package-cache/u);
  assert.match(doctor, /--repair/u);
  assert.match(doctor, /--auto-repair/u);
  assert.match(doctor, /dpkg --configure -a/u);
  assert.match(doctor, /KAFEDRA_APT_MODE=bundle/u);
  assert.match(doctor, /KAFEDRA_DOCTOR_ALLOW_DEGRADED=false/u);
  assert.match(doctor, /--self-test/u);
  assert.doesNotMatch(doctor, /apt(?:-get)?[^\n]*--fix-broken/u);
});

test('OCR doctor contains deterministic control PDF and Tesseract smoke stages', () => {
  assert.match(ocr, /def write_control_pdf\(/u);
  assert.match(ocr, /def smoke_pdf\(/u);
  assert.match(ocr, /def smoke_tesseract\(/u);
  assert.match(ocr, /def control_ocr_self_test\(/u);
  assert.match(ocr, /doctor_parser\.add_argument\("--self-test"/u);
  assert.match(ocr, /"TEST 123"/u);
});
