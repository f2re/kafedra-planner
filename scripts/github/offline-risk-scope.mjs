#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// This archive contains a task catalogue and a diagnostic client. It does not
// change the installed application, OS dependencies, services or model payload.
const cataloguePaths = new Set([
  'scripts/export-agent-prompts.mjs',
  'scripts/agent-probe.sh',
  'packages/ai/src/task-catalogue.mjs',
  'packages/ai/department-agents.json',
  'scripts/offline/build-llm-patch-bundle.sh',
  'scripts/offline/verify-agent-catalogue.mjs'
]);
const companionPaths = new Set([
  'README.md', 'README.en.md',
  'public/plan-collection.js', 'public/plan-collection.css',
  'public/event-template-editor.js',
  'scripts/github/offline-risk-scope.mjs',
  '.github/workflows/grace.yml', '.github/workflows/ci.yml'
]);

export function classifyOfflineRisk(paths, { event = 'pull_request', comparisonKnown = true } = {}) {
  if (event !== 'pull_request' || !comparisonKnown || !Array.isArray(paths) || !paths.length) return 'full';
  let catalogueChanged = false;
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) return 'full';
    if (cataloguePaths.has(path)) {
      catalogueChanged = true;
      continue;
    }
    if (companionPaths.has(path) || /^(docs|tests)\//u.test(path)
        || /^\.grace\/changes\/(active|archive)\/C-[A-Z0-9-]+\//u.test(path)) continue;
    // Unknown or mixed deployment inputs retain the complete installation gate.
    return 'full';
  }
  return catalogueChanged ? 'catalogue' : 'full';
}

export function classifyGitOfflineRisk({ base, head, event, root = process.cwd() }) {
  if (event !== 'pull_request' || !/^[a-f0-9]{40}$/u.test(base || '') || !/^[a-f0-9]{40}$/u.test(head || '')) return 'full';
  try {
    for (const ref of [base, head]) execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, stdio: 'pipe' });
    const diff = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head, '--'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    return classifyOfflineRisk(diff.split('\0').filter(Boolean), { event });
  } catch {
    return 'full';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--base', '--head', '--event'].includes(key) || !args.length) {
      console.error('Usage: offline-risk-scope.mjs --base SHA --head SHA --event EVENT');
      process.exit(1);
    }
    options[key.slice(2)] = args.shift();
  }
  console.log(classifyGitOfflineRisk(options));
}
