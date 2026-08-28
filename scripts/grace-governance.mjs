#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const CHANGE_ID_SOURCE = 'C-[A-Z0-9]+(?:-[A-Z0-9]+)*';
const CHANGE_BUNDLE_ARTIFACT = new RegExp(
  `^\\.grace/changes/(?:active|archive)/(?:${CHANGE_ID_SOURCE})/[^/]+\\.xml$`
);
const TERMINAL_CHANGE_STATUSES = new Set(['applied', 'rejected', 'cancelled', 'superseded']);
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

export function parseNameStatus(text) {
  if (!String(text).trim()) return [];
  return String(text).trimEnd().split('\n').filter(Boolean).map((line) => {
    const fields = line.split('\t');
    const status = fields[0];
    if (/^[RC]/.test(status)) {
      return { status, oldPath: normalizePath(fields[1]), path: normalizePath(fields[2]) };
    }
    return { status, path: normalizePath(fields[1]) };
  });
}

export function globToRegExp(glob) {
  const pattern = normalizePath(glob);
  if (!pattern || /[{}\[\]]/.test(pattern)) {
    throw new Error(`Unsupported ObservedWriteScope glob: ${glob}`);
  }
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function extractTagValues(xml, sectionName, childName) {
  const section = String(xml || '').match(new RegExp(`<${sectionName}>([\\s\\S]*?)</${sectionName}>`));
  if (!section) return [];
  return [...section[1].matchAll(new RegExp(`<${childName}>([\\s\\S]*?)</${childName}>`, 'g'))]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

export function extractObservedWriteScope(planXml) {
  return {
    files: extractTagValues(planXml, 'ObservedWriteScope', 'File').map(normalizePath),
    globs: extractTagValues(planXml, 'ObservedWriteScope', 'Glob').map(normalizePath)
  };
}

export function pathIsInScope(path, scope) {
  const normalized = normalizePath(path);
  if (scope.files.includes(normalized)) return true;
  return scope.globs.some((glob) => globToRegExp(glob).test(normalized));
}

export function validateObservedWriteScope(paths, scope) {
  const missing = [];
  for (const path of paths) {
    if (!pathIsInScope(path, scope)) missing.push(normalizePath(path));
  }
  return missing;
}

function isLifecycleArtifact(path) {
  const normalized = normalizePath(path);
  return normalized === '.grace/changes/archive/.gitkeep'
    || CHANGE_BUNDLE_ARTIFACT.test(normalized);
}

/**
 * Every repository file is governed except direct GRACE change-bundle XML artifacts.
 * Change-bundle XML is validated by the lifecycle-specific active/archive rules below.
 */
export function isGovernedPath(path) {
  return !isLifecycleArtifact(path);
}

function changedPaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.oldPath) paths.push(entry.oldPath);
    if (entry.path) paths.push(entry.path);
  }
  return [...new Set(paths)];
}

function changedChangeIds(entries, location) {
  const ids = new Set();
  const pattern = new RegExp(`^\\.grace/changes/${location}/(${CHANGE_ID_SOURCE})/`);
  for (const path of changedPaths(entries)) {
    const match = normalizePath(path).match(pattern);
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

export function changedActiveChangeIds(entries, isActiveAtHead = () => true) {
  return changedChangeIds(entries, 'active').filter((id) => isActiveAtHead(id));
}

export function changedArchivedChangeIds(entries, isArchivedAtHead = () => true) {
  return changedChangeIds(entries, 'archive').filter((id) => isArchivedAtHead(id));
}

function inspectArtifact(xml, rootTag, changeId, allowedStatuses, file) {
  if (!xml) throw new Error(`${file}: artifact is missing.`);
  const root = String(xml).match(new RegExp(`<${rootTag}\\b([^>]*)>`));
  if (!root) throw new Error(`${file}: expected <${rootTag}> root.`);
  if (!/\bgraceVersion="4\.0"/.test(root[1])) {
    throw new Error(`${file}: graceVersion must be 4.0.`);
  }
  const status = root[1].match(/\bstatus="([^"]+)"/)?.[1] || null;
  if (!status || !allowedStatuses.has(status)) {
    throw new Error(`${file}: status must be one of ${[...allowedStatuses].join(', ')}; got ${status || 'missing'}.`);
  }
  if (!new RegExp(`<${changeId}(?:>|\\s)`).test(String(xml))) {
    throw new Error(`${file}: missing ${changeId} wrapper.`);
  }
  return status;
}

function collectError(errors, callback) {
  try {
    return callback();
  } catch (error) {
    errors.push(error.message);
    return null;
  }
}

export function evaluateActiveBundle({
  changeId,
  specXml,
  planXml = null,
  requireApproved = false,
  requirePlan = false
}) {
  const errors = [];
  const activeStatuses = new Set(['draft', 'approved']);
  const specStatus = collectError(
    errors,
    () => inspectArtifact(specXml, 'GraceChangeSpec', changeId, activeStatuses, `${changeId}/spec.xml`)
  );
  let planStatus = null;
  if (planXml) {
    planStatus = collectError(
      errors,
      () => inspectArtifact(planXml, 'GraceChangePlan', changeId, activeStatuses, `${changeId}/plan.xml`)
    );
  } else if (requirePlan) {
    errors.push(`${changeId}/plan.xml: artifact is required.`);
  }

  if (planStatus === 'approved' && specStatus !== 'approved') {
    errors.push(`${changeId}: an approved plan requires an approved spec.`);
  }
  if (requireApproved && (specStatus !== 'approved' || planStatus !== 'approved')) {
    errors.push(`${changeId}: governed implementation requires approved spec.xml and plan.xml.`);
  }

  return { errors, specStatus, planStatus };
}

export function evaluateGovernance({ entries, changeId, specXml, planXml }) {
  const paths = changedPaths(entries);
  const governed = paths.filter(isGovernedPath);
  const active = evaluateActiveBundle({
    changeId,
    specXml,
    planXml,
    requireApproved: true,
    requirePlan: true
  });
  const errors = [...active.errors];

  if (planXml) {
    collectError(errors, () => {
      const scope = extractObservedWriteScope(planXml);
      if (scope.files.length === 0 && scope.globs.length === 0) {
        throw new Error(`${changeId}/plan.xml: ObservedWriteScope is empty.`);
      }
      const outOfScope = validateObservedWriteScope(paths, scope);
      if (outOfScope.length) {
        throw new Error(`Observed writes outside ${changeId} scope: ${outOfScope.join(', ')}`);
      }
    });
  }

  return {
    errors,
    governed,
    paths,
    specStatus: active.specStatus,
    planStatus: active.planStatus
  };
}

export function normalizeLifecycleArtifact(xml, rootTag) {
  return String(xml).replace(
    new RegExp(`(<${rootTag}\\b[^>]*\\bstatus=")[^"]+(")`),
    '$1__LIFECYCLE_STATUS__$2'
  );
}

export function evaluateArchiveTransition({
  entries,
  changeId,
  baseArtifacts = {},
  archivedArtifacts = {},
  activeArtifactsAtHead = {}
}) {
  const errors = [];
  const activePrefix = `.grace/changes/active/${changeId}/`;
  const archivePrefix = `.grace/changes/archive/${changeId}/`;
  const unexpectedPaths = changedPaths(entries).filter((path) => {
    const normalized = normalizePath(path);
    return normalized !== '.grace/changes/archive/.gitkeep'
      && !normalized.startsWith(activePrefix)
      && !normalized.startsWith(archivePrefix);
  });
  if (unexpectedPaths.length) {
    errors.push(`Archive-only transition contains non-lifecycle writes: ${unexpectedPaths.join(', ')}`);
  }

  const baseNames = Object.keys(baseArtifacts).sort();
  const archivedNames = Object.keys(archivedArtifacts).sort();
  const activeHeadNames = Object.keys(activeArtifactsAtHead).sort();
  if (activeHeadNames.length) {
    errors.push(`${changeId}: active bundle still exists at HEAD: ${activeHeadNames.join(', ')}`);
  }
  if (!baseNames.includes('spec.xml') || !baseNames.includes('plan.xml')) {
    errors.push(`${changeId}: exact base must contain approved active spec.xml and plan.xml.`);
  }
  if (JSON.stringify(baseNames) !== JSON.stringify(archivedNames)) {
    errors.push(
      `${changeId}: archive must preserve the exact bundle file set; base=${JSON.stringify(baseNames)}, archive=${JSON.stringify(archivedNames)}.`
    );
  }

  const baseSpecStatus = collectError(
    errors,
    () => inspectArtifact(
      baseArtifacts['spec.xml'],
      'GraceChangeSpec',
      changeId,
      new Set(['approved']),
      `${changeId}/base/spec.xml`
    )
  );
  const basePlanStatus = collectError(
    errors,
    () => inspectArtifact(
      baseArtifacts['plan.xml'],
      'GraceChangePlan',
      changeId,
      new Set(['approved']),
      `${changeId}/base/plan.xml`
    )
  );
  const archivedSpecStatus = collectError(
    errors,
    () => inspectArtifact(
      archivedArtifacts['spec.xml'],
      'GraceChangeSpec',
      changeId,
      TERMINAL_CHANGE_STATUSES,
      `${changeId}/archive/spec.xml`
    )
  );
  const archivedPlanStatus = collectError(
    errors,
    () => inspectArtifact(
      archivedArtifacts['plan.xml'],
      'GraceChangePlan',
      changeId,
      TERMINAL_CHANGE_STATUSES,
      `${changeId}/archive/plan.xml`
    )
  );

  if (baseSpecStatus && basePlanStatus && baseSpecStatus !== basePlanStatus) {
    errors.push(`${changeId}: base spec and plan statuses differ.`);
  }
  if (archivedSpecStatus && archivedPlanStatus && archivedSpecStatus !== archivedPlanStatus) {
    errors.push(`${changeId}: archived spec and plan must have the same terminal status.`);
  }

  for (const name of baseNames) {
    if (!(name in archivedArtifacts)) continue;
    const rootTag = name === 'spec.xml'
      ? 'GraceChangeSpec'
      : name === 'plan.xml'
        ? 'GraceChangePlan'
        : null;
    const baseText = rootTag
      ? normalizeLifecycleArtifact(baseArtifacts[name], rootTag)
      : String(baseArtifacts[name]);
    const archivedText = rootTag
      ? normalizeLifecycleArtifact(archivedArtifacts[name], rootTag)
      : String(archivedArtifacts[name]);
    if (baseText !== archivedText) {
      errors.push(`${changeId}: ${name} changed during archive transition; only root lifecycle status may change.`);
    }
  }

  return {
    errors,
    status: archivedSpecStatus && archivedSpecStatus === archivedPlanStatus ? archivedSpecStatus : null
  };
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
  const paths = changedPaths(entries);
  const governed = paths.filter(isGovernedPath);
  const touchedActive = changedChangeIds(entries, 'active');
  const touchedArchive = changedChangeIds(entries, 'archive');
  const activeAtHead = touchedActive.filter((id) => bundleExistsAtRef(root, head, 'active', id));
  const archivedAtHead = touchedArchive.filter((id) => bundleExistsAtRef(root, head, 'archive', id, { requirePlan: true }));

  const archiveCandidate = governed.length === 0
    && touchedActive.length === 1
    && touchedArchive.length === 1
    && touchedActive[0] === touchedArchive[0]
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
      paths,
      governed
    };
  }

  if (touchedArchive.length) {
    throw new Error(
      `Archived C-* bundles may change only in one immutable archive-only transition; touched: ${touchedArchive.join(', ')}.`
    );
  }

  if (governed.length > 0 && (touchedActive.length !== 1 || activeAtHead.length !== 1)) {
    throw new Error(
      `Governed diff must introduce/update exactly one active C-* bundle; touched=${touchedActive.join(', ') || 'none'}, active-at-head=${activeAtHead.join(', ') || 'none'}.`
    );
  }
  if (touchedActive.length > 1 || activeAtHead.length > 1) {
    throw new Error(`Only one active C-* bundle is allowed per branch diff; touched: ${touchedActive.join(', ')}.`);
  }
  if (touchedActive.length && activeAtHead.length !== 1) {
    throw new Error(`Touched active C-* bundle is incomplete or deleted without a terminal archive transition.`);
  }

  const changeId = activeAtHead[0] || null;
  if (!changeId) {
    if (governed.length) {
      throw new Error(`Governed diff requires one active C-* bundle; changed: ${governed.join(', ')}`);
    }
    return {
      ok: true,
      lifecycle: 'none',
      assertionMode: 'current',
      changeId: null,
      archivedChangeId: null,
      paths,
      governed
    };
  }

  const artifacts = bundleArtifactsAtRef(root, head, 'active', changeId);
  if (mode !== 'branch' && governed.length === 0) {
    throw new Error(
      `${mode} integration cannot contain only an active C-* bundle; complete the governed change or perform a terminal archive-only transition.`
    );
  }

  if (governed.length > 0 || mode !== 'branch') {
    const result = evaluateGovernance({
      entries,
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
      archivedChangeId: null,
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
    archivedChangeId: null,
    paths,
    governed
  };
}

function migrationFilesAtRef(root, ref) {
  const output = git(['ls-tree', '-r', '--name-only', ref, '--', 'migrations'], { root, trim: false });
  return output.split('\n').map((line) => normalizePath(line.trim())).filter(Boolean);
}

function migrationVersion(path) {
  const match = normalizePath(path).match(/^migrations\/(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/);
  return match ? Number(match[1]) : null;
}

export function evaluateMigrationPolicy({
  baseMigrationFiles,
  entries,
  changedTestFiles = [],
  specXml = '',
  planXml = ''
}) {
  const errors = [];
  const baseSet = new Set(baseMigrationFiles.map(normalizePath));
  const migrationEntries = entries.filter((entry) => {
    const candidates = [entry.oldPath, entry.path].filter(Boolean).map(normalizePath);
    return candidates.some((path) => path.startsWith('migrations/'));
  });
  const added = [];
  for (const entry of migrationEntries) {
    if (entry.oldPath && baseSet.has(normalizePath(entry.oldPath))) {
      errors.push(`Applied migration is immutable and cannot be renamed: ${entry.oldPath}.`);
    }
    if (entry.path && baseSet.has(normalizePath(entry.path)) && !entry.status.startsWith('A')) {
      errors.push(`Applied migration is immutable and cannot be modified/deleted: ${entry.path}.`);
    }
    if (entry.status.startsWith('A') && entry.path?.startsWith('migrations/')) {
      added.push(normalizePath(entry.path));
    }
  }
  if (!added.length) return { errors, added };

  const baseVersions = baseMigrationFiles.map(migrationVersion).filter((value) => value !== null);
  const baseMax = baseVersions.length ? Math.max(...baseVersions) : 0;
  const additions = added.map((path) => ({ path, version: migrationVersion(path) }));
  for (const item of additions) {
    if (item.version === null) {
      errors.push(`New migration must use NNN_lowercase_name.sql: ${item.path}.`);
    }
  }
  const validVersions = additions
    .filter((item) => item.version !== null)
    .sort((left, right) => left.version - right.version);
  for (let index = 0; index < validVersions.length; index += 1) {
    const expected = baseMax + index + 1;
    if (validVersions[index].version !== expected) {
      errors.push(
        `Migration sequence must be append-only and contiguous: expected ${String(expected).padStart(3, '0')}, got ${String(validVersions[index].version).padStart(3, '0')} (${validVersions[index].path}).`
      );
    }
  }
  const migrationTests = changedTestFiles.filter(
    (path) => /^tests\/.*migration.*\.test\.mjs$/.test(normalizePath(path))
  );
  if (!migrationTests.length) {
    errors.push('A new migration requires a changed tests/*migration*.test.mjs regression test.');
  }
  if (!/<M-DATABASE\s*\/>/.test(specXml)) {
    errors.push('Schema change spec must include <M-DATABASE /> in AffectedAreas.');
  }
  if (!/<V-M-DATABASE\s*\/>/.test(planXml)) {
    errors.push('Schema change plan must include <V-M-DATABASE /> in DurableScope.VerificationAnchors.');
  }
  return { errors, added };
}

export function runMigrationPolicy({ root = process.cwd(), base = 'origin/main', head = 'HEAD' } = {}) {
  const entries = parseNameStatus(
    git(['diff', '--name-status', '-M', `${base}...${head}`], { root, trim: false })
  );
  const baseFiles = migrationFilesAtRef(root, base);
  const touchedActive = changedChangeIds(entries, 'active');
  const activeAtHead = touchedActive.filter((id) => bundleExistsAtRef(root, head, 'active', id));
  const changeId = activeAtHead.length === 1 ? activeAtHead[0] : null;
  const artifacts = changeId ? bundleArtifactsAtRef(root, head, 'active', changeId) : {};
  const result = evaluateMigrationPolicy({
    baseMigrationFiles: baseFiles,
    entries,
    changedTestFiles: changedPaths(entries).filter((path) => path.startsWith('tests/')),
    specXml: artifacts['spec.xml'] || '',
    planXml: artifacts['plan.xml'] || ''
  });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return { ok: true, added: result.added, changeId };
}

export function checkDatabaseIntegrity({ databasePath, migrationsDir }) {
  const dbPath = resolve(databasePath);
  const migrationRoot = resolve(migrationsDir);
  if (!existsSync(dbPath)) throw new Error(`Database does not exist: ${dbPath}`);
  const database = new DatabaseSync(dbPath, { open: true, readOnly: false, timeout: 30_000 });
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
    const quickRows = database.prepare('PRAGMA quick_check').all();
    const quickErrors = quickRows
      .map((row) => row.quick_check)
      .filter((value) => value !== 'ok');
    if (quickErrors.length) {
      throw new Error(`PRAGMA quick_check failed: ${quickErrors.join('; ')}`);
    }
    const fkRows = database.prepare('PRAGMA foreign_key_check').all();
    if (fkRows.length) {
      throw new Error(`PRAGMA foreign_key_check returned ${fkRows.length} violation(s).`);
    }
    const expected = readdirSync(migrationRoot)
      .filter((name) => /^\d{3}_[a-z0-9][a-z0-9_]*\.sql$/.test(name))
      .sort((left, right) => left.localeCompare(right, 'en'))
      .map((name) => ({ version: Number(name.slice(0, 3)), name }));
    const applied = database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
      .map((row) => ({ version: Number(row.version), name: String(row.name) }));
    if (JSON.stringify(applied) !== JSON.stringify(expected)) {
      throw new Error(
        `schema_migrations mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(applied)}.`
      );
    }
    return {
      ok: true,
      schemaVersion: expected.at(-1)?.version || 0,
      migrations: expected.length
    };
  } finally {
    database.close();
  }
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
  const command = args._[0] || 'policy';
  const root = resolve(args.root || process.cwd());
  const base = args.base || process.env.GRACE_BASE_REF || 'origin/main';
  const head = args.head || process.env.GRACE_HEAD_REF || 'HEAD';
  if (command === 'policy') {
    const result = runPolicy({
      root,
      base,
      head,
      mode: args.mode || process.env.GRACE_POLICY_MODE || 'pr'
    });
    if (args.githubOutput && process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
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
    return;
  }
  if (command === 'migrations') {
    console.log(JSON.stringify(runMigrationPolicy({ root, base, head })));
    return;
  }
  if (command === 'db-integrity') {
    if (!args.database) throw new Error('db-integrity requires --database <path>.');
    console.log(JSON.stringify(checkDatabaseIntegrity({
      databasePath: args.database,
      migrationsDir: args.migrationsDir || resolve(root, 'migrations')
    })));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
