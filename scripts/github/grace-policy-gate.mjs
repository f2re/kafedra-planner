#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  evaluateActiveBundle,
  evaluateArchiveTransition,
  evaluateGovernance,
  isGovernedPath,
  parseNameStatus
} from '../grace-governance.mjs';

const CHANGE_ID_SOURCE = 'C-[A-Z0-9]+(?:-[A-Z0-9]+)*';
const POLICY_MODES = new Set(['branch', 'pr', 'main']);

function git(args, { root = process.cwd(), trim = true } = {}) {
  const output = execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return trim ? output.trim() : output;
}

function normalizePath(value) {
  return String(value).split(sep).join('/').replace(/^\.\//, '');
}

function changedPaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.oldPath) paths.push(normalizePath(entry.oldPath));
    if (entry.path) paths.push(normalizePath(entry.path));
  }
  return [...new Set(paths)];
}

function changedChangeIds(entries, location) {
  const ids = new Set();
  const pattern = new RegExp(`^\\.grace/changes/${location}/(${CHANGE_ID_SOURCE})/`);
  for (const path of changedPaths(entries)) {
    const match = path.match(pattern);
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

function bundlePrefix(location, changeId) {
  return `.grace/changes/${location}/${changeId}/`;
}

function bundleArtifactsAtRef(root, ref, location, changeId) {
  const prefix = bundlePrefix(location, changeId);
  const output = git(['ls-tree', '-r', '--name-only', ref, '--', prefix], { root, trim: false });
  const paths = output.split('\n').map((line) => normalizePath(line.trim())).filter(Boolean);
  return Object.fromEntries(paths.map((path) => [
    path.slice(prefix.length),
    git(['show', `${ref}:${path}`], { root, trim: false })
  ]));
}

function bundleExistsAtRef(root, ref, location, changeId, { requirePlan = false } = {}) {
  const artifacts = bundleArtifactsAtRef(root, ref, location, changeId);
  return Boolean(artifacts['spec.xml'] && (!requirePlan || artifacts['plan.xml']));
}

function entryPaths(entry) {
  return [entry.oldPath, entry.path]
    .filter(Boolean)
    .map((path) => normalizePath(path));
}

function isArchiveLifecycleEntry(entry, changeId) {
  const activePrefix = bundlePrefix('active', changeId);
  const archivePrefix = bundlePrefix('archive', changeId);
  const paths = entryPaths(entry);
  return paths.length > 0 && paths.every((path) => (
    path === '.grace/changes/archive/.gitkeep'
    || path.startsWith(activePrefix)
    || path.startsWith(archivePrefix)
  ));
}

export function activeChangeIdsAtRef(root, ref, { requirePlan = false } = {}) {
  const prefix = '.grace/changes/active/';
  const output = git(['ls-tree', '-r', '--name-only', ref, '--', prefix], { root, trim: false });
  const artifactsById = new Map();
  for (const line of output.split('\n')) {
    const path = normalizePath(line.trim());
    const match = path.match(new RegExp(`^${prefix}(${CHANGE_ID_SOURCE})/(spec|plan)\\.xml$`));
    if (!match) continue;
    if (!artifactsById.has(match[1])) artifactsById.set(match[1], new Set());
    artifactsById.get(match[1]).add(match[2]);
  }
  return [...artifactsById.entries()]
    .filter(([, names]) => names.has('spec') && (!requirePlan || names.has('plan')))
    .map(([id]) => id)
    .sort();
}

export function runPolicy({
  root = process.cwd(),
  base = 'origin/main',
  head = 'HEAD',
  mode = 'pr'
} = {}) {
  if (!POLICY_MODES.has(mode)) {
    throw new Error(`Unsupported policy mode: ${mode}. Expected branch, pr or main.`);
  }

  const entries = parseNameStatus(
    git(['diff', '--name-status', '-M', `${base}...${head}`], { root, trim: false })
  );
  const allPaths = changedPaths(entries);
  const allGoverned = allPaths.filter(isGovernedPath);
  const allTouchedActive = changedChangeIds(entries, 'active');
  const touchedArchive = changedChangeIds(entries, 'archive');
  const activeAtHead = activeChangeIdsAtRef(root, head);
  const archivedAtHead = touchedArchive.filter((id) => (
    bundleExistsAtRef(root, head, 'archive', id, { requirePlan: true })
  ));

  // Preserve the strict terminal-only transition. It remains useful when the
  // branch contains no next governed change at all.
  const archiveCandidate = allTouchedActive.length === 1
    && touchedArchive.length === 1
    && allTouchedActive[0] === touchedArchive[0]
    && activeAtHead.length === 0
    && archivedAtHead.length === 1;

  if (archiveCandidate) {
    const changeId = touchedArchive[0];
    const result = evaluateArchiveTransition({
      entries,
      changeId,
      baseArtifacts: bundleArtifactsAtRef(root, base, 'active', changeId),
      archivedArtifacts: bundleArtifactsAtRef(root, head, 'archive', changeId),
      activeArtifactsAtHead: bundleArtifactsAtRef(root, head, 'active', changeId)
    });
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    return {
      ok: true,
      lifecycle: 'archive',
      assertionMode: 'current',
      changeId: null,
      archivedChangeId: changeId,
      archiveStatus: result.status,
      paths: allPaths,
      governed: allGoverned
    };
  }

  // A completed change may be archived together with the next governed change.
  // Validate the old bundle as an immutable terminal transition, then remove
  // only those lifecycle paths before validating the new active scope. This
  // avoids a separate bookkeeping PR without weakening either contract.
  let archivedChangeId = null;
  let archiveStatus = null;
  let implementationEntries = entries;
  if (touchedArchive.length) {
    if (touchedArchive.length !== 1) {
      throw new Error(`Only one archived C-* bundle may be touched per branch diff; touched: ${touchedArchive.join(', ')}.`);
    }
    const candidate = touchedArchive[0];
    const validTerminalMove = allTouchedActive.includes(candidate)
      && !activeAtHead.includes(candidate)
      && archivedAtHead.includes(candidate);
    if (!validTerminalMove) {
      throw new Error(
        `Archived C-* bundles may change only through an immutable terminal move from exact base; touched: ${candidate}.`
      );
    }
    const lifecycleEntries = entries.filter((entry) => isArchiveLifecycleEntry(entry, candidate));
    const result = evaluateArchiveTransition({
      entries: lifecycleEntries,
      changeId: candidate,
      baseArtifacts: bundleArtifactsAtRef(root, base, 'active', candidate),
      archivedArtifacts: bundleArtifactsAtRef(root, head, 'archive', candidate),
      activeArtifactsAtHead: bundleArtifactsAtRef(root, head, 'active', candidate)
    });
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    archivedChangeId = candidate;
    archiveStatus = result.status;
    implementationEntries = entries.filter((entry) => !isArchiveLifecycleEntry(entry, candidate));
  }

  const paths = changedPaths(implementationEntries);
  const governed = paths.filter(isGovernedPath);
  const touchedActive = changedChangeIds(implementationEntries, 'active');
  const touchedActiveAtHead = touchedActive.filter((id) => activeAtHead.includes(id));

  if (activeAtHead.length > 1) {
    throw new Error(`Only one complete active C-* bundle is allowed at HEAD; found: ${activeAtHead.join(', ')}.`);
  }
  if (touchedActive.length > 1) {
    throw new Error(`Only one active C-* bundle may be touched per branch diff; touched: ${touchedActive.join(', ')}.`);
  }
  if (touchedActive.length && touchedActiveAtHead.length !== 1) {
    throw new Error('Touched active C-* bundle is incomplete or deleted without a terminal archive transition.');
  }
  if (governed.length > 0 && activeAtHead.length !== 1) {
    throw new Error(
      `Governed diff requires exactly one complete active C-* bundle at HEAD; found: ${activeAtHead.join(', ') || 'none'}.`
    );
  }

  const changeId = activeAtHead[0] || null;
  if (touchedActive.length === 1 && changeId !== touchedActive[0]) {
    throw new Error(`Touched active C-* ${touchedActive[0]} does not match the sole active bundle ${changeId || 'none'}.`);
  }
  if (!changeId) {
    if (governed.length) {
      throw new Error(`Governed diff requires one active C-* bundle; changed: ${governed.join(', ')}`);
    }
    return {
      ok: true,
      lifecycle: archivedChangeId ? 'archive' : 'none',
      assertionMode: 'current',
      changeId: null,
      archivedChangeId,
      archiveStatus,
      paths,
      governed
    };
  }

  const artifacts = bundleArtifactsAtRef(root, head, 'active', changeId);
  if (mode !== 'branch' && governed.length === 0) {
    throw new Error(
      `${mode} integration cannot contain only an active C-* bundle; complete the governed change or use an archive-only transition.`
    );
  }

  if (governed.length > 0 || mode !== 'branch') {
    const result = evaluateGovernance({
      entries: implementationEntries,
      changeId,
      specXml: artifacts['spec.xml'],
      planXml: artifacts['plan.xml']
    });
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    return {
      ok: true,
      lifecycle: 'active',
      stage: 'implementation',
      assertionMode: 'final',
      changeId,
      archivedChangeId,
      archiveStatus,
      paths: result.paths,
      governed: result.governed
    };
  }

  const active = evaluateActiveBundle({
    changeId,
    specXml: artifacts['spec.xml'],
    planXml: artifacts['plan.xml'],
    requireApproved: false,
    requirePlan: false
  });
  if (active.errors.length) throw new Error(active.errors.join('\n'));
  const planned = active.specStatus === 'approved' && active.planStatus === 'approved';
  return {
    ok: true,
    lifecycle: 'active',
    stage: planned ? 'planned' : 'draft',
    assertionMode: planned ? 'baseline' : 'current',
    changeId,
    archivedChangeId,
    archiveStatus,
    paths,
    governed
  };
}

function parseArgs(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      values._.push(value);
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      values[key] = true;
    }
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root || process.cwd());
  const result = runPolicy({
    root,
    base: args.base || process.env.GRACE_BASE_REF || 'origin/main',
    head: args.head || process.env.GRACE_HEAD_REF || 'HEAD',
    mode: args.mode || process.env.GRACE_POLICY_MODE || 'pr'
  });
  if (args.githubOutput && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `change_id=${result.changeId || ''}`,
      `archive_change_id=${result.archivedChangeId || ''}`,
      `lifecycle=${result.lifecycle || 'none'}`,
      `stage=${result.stage || ''}`,
      `assertion_mode=${result.assertionMode || 'current'}`,
      ''
    ].join('\n'));
  }
  console.log(JSON.stringify(result));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
