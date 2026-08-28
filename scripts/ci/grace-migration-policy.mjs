import { normalizePath } from './grace-scope-core.mjs';

const MIGRATION_PATTERN = /^migrations\/(\d{3})_([a-z0-9][a-z0-9_]*)\.sql$/;

function migrationVersion(path) {
  const match = normalizePath(path).match(MIGRATION_PATTERN);
  return match ? Number.parseInt(match[1], 10) : null;
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
    const oldPath = entry.oldPath ? normalizePath(entry.oldPath) : null;
    const path = entry.path ? normalizePath(entry.path) : null;
    if (oldPath && baseSet.has(oldPath)) {
      errors.push(`Applied migration is immutable and cannot be renamed: ${oldPath}.`);
    }
    if (path && baseSet.has(path) && !entry.status.startsWith('A')) {
      errors.push(`Applied migration is immutable and cannot be modified or deleted: ${path}.`);
    }
    if (entry.status.startsWith('A') && path?.startsWith('migrations/')) added.push(path);
  }

  if (added.length === 0) return { errors, added };

  const baseVersions = baseMigrationFiles
    .map(migrationVersion)
    .filter((value) => value !== null);
  const baseMax = baseVersions.length ? Math.max(...baseVersions) : 0;
  const additions = added
    .map((path) => ({ path, version: migrationVersion(path) }))
    .sort((a, b) => (a.version ?? Number.MAX_SAFE_INTEGER) - (b.version ?? Number.MAX_SAFE_INTEGER)
      || a.path.localeCompare(b.path, 'en'));

  for (const item of additions) {
    if (item.version === null) {
      errors.push(`New migration must use NNN_lowercase_name.sql: ${item.path}.`);
    }
  }
  const valid = additions.filter((item) => item.version !== null);
  const seen = new Set();
  for (let index = 0; index < valid.length; index += 1) {
    const item = valid[index];
    if (seen.has(item.version)) {
      errors.push(`Duplicate new migration version ${String(item.version).padStart(3, '0')}: ${item.path}.`);
    }
    seen.add(item.version);
    const expected = baseMax + index + 1;
    if (item.version !== expected) {
      errors.push(
        `Migration sequence must be append-only and contiguous: expected ${String(expected).padStart(3, '0')}, `
        + `got ${String(item.version).padStart(3, '0')} (${item.path}).`
      );
    }
  }

  const migrationTests = changedTestFiles
    .map(normalizePath)
    .filter((path) => /^tests\/.*migration.*\.test\.mjs$/.test(path));
  if (migrationTests.length === 0) {
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
