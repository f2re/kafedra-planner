import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const packageName = `kafedra-llm-catalogue-${version}`;
const archiveName = `${packageName}.tar.gz`;
const verifier = join(root, 'scripts/offline/verify-agent-catalogue.mjs');

function snapshot(directory) {
  const result = {};
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else result[relative(directory, path)] = { sha256: hash(readFileSync(path)), mode: statSync(path).mode };
    }
  }
  walk(directory);
  return result;
}

function verify(archive) {
  return spawnSync(process.execPath, [verifier, archive], { encoding: 'utf8' });
}

function repack(directory, archive) {
  execFileSync('tar', ['--sort=name', '-czf', archive, '-C', dirname(directory), basename(directory)]);
  writeFileSync(`${archive}.sha256`, `${hash(readFileSync(archive))}  ${basename(archive)}\n`);
}

test('portable LLM catalogue archive', async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'kafedra-catalogue-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const source = join(temporary, "source with space's");
  const cwd = join(temporary, 'unrelated workspace');
  const output = join(temporary, 'explicit output');
  const buildTemporary = join(temporary, 'build temporary');
  const ignoredOutput = join(temporary, 'ignored output');
  mkdirSync(source); mkdirSync(cwd); mkdirSync(buildTemporary);
  writeFileSync(join(cwd, 'keep.txt'), 'The caller directory is not the source or destination.');
  for (const path of ['package.json', 'VERSION', 'packages', 'migrations', 'scripts/export-agent-prompts.mjs',
    'scripts/agent-probe.sh', 'scripts/offline/build-llm-patch-bundle.sh', 'scripts/offline/verify-agent-catalogue.mjs']) {
    const target = join(source, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, path), target, { recursive: true });
  }
  const environment = { ...process.env, SOURCE_DATE_EPOCH: '1700000000', TMPDIR: buildTemporary,
    OUT_DIR: ignoredOutput, NODE_DISABLE_COMPILE_CACHE: '1' };
  const builder = join(source, 'scripts/offline/build-llm-patch-bundle.sh');
  const beforeSource = snapshot(source);
  const beforeCwd = snapshot(cwd);
  const build = spawnSync('bash', [builder, '--output-dir', output], { cwd, env: environment, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const archive = join(output, archiveName);

  await t.test('builds outside the checkout, writes only explicit output and carries the full catalogue', () => {
    assert.deepEqual(snapshot(source), beforeSource, 'building must not regenerate the source-tree manifest');
    assert.deepEqual(snapshot(cwd), beforeCwd, 'building must not write into the caller directory');
    assert.equal(existsSync(ignoredOutput), false, '--output-dir must override OUT_DIR');
    assert.deepEqual(readdirSync(buildTemporary), [], 'temporary build files must be removed');
    assert.deepEqual(readdirSync(output).sort(), [archiveName, `${archiveName}.sha256`]);
    const verification = verify(archive);
    assert.equal(verification.status, 0, verification.stderr);
    const result = JSON.parse(verification.stdout);
    assert.equal(result.applicationVersion, version);
    const schemaVersion = Math.max(...readdirSync(join(source, 'migrations')).map((name) => Number(/^(\d+)_/u.exec(name)?.[1] || 0)));
    assert.equal(result.schemaVersion, schemaVersion);
    assert.equal(result.sourceCommit, null, 'a source export without Git must not claim a commit');
    assert.equal(result.sourceDirty, null);
    assert.equal(result.sourceDateEpoch, 1700000000);
    const extracted = join(temporary, 'extracted');
    mkdirSync(extracted);
    execFileSync('tar', ['-xzf', archive, '-C', extracted]);
    const payload = join(extracted, packageName);
    const catalogue = JSON.parse(readFileSync(join(payload, 'department-agents.json'), 'utf8'));
    assert.equal(result.taskCount, catalogue.agents.length);
    const probe = spawnSync('bash', [join(payload, 'test-remote-agents.sh'), '--list'], {
      cwd, encoding: 'utf8', env: { ...process.env, AGENTS_FILE: join(payload, 'department-agents.json'), LLM_ENDPOINT: 'http://127.0.0.1:1' }
    });
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(probe.stdout.trim().split('\n').map((line) => line.split('\t')[0]), catalogue.agents.map((agent) => agent.id));
    assert.ok(catalogue.agents.some((agent) => agent.id === 'plan-extract-v1'));
    assert.ok(catalogue.agents.some((agent) => agent.id === 'plan-department-selection-v1'));
  });

  await t.test('the short npm command and OUT_DIR produce the same deterministic archive', () => {
    const secondOutput = join(temporary, 'second output');
    const second = spawnSync('npm', ['--prefix', source, 'run', 'bundle:patch:llm'], {
      cwd, env: { ...environment, OUT_DIR: secondOutput }, encoding: 'utf8'
    });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(hash(readFileSync(join(secondOutput, archiveName))), hash(readFileSync(archive)));
    assert.deepEqual(snapshot(source), beforeSource);
    assert.deepEqual(snapshot(cwd), beforeCwd);
  });

  await t.test('an invalid staged catalogue preserves the previous successful output', () => {
    const originalOutput = snapshot(output);
    const sourceModule = join(source, 'packages/ai/src/task-catalogue.mjs');
    const originalModule = readFileSync(sourceModule, 'utf8');
    const brokenModule = originalModule.replace("schema: 'kafedra-agents-v1'", "schema: 'invalid-catalogue-contract'");
    assert.notEqual(brokenModule, originalModule);
    writeFileSync(sourceModule, brokenModule);
    try {
      const failed = spawnSync('bash', [builder, '--output-dir', output], { cwd, env: environment, encoding: 'utf8' });
      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, /Каталог задач не соответствует/u);
      assert.deepEqual(snapshot(output), originalOutput, 'verification failure must not replace archive or checksum');
      assert.deepEqual(readdirSync(output).sort(), [archiveName, `${archiveName}.sha256`]);
      assert.deepEqual(readdirSync(buildTemporary), []);
    } finally { writeFileSync(sourceModule, originalModule); }
  });

  await t.test('external SHA-256 detects a modified archive before parsing it', () => {
    const altered = join(temporary, 'outer checksum');
    mkdirSync(altered);
    cpSync(archive, join(altered, archiveName));
    cpSync(`${archive}.sha256`, join(altered, `${archiveName}.sha256`));
    appendFileSync(join(altered, archiveName), 'modified');
    const result = verify(join(altered, archiveName));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA-256 архива не совпадает/u);
  });

  await t.test('rehashed tampering, symlinks and unlisted installer payloads are rejected without extraction', () => {
    const external = join(temporary, 'outside.txt');
    writeFileSync(external, 'unchanged');
    const cases = [
      ['payload', (payload) => appendFileSync(join(payload, 'department-agents.json'), '\n'), /SHA-256 файла department-agents\.json не совпадает/u],
      ['symlink', (payload) => { rmSync(join(payload, 'README.md')); symlinkSync(external, join(payload, 'README.md')); }, /ссылку, специальный файл/u],
      ['installer', (payload) => writeFileSync(join(payload, 'apply-patch.sh'), '#!/bin/sh\nexit 1\n'), /только каталог, документацию/u]
    ];
    for (const [name, change, expectedError] of cases) {
      const changed = join(temporary, name);
      mkdirSync(changed);
      execFileSync('tar', ['-xzf', archive, '-C', changed]);
      const payload = join(changed, packageName);
      change(payload);
      const repacked = join(changed, archiveName);
      repack(payload, repacked);
      const before = snapshot(cwd);
      const result = verify(repacked);
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, expectedError, name);
      assert.deepEqual(snapshot(cwd), before);
      assert.equal(readFileSync(external, 'utf8'), 'unchanged');
    }
  });
});
