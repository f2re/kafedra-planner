#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  collectChangedChangeIds,
  inspectChangeBundle,
  parseArguments,
  readChangedEntries,
  repositoryRoot,
  runCommand,
  runGit
} from './lib/grace-governance.mjs';

function runGrace(args, root) {
  runCommand('grace', args, { cwd: root, stdio: 'inherit' });
}

function approveArchivedXml(filePath, rootTag) {
  const source = readFileSync(filePath, 'utf8');
  const expression = new RegExp(`(<${rootTag}\\b[^>]*\\bstatus=")applied(")`, 'i');
  const updated = source.replace(expression, '$1approved$2');
  if (updated === source) throw new Error(`Не удалось временно восстановить approved status в ${filePath}.`);
  writeFileSync(filePath, updated, 'utf8');
}

function verifyArchivedBundleAtHead(root, changeId) {
  const archivePath = join(root, '.grace', 'changes', 'archive', changeId);
  const activePath = join(root, '.grace', 'changes', 'active', changeId);
  if (!existsSync(archivePath)) throw new Error(`Не найден archive bundle ${changeId}.`);
  if (existsSync(activePath)) throw new Error(`Нельзя временно активировать ${changeId}: active bundle уже существует.`);

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'grace-archive-verify-'));
  const savedPath = join(temporaryRoot, changeId);
  try {
    mkdirSync(dirname(activePath), { recursive: true });
    renameSync(archivePath, savedPath);
    cpSync(savedPath, activePath, { recursive: true });
    approveArchivedXml(join(activePath, 'spec.xml'), 'GraceChangeSpec');
    approveArchivedXml(join(activePath, 'plan.xml'), 'GraceChangePlan');
    runGrace(['lint', '--path', '.', '--change', changeId, '--assertions', 'final', '--run-commands'], root);
  } finally {
    rmSync(activePath, { recursive: true, force: true });
    if (existsSync(savedPath)) {
      mkdirSync(dirname(archivePath), { recursive: true });
      renameSync(savedPath, archivePath);
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function changedExecutableBundles(root, entries) {
  const changed = collectChangedChangeIds(entries);
  const bundles = [];
  for (const [changeId, locations] of changed) {
    for (const location of locations) {
      const bundle = inspectChangeBundle(root, location, changeId);
      if (!bundle.valid) throw new Error(bundle.errors.join('\n'));
      bundles.push(bundle);
    }
  }
  return bundles;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const root = repositoryRoot();
  const baseRef = String(args.base || process.env.GRACE_BASE_SHA || 'HEAD^');
  const headRef = String(args.head || process.env.GRACE_HEAD_SHA || 'HEAD');
  const { base, head, entries } = readChangedEntries(baseRef, headRef, { cwd: root });

  console.log(`GRACE CI lifecycle for ${base}...${head}`);
  runGrace(['lint', '--path', '.', '--assertions', 'current'], root);
  const bundles = changedExecutableBundles(root, entries);
  for (const bundle of bundles) {
    if (bundle.location === 'active') {
      runGrace(['lint', '--path', '.', '--change', bundle.changeId, '--assertions', 'final', '--run-commands'], root);
    } else {
      verifyArchivedBundleAtHead(root, bundle.changeId);
    }
  }
  runGrace(['status', '--path', '.', '--json'], root);

  const status = runGit(['status', '--porcelain=v1', '--untracked-files=no'], { cwd: root }).trim();
  if (status) throw new Error(`GRACE CI не восстановил рабочее дерево:\n${status}`);
  console.log(`GRACE CI: проверено change bundles: ${bundles.length}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
