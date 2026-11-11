import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyGitOfflineRisk, classifyOfflineRisk } from '../scripts/github/offline-risk-scope.mjs';

test('catalogue delivery with UI acceptance uses the actual archive gate', () => {
  assert.equal(classifyOfflineRisk([
    'scripts/offline/build-llm-patch-bundle.sh',
    'scripts/offline/verify-agent-catalogue.mjs',
    'scripts/agent-probe.sh', 'packages/ai/src/task-catalogue.mjs',
    'public/event-template-editor.js', 'public/plan-collection.js',
    'docs/design/event-template-acceptance.md', 'tests/browser/plan-collection.spec.mjs',
    '.grace/changes/active/C-EVENT-ACCEPTANCE-377/spec.xml',
    '.grace/changes/archive/C-EVENT-TEMPLATES-375/plan.xml',
    '.github/workflows/grace.yml'
  ]), 'catalogue');
});

test('mixed installation, runtime, database, dependencies and unknown paths require full deployment verification', () => {
  for (const path of [
    'scripts/offline/install.sh', 'scripts/offline/build-bundle.sh',
    'scripts/offline/build-full-bundle.sh', 'scripts/offline/build-full-bundle-with-llm.sh',
    'scripts/offline/systemd-deploy-selftest.sh', 'scripts/offline/new-delivery-tool.mjs',
    'packages/db/migrations/034_next.sql', 'packages/ai/src/plan-task.mjs',
    'apps/api/src/main.mjs', 'package.json', 'package-lock.json', '.nvmrc',
    '.github/workflows/release.yml', '.grace/graph/main.xml',
    'docs/../scripts/offline/install.sh', '/tmp/catalogue'
  ]) {
    assert.equal(classifyOfflineRisk(['scripts/offline/build-llm-patch-bundle.sh', path]), 'full', path);
  }
});

test('manual, missing, empty and failed comparisons cannot select the lighter gate', () => {
  const paths = ['scripts/export-agent-prompts.mjs'];
  assert.equal(classifyOfflineRisk(paths, { event: 'workflow_dispatch' }), 'full');
  assert.equal(classifyOfflineRisk(paths, { comparisonKnown: false }), 'full');
  assert.equal(classifyOfflineRisk([]), 'full');
  assert.equal(classifyOfflineRisk(['docs/ARCHITECTURE.md']), 'full');
  assert.equal(classifyGitOfflineRisk({ base: 'HEAD~1', head: 'HEAD', event: 'pull_request' }), 'full');
  assert.equal(classifyGitOfflineRisk({ base: '0'.repeat(40), head: '1'.repeat(40), event: 'pull_request' }), 'full');
});

test('exact Git comparison notices mixed changes and renamed deployment files', t => {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-offline-risk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Risk test');
  git('config', 'user.email', 'risk@example.invalid');
  mkdirSync(join(root, 'scripts/offline'), { recursive: true });
  writeFileSync(join(root, 'scripts/offline/install.sh'), 'original installer\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'baseline');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'scripts/offline/build-llm-patch-bundle.sh'), 'catalogue builder\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'catalogue');
  const options = { root, base, head: git('rev-parse', 'HEAD'), event: 'pull_request' };
  assert.equal(classifyGitOfflineRisk(options), 'catalogue');
  mkdirSync(join(root, 'docs'));
  git('mv', 'scripts/offline/install.sh', 'docs/historical-installer.txt');
  git('commit', '--quiet', '-m', 'move deployment input');
  assert.equal(classifyGitOfflineRisk({ ...options, head: git('rev-parse', 'HEAD') }), 'full');
});
