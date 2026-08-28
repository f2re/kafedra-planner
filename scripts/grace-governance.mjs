#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const GOVERNED_PREFIXES = [
  'apps/', 'packages/', 'public/', 'migrations/', 'scripts/', 'deploy/', 'config/',
  '.github/workflows/'
];
const GOVERNED_FILES = new Set([
  'package.json', 'package-lock.json', 'AGENTS.md', 'docs/CODEX_AGENTS.md', 'docs/ARCHITECTURE.md'
]);

function git(args, { root = process.cwd(), trim = true } = {}) {
  const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
  const section = xml.match(new RegExp(`<${sectionName}>([\\s\\S]*?)</${sectionName}>`));
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

function isGovernedPath(path) {
  const normalized = normalizePath(path);
  return GOVERNED_FILES.has(normalized) || GOVERNED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function changedPaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.oldPath) paths.push(entry.oldPath);
    if (entry.path) paths.push(entry.path);
  }
  return [...new Set(paths)];
}

function changedActiveChangeIds(entries) {
  const ids = new Set();
  for (const path of changedPaths(entries)) {
    const match = path.match(/^\.grace\/changes\/active\/(C-[A-Z0-9-]+)\//);
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

function assertApprovedArtifact(xml, rootTag, changeId, file) {
  const root = xml.match(new RegExp(`<${rootTag}\\b([^>]*)>`));
  if (!root) throw new Error(`${file}: expected <${rootTag}> root.`);
  if (!/\bgraceVersion="4\.0"/.test(root[1])) throw new Error(`${file}: graceVersion must be 4.0.`);
  if (!/\bstatus="approved"/.test(root[1])) throw new Error(`${file}: status must be approved.`);
  if (!new RegExp(`<${changeId}(?:>|\\s)`).test(xml)) throw new Error(`${file}: missing ${changeId} wrapper.`);
}

export function evaluateGovernance({ entries, changeId, specXml, planXml }) {
  const errors = [];
  const paths = changedPaths(entries);
  const governed = paths.filter(isGovernedPath);
  if (governed.length === 0 && !changeId) return { errors, governed, paths };
  if (!changeId) {
    errors.push(`Governed diff requires exactly one active C-* change; changed governed paths: ${governed.join(', ')}`);
    return { errors, governed, paths };
  }
  try { assertApprovedArtifact(specXml, 'GraceChangeSpec', changeId, `${changeId}/spec.xml`); } catch (error) { errors.push(error.message); }
  try { assertApprovedArtifact(planXml, 'GraceChangePlan', changeId, `${changeId}/plan.xml`); } catch (error) { errors.push(error.message); }
  try {
    const scope = extractObservedWriteScope(planXml);
    if (scope.files.length === 0 && scope.globs.length === 0) {
      errors.push(`${changeId}/plan.xml: ObservedWriteScope is empty.`);
    } else {
      const outOfScope = validateObservedWriteScope(paths, scope);
      if (outOfScope.length) errors.push(`Observed writes outside ${changeId} scope: ${outOfScope.join(', ')}`);
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { errors, governed, paths };
}

function resolveChangeBundle(root, changeId) {
  const dir = resolve(root, '.grace', 'changes', 'active', changeId);
  return {
    dir,
    spec: resolve(dir, 'spec.xml'),
    plan: resolve(dir, 'plan.xml')
  };
}

export function runPolicy({ root = process.cwd(), base = 'origin/main', head = 'HEAD' } = {}) {
  const diff = parseNameStatus(git(['diff', '--name-status', '-M', `${base}...${head}`], { root, trim: false }));
  const ids = changedActiveChangeIds(diff);
  const governed = changedPaths(diff).filter(isGovernedPath);
  if (governed.length > 0 && ids.length !== 1) {
    throw new Error(`Governed diff must introduce/update exactly one active C-* bundle; found ${ids.length}: ${ids.join(', ') || 'none'}.`);
  }
  if (ids.length > 1) throw new Error(`Only one active C-* bundle is allowed per branch diff; found: ${ids.join(', ')}.`);
  const changeId = ids[0] || null;
  if (!changeId) return { ok: true, changeId: null, paths: changedPaths(diff), governed };
  const bundle = resolveChangeBundle(root, changeId);
  if (!existsSync(bundle.spec) || !existsSync(bundle.plan)) {
    throw new Error(`${changeId} must contain spec.xml and plan.xml.`);
  }
  const result = evaluateGovernance({
    entries: diff,
    changeId,
    specXml: readFileSync(bundle.spec, 'utf8'),
    planXml: readFileSync(bundle.plan, 'utf8')
  });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return { ok: true, changeId, paths: result.paths, governed: result.governed };
}

function migrationFilesAtRef(root, ref) {
  const output = git(['ls-tree', '-r', '--name-only', ref, '--', 'migrations'], { root, trim: false });
  return output.split('\n').map((line) => normalizePath(line.trim())).filter(Boolean);
}

function migrationVersion(path) {
  const match = normalizePath(path).match(/^migrations\/(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/);
  return match ? Number(match[1]) : null;
}

export function evaluateMigrationPolicy({ baseMigrationFiles, entries, changedTestFiles = [], specXml = '', planXml = '' }) {
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
    if (entry.status.startsWith('D') && entry.path && baseSet.has(normalizePath(entry.path))) {
      errors.push(`Applied migration is immutable and cannot be deleted: ${entry.path}.`);
    }
    if (entry.status.startsWith('A') && entry.path?.startsWith('migrations/')) added.push(normalizePath(entry.path));
  }
  if (!added.length) return { errors, added };

  const baseVersions = baseMigrationFiles.map(migrationVersion).filter((value) => value !== null);
  const baseMax = baseVersions.length ? Math.max(...baseVersions) : 0;
  const additions = added.map((path) => ({ path, version: migrationVersion(path) }));
  for (const item of additions) {
    if (item.version === null) errors.push(`New migration must use NNN_lowercase_name.sql: ${item.path}.`);
  }
  const validVersions = additions.filter((item) => item.version !== null).sort((a, b) => a.version - b.version);
  for (let index = 0; index < validVersions.length; index += 1) {
    const expected = baseMax + index + 1;
    if (validVersions[index].version !== expected) {
      errors.push(`Migration sequence must be append-only and contiguous: expected ${String(expected).padStart(3, '0')}, got ${String(validVersions[index].version).padStart(3, '0')} (${validVersions[index].path}).`);
    }
  }
  const migrationTests = changedTestFiles.filter((path) => /^tests\/.*migration.*\.test\.mjs$/.test(normalizePath(path)));
  if (!migrationTests.length) errors.push('A new migration requires a changed tests/*migration*.test.mjs regression test.');
  if (!/<M-DATABASE\s*\/>/.test(specXml)) errors.push('Schema change spec must include <M-DATABASE /> in AffectedAreas.');
  if (!/<V-M-DATABASE\s*\/>/.test(planXml)) errors.push('Schema change plan must include <V-M-DATABASE /> in DurableScope.VerificationAnchors.');
  return { errors, added };
}

export function runMigrationPolicy({ root = process.cwd(), base = 'origin/main', head = 'HEAD' } = {}) {
  const entries = parseNameStatus(git(['diff', '--name-status', '-M', `${base}...${head}`], { root, trim: false }));
  const baseFiles = migrationFilesAtRef(root, base);
  const ids = changedActiveChangeIds(entries);
  const changeId = ids.length === 1 ? ids[0] : null;
  let specXml = '';
  let planXml = '';
  if (changeId) {
    const bundle = resolveChangeBundle(root, changeId);
    if (existsSync(bundle.spec)) specXml = readFileSync(bundle.spec, 'utf8');
    if (existsSync(bundle.plan)) planXml = readFileSync(bundle.plan, 'utf8');
  }
  const result = evaluateMigrationPolicy({
    baseMigrationFiles: baseFiles,
    entries,
    changedTestFiles: changedPaths(entries).filter((path) => path.startsWith('tests/')),
    specXml,
    planXml
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
    const quickErrors = quickRows.map((row) => row.quick_check).filter((value) => value !== 'ok');
    if (quickErrors.length) throw new Error(`PRAGMA quick_check failed: ${quickErrors.join('; ')}`);
    const fkRows = database.prepare('PRAGMA foreign_key_check').all();
    if (fkRows.length) throw new Error(`PRAGMA foreign_key_check returned ${fkRows.length} violation(s).`);
    const expected = readdirSync(migrationRoot)
      .filter((name) => /^\d{3}_[a-z0-9][a-z0-9_]*\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b, 'en'))
      .map((name) => ({ version: Number(name.slice(0, 3)), name }));
    const applied = database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
      .map((row) => ({ version: Number(row.version), name: String(row.name) }));
    if (JSON.stringify(applied) !== JSON.stringify(expected)) {
      throw new Error(`schema_migrations mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(applied)}.`);
    }
    return { ok: true, schemaVersion: expected.at(-1)?.version || 0, migrations: expected.length };
  } finally {
    database.close();
  }
}

function parseArgs(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { values._.push(value); continue; }
    const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { values[key] = next; index += 1; }
    else values[key] = true;
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
    const result = runPolicy({ root, base, head });
    if (args.githubOutput && process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_OUTPUT, `change_id=${result.changeId || ''}\n`);
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
