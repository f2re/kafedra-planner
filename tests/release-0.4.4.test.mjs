import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (path) => readFile(path, 'utf8');

test('текущий выпуск синхронизирован в version authorities и документах; 0.4.4 сохранён как исторический', async () => {
  const version = (await text('VERSION')).trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u);
  assert.equal(JSON.parse(await text('package.json')).version, version);
  const lock = JSON.parse(await text('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);

  const markers = [
    ['README.md', `Текущий рубеж: **\`${version}\`**`],
    ['README.en.md', `Current milestone: **\`${version}\`**`],
    ['docs/ROADMAP.md', `## Текущий рубеж — \`${version}\``],
    ['docs/UX_FLOWS.md', `Статус: рабочие контуры версии \`${version}\``],
    ['docs/VALIDATION.md', `Актуальный рубеж: \`${version}\``],
    ['docs/RELEASE_CANDIDATE.md', `# Release candidate ${version}`],
    [`docs/releases/${version}.md`, `# Kafedra Planner ${version}`]
  ];
  for (const [path, marker] of markers) {
    assert.ok((await text(path)).includes(marker), `${path} должен содержать ${marker}`);
  }
  assert.match(await text('docs/releases/0.4.4.md'), /^# Kafedra Planner 0\.4\.4$/mu);
});

test('full bundle содержит document capabilities без target package version pins', async () => {
  const packages = (await text('config/offline/os-packages.txt'))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  for (const required of [
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
  ]) {
    assert.ok(packages.includes(required), `bundle package profile must contain ${required}`);
  }
  assert.equal(packages.some((value) => value.includes('=')), false, 'top-level package requests must not pin target versions');
});

test('full installer проверяет OCR/PDF/Office до активации и не требует root-владельца source', async () => {
  const core = await text('deploy/install-core.sh');
  const launcher = await text('scripts/offline/install-from-archive.sh');
  const note = await text('docs/releases/0.4.4.md');

  assert.match(core, /system-preflight\.mjs[^\n]*--require-full/u);
  assert.match(core, /ocr\.py" doctor --languages "\$\{KAFEDRA_OCR_LANGUAGES:-rus\+eng\}" --self-test/u);
  assert.match(core, /smoke_pdf|smoke_tesseract/u);
  assert.match(core, /Прежний release остаётся active/u);
  assert.match(launcher, /--no-same-owner/u);
  assert.match(launcher, /--no-same-permissions/u);
  assert.doesNotMatch(launcher, /chown -R root:root "\$ROOT"/u);
  assert.match(note, /не переоформляется на root/u);
});

test('release строит target bundles один раз и проверяет те же artifacts до публикации', async () => {
  const release = await text('.github/workflows/release.yml');
  assert.match(release, /^name: Release$/mu);
  assert.match(release, /^on:\n  workflow_dispatch:\n  push:\n    branches: \[release-run\]$/mu);
  assert.doesNotMatch(release, /^  (?:pull_request|workflow_run):/mu);
  assert.doesNotMatch(release, /^    branches: \[main\]$/mu);
  assert.equal([...release.matchAll(/build-release-targets\.sh "\$OUT"/g)].length, 1);
  assert.equal([...release.matchAll(/verify-release-targets\.sh "\$OUT"/g)].length, 1);
  assert.match(release, /sha256sum -c --strict/u);
  assert.match(release, /tests\/browser\/protocol-import\.spec\.mjs/u);
  assert.doesNotMatch(release, /gh workflow run/u);
  await assert.rejects(text('.github/workflows/release-gate.yml'), (error) => error?.code === 'ENOENT');
});
