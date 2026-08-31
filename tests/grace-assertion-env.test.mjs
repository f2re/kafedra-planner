import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  commandNeedsPlaywright,
  extractCommandTexts,
  inspectChangePlan,
  inspectPlanXml,
  planPath
} from '../scripts/ci/grace-assertion-env.mjs';

const script = resolve('scripts/ci/grace-assertion-env.mjs');

function runNode(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function fixture(changeId, planXml) {
  const root = await mkdtemp(join(tmpdir(), 'grace-assertion-env-'));
  const path = planPath(root, changeId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, planXml, 'utf8');
  return { root, path };
}

test('extracts only Command entries and decodes XML entities', () => {
  const xml = `
    <GraceChangePlan>
      <Summary>playwright test here is prose only</Summary>
      <Verification>
        <Command>node --test tests/a.test.mjs</Command>
        <Command>bash -lc &quot;npx playwright test a.spec.mjs &amp;&amp; echo ok&quot;</Command>
      </Verification>
    </GraceChangePlan>`;
  assert.deepEqual(extractCommandTexts(xml), [
    'node --test tests/a.test.mjs',
    'bash -lc "npx playwright test a.spec.mjs && echo ok"'
  ]);
  assert.deepEqual(inspectPlanXml(xml), { commandCount: 2, playwright: true });
});

test('detects direct and npm browser assertions but not unrelated commands', () => {
  for (const value of [
    'npx playwright test tests/browser/a.spec.mjs',
    'playwright test --config=playwright.auth.config.mjs',
    'npm run test:browser',
    'npm run test:browser:plans'
  ]) assert.equal(commandNeedsPlaywright(value), true, value);

  for (const value of [
    'node --test tests/playwright-policy.test.mjs',
    'echo playwright test',
    'npm test',
    'npm run docs:check'
  ]) assert.equal(commandNeedsPlaywright(value), false, value);
});

test('reads only the selected active change plan', async () => {
  const changeId = 'C-EXAMPLE-240';
  const { root, path } = await fixture(changeId, '<Plan><Command>npm run test:browser:core</Command></Plan>');
  try {
    const result = await inspectChangePlan({ root, changeId });
    assert.equal(result.path, path);
    assert.equal(result.commandCount, 1);
    assert.equal(result.playwright, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid ids and missing active plans fail closed', async () => {
  assert.throws(() => planPath('/tmp/root', '../archive/C-BAD'), /Invalid GRACE change id/u);
  assert.throws(() => planPath('/tmp/root', 'C-bad'), /Invalid GRACE change id/u);
  await assert.rejects(
    inspectChangePlan({ root: '/tmp/does-not-exist', changeId: 'C-MISSING-240' }),
    (error) => error?.code === 'ENOENT'
  );
});

test('CLI writes deterministic GitHub outputs', async () => {
  const changeId = 'C-CLI-240';
  const { root } = await fixture(changeId, '<Plan><Command>npx playwright test x.spec.mjs</Command><Command>npm test</Command></Plan>');
  const output = join(root, 'github-output.txt');
  try {
    const result = await runNode(['--root', root, '--change', changeId, '--github-output'], { GITHUB_OUTPUT: output });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      changeId,
      path: planPath(root, changeId),
      commandCount: 2,
      playwright: true
    });
    assert.equal(await readFile(output, 'utf8'), 'playwright=true\ncommand_count=2\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
