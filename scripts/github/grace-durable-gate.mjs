#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { changedActiveChangeIds, parseNameStatus } from '../grace-governance.mjs';

const DURABLE_PREFIXES = [
  '.grace/context/',
  '.grace/graph/',
  '.grace/verification/'
];

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function changedPaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.oldPath) paths.push(normalizePath(entry.oldPath));
    if (entry.path) paths.push(normalizePath(entry.path));
  }
  return [...new Set(paths)];
}

function lifecycleId(path, location) {
  const match = normalizePath(path).match(new RegExp(`^\\.grace/changes/${location}/(C-[A-Z0-9-]+)/`));
  return match?.[1] || null;
}

function rootStatus(xml, rootTag) {
  const root = String(xml).match(new RegExp(`<${rootTag}\\b([^>]*)>`));
  return root?.[1].match(/\bstatus="([^"]+)"/)?.[1] || null;
}

function assertAppliedArchive(changeId, archiveArtifacts) {
  const artifact = archiveArtifacts.get(changeId);
  if (!artifact) return [`Archive bundle ${changeId} is missing spec.xml or plan.xml at HEAD.`];
  const errors = [];
  if (rootStatus(artifact.specXml, 'GraceChangeSpec') !== 'applied') {
    errors.push(`${changeId}/spec.xml must have status="applied" in terminal archive.`);
  }
  if (rootStatus(artifact.planXml, 'GraceChangePlan') !== 'applied') {
    errors.push(`${changeId}/plan.xml must have status="applied" in terminal archive.`);
  }
  if (!new RegExp(`<${changeId}(?:>|\\s)`).test(artifact.specXml)) {
    errors.push(`${changeId}/spec.xml is missing matching C-* wrapper.`);
  }
  if (!new RegExp(`<${changeId}(?:>|\\s)`).test(artifact.planXml)) {
    errors.push(`${changeId}/plan.xml is missing matching C-* wrapper.`);
  }
  return errors;
}

export function evaluateDurableModelDiff({ entries, activeIds = [], archiveArtifacts = new Map() }) {
  const errors = [];
  const paths = changedPaths(entries);
  const durable = paths.filter((path) => DURABLE_PREFIXES.some((prefix) => path.startsWith(prefix)));
  if (durable.length > 0 && activeIds.length !== 1) {
    errors.push(`Durable GRACE model changes require exactly one approved active C-* bundle: ${durable.join(', ')}`);
  }

  const lifecycleEntries = entries.filter((entry) => [entry.oldPath, entry.path]
    .filter(Boolean)
    .some((path) => /^\.grace\/changes\/(?:active|archive)\//.test(normalizePath(path))));
  if (activeIds.length > 0 || lifecycleEntries.length === 0) return { errors, durable, lifecycle: [] };

  const relevant = lifecycleEntries.filter((entry) => ![entry.oldPath, entry.path]
    .filter(Boolean)
    .every((path) => /\/\.gitkeep$/.test(normalizePath(path))));
  if (relevant.length === 0) return { errors, durable, lifecycle: [] };

  const activeDeletedIds = new Set();
  const archiveAddedIds = new Set();
  let invalidTransition = false;
  const deletedFiles = new Set();
  const archivedFiles = new Set();

  for (const entry of relevant) {
    const oldActive = entry.oldPath ? lifecycleId(entry.oldPath, 'active') : null;
    const newArchive = entry.path ? lifecycleId(entry.path, 'archive') : null;
    const directDelete = entry.status.startsWith('D') && entry.path ? lifecycleId(entry.path, 'active') : null;
    const directAdd = entry.status.startsWith('A') && entry.path ? lifecycleId(entry.path, 'archive') : null;

    if (entry.status.startsWith('R') && oldActive && newArchive && oldActive === newArchive) {
      activeDeletedIds.add(oldActive);
      archiveAddedIds.add(newArchive);
      deletedFiles.add(normalizePath(entry.oldPath));
      archivedFiles.add(normalizePath(entry.path));
      continue;
    }
    if (directDelete) {
      activeDeletedIds.add(directDelete);
      deletedFiles.add(normalizePath(entry.path));
      continue;
    }
    if (directAdd) {
      archiveAddedIds.add(directAdd);
      archivedFiles.add(normalizePath(entry.path));
      continue;
    }
    invalidTransition = true;
  }

  const ids = [...new Set([...activeDeletedIds, ...archiveAddedIds])];
  if (invalidTransition || ids.length !== 1 || !activeDeletedIds.has(ids[0]) || !archiveAddedIds.has(ids[0])) {
    errors.push('Changes without an active C-* may only move one complete bundle from active to archive.');
    return { errors, durable, lifecycle: ids };
  }

  const changeId = ids[0];
  for (const file of ['spec.xml', 'plan.xml']) {
    if (![...deletedFiles].some((path) => path === `.grace/changes/active/${changeId}/${file}`)) {
      errors.push(`Terminal archive move must remove active/${changeId}/${file}.`);
    }
    if (![...archivedFiles].some((path) => path === `.grace/changes/archive/${changeId}/${file}`)) {
      errors.push(`Terminal archive move must add archive/${changeId}/${file}.`);
    }
  }
  errors.push(...assertAppliedArchive(changeId, archiveArtifacts));
  return { errors, durable, lifecycle: [changeId] };
}

function git(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else values[key] = true;
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root || process.cwd());
  const base = args.base || process.env.GRACE_BASE_REF || 'origin/main';
  const head = args.head || process.env.GRACE_HEAD_REF || 'HEAD';
  git(['cat-file', '-e', `${base}^{commit}`], root);
  git(['cat-file', '-e', `${head}^{commit}`], root);
  const entries = parseNameStatus(git(['diff', '--name-status', '-M', `${base}...${head}`], root));
  const activeIds = changedActiveChangeIds(entries, (changeId) => {
    const directory = resolve(root, '.grace', 'changes', 'active', changeId);
    return existsSync(resolve(directory, 'spec.xml')) && existsSync(resolve(directory, 'plan.xml'));
  });
  const archiveArtifacts = new Map();
  for (const entry of entries) {
    for (const path of [entry.oldPath, entry.path].filter(Boolean)) {
      const changeId = lifecycleId(path, 'archive');
      if (!changeId || archiveArtifacts.has(changeId)) continue;
      const directory = resolve(root, '.grace', 'changes', 'archive', changeId);
      const specPath = resolve(directory, 'spec.xml');
      const planPath = resolve(directory, 'plan.xml');
      if (existsSync(specPath) && existsSync(planPath)) {
        archiveArtifacts.set(changeId, {
          specXml: readFileSync(specPath, 'utf8'),
          planXml: readFileSync(planPath, 'utf8')
        });
      }
    }
  }

  const result = evaluateDurableModelDiff({ entries, activeIds, archiveArtifacts });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  console.log(JSON.stringify({ ok: true, activeIds, durable: result.durable, lifecycle: result.lifecycle }));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
