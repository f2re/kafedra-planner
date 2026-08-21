import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { inspectSystem } from './preflight.mjs';

const STABLE_TABLES = [
  'workspaces',
  'documents', 'document_versions', 'extraction_runs',
  'meetings', 'agenda_items', 'decisions', 'calendar_items', 'notification_states',
  'document_templates', 'template_extractions', 'calendar_item_revisions', 'template_drafts',
  'document_blocks', 'extraction_value_overrides',
  'people', 'directives', 'assignments', 'assignment_executors', 'assignment_updates',
  'assignment_evidence', 'periodic_tasks', 'periodic_task_evidence', 'llm_extraction_runs',
  'report_match_candidates',
  'scientific_items', 'scientific_item_authors', 'scientific_item_classifications', 'scientific_item_evidence',
  'report_fact_extractions', 'assignment_plan_metrics', 'assignment_outcomes', 'assignment_metric_observations',
  'person_notification_states', 'plan_fact_metric_corrections', 'plan_fact_saved_views',
  'auth_accounts', 'object_access_policies', 'object_acl_entries',
  'plans', 'plan_items', 'plan_item_assignments', 'plan_document_templates', 'plan_generation_runs',
  'supporting_documents', 'supporting_document_links',
  'organization_units', 'organization_positions', 'person_appointments', 'organization_unit_managers',
  'scientific_author_affiliations',
  'notification_delivery_profiles'
];

const HISTORY_TABLES = [
  'review_items', 'audit_log', 'auth_audit_events', 'notification_deliveries'
];

const INFORMATIONAL_TABLES = [
  'jobs', 'auth_sessions', 'search_fragments', 'entity_facets'
];

const SYSTEMD_PROPERTIES = [
  'ActiveState', 'SubState', 'User', 'Group', 'NoNewPrivileges', 'PrivateTmp',
  'ProtectSystem', 'ProtectHome', 'ReadWritePaths', 'UMask', 'FragmentPath',
  'MainPID', 'ExecMainStatus'
];

function firstValue(row) {
  return row ? Object.values(row)[0] : null;
}

function parseKeyValue(text) {
  return Object.fromEntries(String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function defaultRunner(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, LC_ALL: 'C' }
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : null
  };
}

async function hashFile(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function runtimeInfo() {
  const header = typeof process.report?.getReport === 'function'
    ? process.report.getReport().header : {};
  return {
    executable: process.execPath,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    glibcVersionRuntime: header?.glibcVersionRuntime || null,
    glibcVersionCompiler: header?.glibcVersionCompiler || null
  };
}

async function readOsRelease(path = '/etc/os-release') {
  try {
    const values = parseKeyValue(await readFile(path, 'utf8'));
    return {
      id: values.ID || null,
      idLike: values.ID_LIKE || null,
      name: String(values.NAME || '').replace(/^"|"$/gu, '') || null,
      prettyName: String(values.PRETTY_NAME || '').replace(/^"|"$/gu, '') || null,
      versionId: String(values.VERSION_ID || '').replace(/^"|"$/gu, '') || null,
      version: String(values.VERSION || '').replace(/^"|"$/gu, '') || null
    };
  } catch (error) {
    return { error: String(error?.code || error?.message || error) };
  }
}

function commandVersion(runner, command, args) {
  const result = runner(command, args);
  const text = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return {
    available: result.ok,
    version: text ? text.split(/\r?\n/u).slice(0, 3).join(' | ').slice(0, 800) : null,
    error: result.ok ? null : (result.error || `exit_${result.status ?? 'unknown'}`)
  };
}

function serviceEvidence(runner, name) {
  const result = runner('systemctl', [
    'show', name, '--no-pager',
    `--property=${SYSTEMD_PROPERTIES.join(',')}`
  ]);
  if (!result.ok) {
    return { name, available: false, error: result.error || result.stderr || `exit_${result.status}` };
  }
  const properties = parseKeyValue(result.stdout);
  const checks = {
    active: properties.ActiveState === 'active',
    serviceUser: properties.User === 'kafedra-planner',
    serviceGroup: properties.Group === 'kafedra-planner',
    noNewPrivileges: properties.NoNewPrivileges === 'yes',
    privateTmp: properties.PrivateTmp === 'yes',
    protectSystem: properties.ProtectSystem === 'strict',
    protectHome: ['yes', 'read-only', 'tmpfs'].includes(properties.ProtectHome),
    umask: ['0077', '0007'].includes(properties.UMask)
  };
  return {
    name,
    available: true,
    properties,
    checks,
    hardened: Object.values(checks).every(Boolean)
  };
}

function tableExists(database, name) {
  return Boolean(database.prepare(`
    SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(name));
}

function quotedIdentifier(value) {
  const name = String(value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error(`unsafe_sql_identifier:${name}`);
  return `"${name}"`;
}

function tableCount(database, name) {
  return Number(firstValue(database.prepare(`SELECT COUNT(*) AS count FROM ${quotedIdentifier(name)}`).get()) || 0);
}

function tableCounts(database, names) {
  return Object.fromEntries(names
    .filter((name) => tableExists(database, name))
    .map((name) => [name, tableCount(database, name)]));
}

function stableTableDigest(database, name) {
  const table = quotedIdentifier(name);
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  const primary = columns.filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk));
  const ordering = (primary.length ? primary : columns)
    .map((column) => quotedIdentifier(column.name));
  const sql = `SELECT * FROM ${table}${ordering.length ? ` ORDER BY ${ordering.join(', ')}` : ''}`;
  const hash = createHash('sha256');
  let rows = 0;
  for (const row of database.prepare(sql).iterate()) {
    hash.update(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
    hash.update('\n');
    rows += 1;
  }
  return { rows, sha256: hash.digest('hex') };
}

function stableTablesEvidence(database) {
  const missing = STABLE_TABLES.filter((name) => !tableExists(database, name));
  const tables = Object.fromEntries(STABLE_TABLES
    .filter((name) => tableExists(database, name))
    .map((name) => [name, stableTableDigest(database, name)]));
  const digest = createHash('sha256')
    .update(Object.entries(tables).map(([name, item]) => `${name}:${item.rows}:${item.sha256}`).join('\n'))
    .digest('hex');
  return { missing, tables, digest };
}

async function blobEvidence(database) {
  if (!tableExists(database, 'file_blobs')) {
    return {
      count: 0, totalBytes: 0, verified: 0, missing: [], mismatched: [],
      digest: createHash('sha256').update('').digest('hex'), entries: []
    };
  }
  const rows = database.prepare(`
    SELECT sha256, size_bytes, storage_path FROM file_blobs ORDER BY sha256
  `).all();
  const entries = [];
  const missing = [];
  const mismatched = [];
  let totalBytes = 0;
  for (const row of rows) {
    const expectedSize = Number(row.size_bytes || 0);
    totalBytes += expectedSize;
    try {
      const info = await stat(row.storage_path);
      const actualSha256 = await hashFile(row.storage_path);
      const actualSize = Number(info.size);
      const ok = info.isFile() && actualSize === expectedSize && actualSha256 === row.sha256;
      const entry = { sha256: row.sha256, expectedSize, actualSize, actualSha256, ok };
      entries.push(entry);
      if (!ok) mismatched.push(entry);
    } catch (error) {
      missing.push({ sha256: row.sha256, expectedSize, error: String(error?.code || error?.message || error) });
      entries.push({ sha256: row.sha256, expectedSize, actualSize: null, actualSha256: null, ok: false });
    }
  }
  const digest = createHash('sha256')
    .update(entries.map((entry) => `${entry.sha256}:${entry.expectedSize}:${entry.actualSha256 || '-'}:${entry.actualSize ?? '-'}:${entry.ok ? 1 : 0}`).join('\n'))
    .digest('hex');
  return {
    count: entries.length,
    totalBytes,
    verified: entries.filter((entry) => entry.ok).length,
    missing,
    mismatched,
    digest,
    entries
  };
}

async function databaseEvidence(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const quickCheck = String(firstValue(database.prepare('PRAGMA quick_check').get()) || 'unknown');
    database.exec('BEGIN');
    try {
      const schemaVersion = tableExists(database, 'schema_migrations')
        ? Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version || 0)
        : 0;
      const stable = stableTablesEvidence(database);
      return {
        quickCheck,
        schemaVersion,
        stableTableCounts: Object.fromEntries(Object.entries(stable.tables).map(([name, item]) => [name, item.rows])),
        stableTableDigests: Object.fromEntries(Object.entries(stable.tables).map(([name, item]) => [name, item.sha256])),
        stableDigest: stable.digest,
        missingStableTables: stable.missing,
        historyTableCounts: tableCounts(database, HISTORY_TABLES),
        informationalTableCounts: tableCounts(database, INFORMATIONAL_TABLES),
        blobs: await blobEvidence(database)
      };
    } finally {
      database.exec('ROLLBACK');
    }
  } finally {
    database.close();
  }
}

async function applicationVersion(applicationDir) {
  try {
    return (await readFile(`${applicationDir}/VERSION`, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

async function latestBackupEvidence(backupDir) {
  try {
    const payload = JSON.parse(await readFile(`${backupDir}/latest-success.json`, 'utf8'));
    const archiveCandidate = payload.archivePath || payload.archive_path || payload.archiveName || payload.archive_name || payload.archive || null;
    const archiveName = archiveCandidate ? basename(String(archiveCandidate)) : null;
    const archivePath = archiveName ? join(backupDir, archiveName) : null;
    let archivePresent = false;
    let archiveSize = null;
    let archiveSha256 = null;
    if (archivePath) {
      try {
        const info = await stat(archivePath);
        archivePresent = info.isFile();
        if (archivePresent) {
          archiveSize = Number(info.size);
          archiveSha256 = await hashFile(archivePath);
        }
      } catch {}
    }
    return {
      present: true,
      archiveName,
      archivePresent,
      archiveSize,
      archiveSha256,
      createdAt: payload.createdAt || payload.created_at || null,
      verifiedAt: payload.verifiedAt || payload.verified_at || payload.completedAt || null,
      schemaVersion: payload.schemaVersion ?? payload.schema_version ?? null,
      appVersion: payload.appVersion || payload.app_version || null,
      encrypted: payload.encrypted === true
    };
  } catch (error) {
    return { present: false, archivePresent: false, error: String(error?.code || error?.message || error) };
  }
}

function evaluate({ preflight, database, services, backup, applicationVersion: version, requireFull }) {
  const failures = [];
  const warnings = [];
  if (preflight.requiredMissing?.length) failures.push(`preflight_required:${preflight.requiredMissing.join(',')}`);
  if (requireFull && !preflight.capabilities?.ocr) failures.push('preflight_ocr_missing');
  if (requireFull && !preflight.capabilities?.officePreview) failures.push('preflight_office_preview_missing');
  if (!preflight.capabilities?.reverseProxy) warnings.push('reverse_proxy_not_detected');
  if (database.quickCheck !== 'ok') failures.push(`sqlite_quick_check:${database.quickCheck}`);
  if (database.missingStableTables.length) failures.push(`stable_tables_missing:${database.missingStableTables.join(',')}`);
  if (database.blobs.missing.length) failures.push(`blob_missing:${database.blobs.missing.length}`);
  if (database.blobs.mismatched.length) failures.push(`blob_mismatch:${database.blobs.mismatched.length}`);
  for (const service of services) {
    if (!service.available) failures.push(`service_unavailable:${service.name}`);
    else if (!service.hardened) failures.push(`service_hardening:${service.name}`);
  }
  if (requireFull) {
    if (!backup.present || !backup.archivePresent) failures.push('backup_missing');
    if (backup.present && !backup.verifiedAt) failures.push('backup_unverified');
    if (backup.present && !backup.encrypted) failures.push('backup_not_encrypted');
    if (backup.present && Number(backup.schemaVersion) !== Number(database.schemaVersion)) failures.push('backup_schema_mismatch');
    if (backup.present && version && backup.appVersion && backup.appVersion !== version) failures.push('backup_version_mismatch');
  } else if (!backup.present || !backup.archivePresent) {
    warnings.push('verified_backup_not_detected');
  }
  return { status: failures.length ? 'fail' : warnings.length ? 'pass_with_warnings' : 'pass', failures, warnings };
}

export async function collectAcceptanceEvidence({
  databasePath, dataDir, backupDir, applicationDir, requireFull = false,
  osReleasePath = '/etc/os-release',
  services = ['kafedra-planner-api.service', 'kafedra-planner-worker.service'],
  runner = defaultRunner, preflightResult = null
}) {
  if (!databasePath) throw new Error('acceptance_database_path_required');
  const preflight = preflightResult || inspectSystem();
  const database = await databaseEvidence(databasePath);
  const serviceEvidenceList = services.map((name) => serviceEvidence(runner, name));
  const version = await applicationVersion(applicationDir);
  const backup = await latestBackupEvidence(backupDir);
  const evidence = {
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    host: hostname(),
    application: { version, applicationDir, dataDir, databaseFile: databasePath.split('/').at(-1) },
    runtime: runtimeInfo(),
    os: await readOsRelease(osReleasePath),
    uname: commandVersion(runner, 'uname', ['-a']),
    ldd: commandVersion(runner, 'ldd', [process.execPath]),
    tools: {
      pdftotext: commandVersion(runner, 'pdftotext', ['-v']),
      pdftoppm: commandVersion(runner, 'pdftoppm', ['-v']),
      tesseract: commandVersion(runner, 'tesseract', ['--version']),
      libreoffice: commandVersion(runner, preflight.checks?.find((check) => check.id === 'libreoffice')?.command || 'libreoffice', ['--version'])
    },
    preflight,
    database,
    services: serviceEvidenceList,
    backup
  };
  evidence.acceptance = evaluate({ preflight, database, services: serviceEvidenceList, backup, applicationVersion: version, requireFull });
  return evidence;
}

export function compareAcceptanceEvidence(before, after) {
  const differences = [];
  const push = (field, left, right) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ field, before: left, after: right });
  };
  push('application.version', before?.application?.version, after?.application?.version);
  push('database.schemaVersion', before?.database?.schemaVersion, after?.database?.schemaVersion);
  push('database.stableTableCounts', before?.database?.stableTableCounts, after?.database?.stableTableCounts);
  push('database.stableTableDigests', before?.database?.stableTableDigests, after?.database?.stableTableDigests);
  push('database.stableDigest', before?.database?.stableDigest, after?.database?.stableDigest);
  push('database.blobs.count', before?.database?.blobs?.count, after?.database?.blobs?.count);
  push('database.blobs.totalBytes', before?.database?.blobs?.totalBytes, after?.database?.blobs?.totalBytes);
  push('database.blobs.digest', before?.database?.blobs?.digest, after?.database?.blobs?.digest);
  const beforeHistory = before?.database?.historyTableCounts || {};
  const afterHistory = after?.database?.historyTableCounts || {};
  for (const [table, count] of Object.entries(beforeHistory)) {
    const afterCount = Number(afterHistory[table] ?? -1);
    if (afterCount < Number(count)) differences.push({ field: `database.historyTableCounts.${table}`, before: count, after: afterCount, rule: 'must_not_decrease' });
  }
  return { status: differences.length ? 'different' : 'equal', differences };
}
