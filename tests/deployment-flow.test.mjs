import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { parseTesseractTsv } from '../packages/document-intake/src/ocr.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('application paths do not depend on installer cwd', () => {
  const config = loadConfig({ KAFEDRA_APPLICATION_DIR: '/opt/kafedra-planner/releases/test-release', KAFEDRA_DATA_DIR: '/var/lib/kafedra-planner' }, '/tmp/wrong-installer-cwd');
  assert.equal(config.migrationsDir, '/opt/kafedra-planner/releases/test-release/migrations');
  assert.equal(config.publicDir, '/opt/kafedra-planner/releases/test-release/public');
});

test('clean deployment creates one initial admin with mandatory password change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kafedra-admin-'));
  const databasePath = join(directory, 'db.sqlite3');
  const env = { ...process.env, KAFEDRA_APPLICATION_DIR: ROOT, KAFEDRA_DATA_DIR: directory, KAFEDRA_DATABASE_PATH: databasePath, KAFEDRA_CONFIG_PATH: join(directory, 'kafedra.env') };
  try {
    const first = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/ensure-initial-admin.mjs')], { cwd: directory, env, encoding: 'utf8' }));
    assert.equal(first.created, true); assert.equal(first.username, 'admin'); assert.ok(first.password.length >= 12); assert.equal(first.mustChangePassword, true);
    const second = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/ensure-initial-admin.mjs')], { cwd: directory, env, encoding: 'utf8' }));
    assert.equal(second.created, false);
    const database = new Database(databasePath, { migrationsDir: join(ROOT, 'migrations') });
    try {
      const account = database.get("SELECT username, role, must_change_password FROM auth_accounts WHERE username = 'admin'");
      assert.equal(account.username, 'admin'); assert.equal(account.role, 'admin'); assert.equal(account.must_change_password, 1);
    } finally { database.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('managed Python OCR parses the same Tesseract TSV contract as Node', async () => {
  const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext','5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t96.0\tПриказ','5\t1\t1\t1\t1\t2\t45\t20\t40\t12\t94.0\t№12'].join('\n');
  const directory = await mkdtemp(join(tmpdir(), 'kafedra-ocr-'));
  const fixture = join(directory, 'sample.tsv');
  try {
    const { writeFile } = await import('node:fs/promises'); await writeFile(fixture, tsv, 'utf8');
    const python = process.env.PYTHON_BIN || 'python3';
    const managed = JSON.parse(execFileSync(python, [join(ROOT, 'scripts/recognition/ocr.py'), 'parse-tsv', fixture], { encoding: 'utf8' }));
    const direct = parseTesseractTsv(tsv); assert.deepEqual(managed, direct);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('default bundle command is full target deployment, not source-only runtime archive', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const packageList = await readFile(join(ROOT, 'config/offline/os-packages.txt'), 'utf8');
  const fullBuilder = await readFile(join(ROOT, 'scripts/offline/build-full-bundle.sh'), 'utf8');
  const installer = await readFile(join(ROOT, 'deploy/install.sh'), 'utf8');
  assert.equal(pkg.scripts['bundle:offline'], 'bash scripts/offline/build-full-bundle.sh');
  assert.equal(pkg.scripts['bundle:offline:runtime'], 'bash scripts/offline/build-bundle.sh');
  for (const name of ['tesseract-ocr', 'tesseract-ocr-rus', 'tesseract-ocr-eng', 'poppler-utils', 'libreoffice-core']) assert.match(packageList, new RegExp(`^${name}$`, 'mu'));
  assert.match(fullBuilder, /python-runtime\.py.*export/su); assert.match(fullBuilder, /verify_os_package_set/u);
  assert.match(installer, /install-os-packages\.sh/u); assert.match(installer, /ensure-initial-admin\.mjs/u); assert.match(installer, /KAFEDRA_OCR_BACKEND=python/u); assert.match(installer, /KAFEDRA_HOST=0\.0\.0\.0/u);
});
