import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  collectAcceptanceEvidence as collectBaseEvidence,
  compareAcceptanceEvidence as compareBaseEvidence
} from './acceptance.mjs';

export const V020_STABLE_TABLES = [
  'organizational_units',
  'organization_positions',
  'person_appointments',
  'scientific_author_affiliations',
  'scientific_item_revisions',
  'scientific_lifecycle_events',
  'scientific_item_plan_links',
  'scientific_item_manual_overrides',
  'science_import_runs',
  'science_import_rows',
  'science_report_runs',
  'meeting_template_catalog',
  'meeting_template_test_runs',
  'docomator_field_mappings',
  'docomator_person_fields'
];

function quoted(value) {
  const name = String(value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error(`unsafe_sql_identifier:${name}`);
  return `"${name}"`;
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function digestTable(database, name) {
  const table = quoted(name);
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  const primary = columns.filter((column) => Number(column.pk) > 0).sort((left, right) => Number(left.pk) - Number(right.pk));
  const ordering = (primary.length ? primary : columns).map((column) => quoted(column.name));
  const hash = createHash('sha256');
  let rows = 0;
  for (const row of database.prepare(`SELECT * FROM ${table}${ordering.length ? ` ORDER BY ${ordering.join(',')}` : ''}`).iterate()) {
    hash.update(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
    hash.update('\n');
    rows += 1;
  }
  return { rows, sha256: hash.digest('hex') };
}

export function collectV020DatabaseEvidence(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const missing = V020_STABLE_TABLES.filter((name) => !tableExists(database, name));
    const tables = Object.fromEntries(V020_STABLE_TABLES.filter((name) => tableExists(database, name))
      .map((name) => [name, digestTable(database, name)]));
    const digest = createHash('sha256')
      .update(Object.entries(tables).map(([name, item]) => `${name}:${item.rows}:${item.sha256}`).join('\n'))
      .digest('hex');
    return { missing, tables, digest };
  } finally {
    database.close();
  }
}

export async function collectAcceptanceEvidence020(options) {
  const base = await collectBaseEvidence(options);
  const v020 = collectV020DatabaseEvidence(options.databasePath);
  const failures = [...(base.acceptance?.failures || [])];
  if (v020.missing.length) failures.push(`v020_stable_tables_missing:${v020.missing.join(',')}`);
  return {
    ...base,
    formatVersion: 3,
    database: { ...base.database, v020 },
    acceptance: {
      ...base.acceptance,
      status: failures.length ? 'fail' : base.acceptance?.status,
      failures
    }
  };
}

export function compareAcceptanceEvidence020(before, after) {
  const base = compareBaseEvidence(before, after);
  const differences = [...(base.differences || [])];
  if (before?.database?.v020?.digest !== after?.database?.v020?.digest) {
    differences.push({
      field: 'database.v020.digest',
      before: before?.database?.v020?.digest || null,
      after: after?.database?.v020?.digest || null
    });
  }
  if (JSON.stringify(before?.database?.v020?.tables || {}) !== JSON.stringify(after?.database?.v020?.tables || {})) {
    differences.push({
      field: 'database.v020.tables',
      before: before?.database?.v020?.tables || {},
      after: after?.database?.v020?.tables || {}
    });
  }
  return { status: differences.length ? 'different' : 'equal', differences };
}
