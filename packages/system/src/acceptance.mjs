import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { inspectSystem } from './preflight.mjs';

const STABLE_TABLES = [
  'file_blobs', 'documents', 'document_versions', 'document_blocks',
  'directives', 'assignments', 'assignment_executors', 'assignment_evidence',
  'scientific_items', 'plans', 'plan_items', 'templates', 'template_fields',
  'plan_document_templates', 'plan_generation_runs'
];

const INFORMATIONAL_TABLES = [
  'calendar_items', 'review_items', 'jobs', 'audit_log', 'auth_accounts',
  'auth_sessions', 'notification_delivery_profiles', 'notification_deliveries'
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

function tableCounts(database, names) {
  return Object.fromEntries(names
    .filter((name) => tableExists(database, name))
    .map((name) => [name, Number(firstValue(database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()) || 0)]));
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
      const entry = {
        sha256: row.sha256,
        expectedSize,
        actualSize,
        actualSha256,
        ok
      };
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
    const schemaVersion = tableExists(database, 'schema_migrations')
      ? Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version || 0)
      : 0;
    return {
      quickCheck,
      schemaVersion,
      stableTableCounts: tableCounts(database, STABLE_TABLES),
      informationalTableCounts: tableCounts(database, INFORMATIONAL_TABLES),
      blobs: await blobEvidence(database)
    };
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
    const archiveName = payload.archiveName || payload.archive_name || payload.archive || null;
    return {
      present: true,
      archiveName: archiveName ? String(archiveName).split('/').at(-1) : null,
      createdAt: payload.createdAt || payload.created_at || null,
      verifiedAt: payload.verifiedAt || payload.verified_at || payload.completedAt || null,
      schemaVersion: payload.schemaVersion ?? payload.schema_version ?? null,
      appVersion: payload.appVersion || payload.app_version || null,
      encrypted: payload.encrypted === true
    };
  } catch (error) {
    return { present: false, error: String(error?.code || error?.message || error) };
  }
}

function evaluate({ preflight, database, services, requireFull }) {
  const failures = [];
  const warnings = [];
  if (preflight.requiredMissing?.length) failures.push(`preflight_required:${preflight.requiredMissing.join(',')}`);
  if (requireFull && !preflight.capabilities?.ocr) failures.push('preflight_ocr_missing');
  if (requireFull && !preflight.capabilities?.officePreview) failures.push('preflight_office_preview_missing');
  if (!preflight.capabilities?.reverseProxy) warnings.push('reverse_proxy_not_detected');
  if (database.quickCheck !== 'ok') failures.push(`sqlite_quick_check:${database.quickCheck}`);
  if (database.blobs.missing.length) failures.push(`blob_missing:${database.blobs.missing.length}`);
  if (database.blobs.mismatched.length) failures.push(`blob_mismatch:${database.blobs.mismatched.length}`);
  for (const service of services) {
    if (!service.available) failures.push(`service_unavailable:${service.name}`);
    else if (!service.hardened) failures.push(`service_hardening:${service.name}`);
  }
  return {
    status: failures.length ? 'fail' : warnings.length ? 'pass_with_warnings' : 'pass',
    failures,
    warnings
  };
}

export async function collectAcceptanceEvidence({
  databasePath,
  dataDir,
  backupDir,
  applicationDir,
  requireFull = false,
  osReleasePath = '/etc/os-release',
  services = ['kafedra-planner-api.service', 'kafedra-planner-worker.service'],
  runner = defaultRunner,
  preflightResult = null
}) {
  if (!databasePath) throw new Error('acceptance_database_path_required');
  const preflight = preflightResult || inspectSystem();
  const database = await databaseEvidence(databasePath);
  const serviceEvidenceList = services.map((name) => serviceEvidence(runner, name));
  const evidence = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    host: hostname(),
    application: {
      version: await applicationVersion(applicationDir),
      applicationDir,
      dataDir,
      databaseFile: databasePath.split('/').at(-1)
    },
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
    backup: await latestBackupEvidence(backupDir)
  };
  evidence.acceptance = evaluate({ preflight, database, services: serviceEvidenceList, requireFull });
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
  push('database.blobs.count', before?.database?.blobs?.count, after?.database?.blobs?.count);
  push('database.blobs.totalBytes', before?.database?.blobs?.totalBytes, after?.database?.blobs?.totalBytes);
  push('database.blobs.digest', before?.database?.blobs?.digest, after?.database?.blobs?.digest);
  return {
    status: differences.length ? 'different' : 'equal',
    differences
  };
}
