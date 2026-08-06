import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync
} from 'node:crypto';
import {
  createReadStream,
  createWriteStream
} from 'node:fs';
import {
  access,
  appendFile,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep
} from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const ARCHIVE_ROOT = 'kafedra-backup';
const ENCRYPTED_MAGIC = Buffer.from('KPBENC1\0');
const ENCRYPTED_HEADER_BYTES = ENCRYPTED_MAGIC.length + 16 + 12 + 16;
const JOURNAL_NAME = 'backup-journal.jsonl';
const LATEST_NAME = 'latest-success.json';

async function exists(path) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeStamp(value = new Date()) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function normalizeVersion(value) {
  return String(value || 'unknown').trim().replace(/[^0-9A-Za-z._-]+/g, '-');
}

async function run(command, args, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolvePromise({ stdout: out, stderr: err });
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      reject(new Error(`${command} failed with ${reason}: ${err || out}`));
    });
  });
}

async function hashFile(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function fileRecords(root, { exclude = new Set() } = {}) {
  const records = [];
  for (const path of await walkFiles(root)) {
    const name = relative(root, path).split(sep).join('/');
    if (exclude.has(name)) continue;
    const info = await stat(path);
    records.push({ path: name, size: info.size, sha256: await hashFile(path) });
  }
  return records;
}

async function readVersion(versionPath) {
  if (!versionPath || !(await exists(versionPath))) return 'unknown';
  return String(await readFile(versionPath, 'utf8')).trim() || 'unknown';
}

function openReadonlyDatabase(path) {
  const database = new DatabaseSync(path, {
    open: true,
    readOnly: true,
    timeout: 30_000
  });
  database.exec('PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON;');
  return database;
}

export function databaseSchemaVersion(databasePath) {
  if (!databasePath) return 0;
  let database;
  try {
    database = openReadonlyDatabase(databasePath);
    const table = database.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get();
    if (!table) return 0;
    return Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version || 0);
  } finally {
    database?.close();
  }
}

export async function latestMigrationVersion(migrationsDir) {
  if (!migrationsDir || !(await exists(migrationsDir))) return 0;
  const versions = (await readdir(migrationsDir))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .map((name) => Number.parseInt(name.split('_', 1)[0], 10))
    .filter(Number.isFinite);
  return versions.length ? Math.max(...versions) : 0;
}

export async function hasPendingMigrations(databasePath, migrationsDir) {
  if (!(await exists(databasePath))) return false;
  return databaseSchemaVersion(databasePath) < await latestMigrationVersion(migrationsDir);
}

async function sqliteSnapshot(databasePath, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const source = openReadonlyDatabase(databasePath);
  try {
    await sqliteBackup(source, destination, { rate: 256 });
  } finally {
    source.close();
  }
}

function ensureArchiveEntrySafe(entry) {
  const normalized = entry.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  const parts = normalized.split('/').filter(Boolean);
  return !parts.includes('..');
}

async function assertSafeTar(archivePath) {
  const { stdout } = await run('tar', ['-tzf', archivePath]);
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error('Backup archive is empty.');
  for (const entry of entries) {
    if (!ensureArchiveEntrySafe(entry)) throw new Error(`Unsafe archive entry: ${entry}`);
  }
  const { stdout: verbose } = await run('tar', ['-tvzf', archivePath]);
  for (const line of verbose.split(/\r?\n/).filter(Boolean)) {
    const type = line[0];
    if (type !== '-' && type !== 'd') {
      throw new Error(`Unsupported archive entry type: ${type}`);
    }
  }
  if (!entries.some((entry) => entry === `${ARCHIVE_ROOT}/manifest.json`)) {
    throw new Error('Backup manifest is missing.');
  }
  return entries;
}

async function encryptArchive(inputPath, outputPath, keyFile) {
  const secret = await readFile(keyFile);
  if (secret.length < 16) throw new Error('Backup encryption key file must contain at least 16 bytes.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const cipherPath = `${outputPath}.cipher-${process.pid}`;
  try {
    await pipeline(createReadStream(inputPath), cipher, createWriteStream(cipherPath, { mode: 0o600 }));
    const tag = cipher.getAuthTag();
    const descriptor = await open(outputPath, 'w', 0o600);
    try {
      await descriptor.write(Buffer.concat([ENCRYPTED_MAGIC, salt, iv, tag]));
    } finally {
      await descriptor.close();
    }
    await pipeline(
      createReadStream(cipherPath),
      createWriteStream(outputPath, { flags: 'a', mode: 0o600 })
    );
  } finally {
    await rm(cipherPath, { force: true });
  }
}

async function decryptArchive(inputPath, outputPath, keyFile) {
  if (!keyFile) throw new Error('Encrypted backup requires --key-file or KAFEDRA_BACKUP_KEY_FILE.');
  const descriptor = await open(inputPath, 'r');
  const header = Buffer.alloc(ENCRYPTED_HEADER_BYTES);
  try {
    const { bytesRead } = await descriptor.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)) {
      throw new Error('Unsupported encrypted backup format.');
    }
  } finally {
    await descriptor.close();
  }
  const saltOffset = ENCRYPTED_MAGIC.length;
  const ivOffset = saltOffset + 16;
  const tagOffset = ivOffset + 12;
  const salt = header.subarray(saltOffset, ivOffset);
  const iv = header.subarray(ivOffset, tagOffset);
  const tag = header.subarray(tagOffset, tagOffset + 16);
  const secret = await readFile(keyFile);
  const key = scryptSync(secret, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(inputPath, { start: ENCRYPTED_HEADER_BYTES }),
    decipher,
    createWriteStream(outputPath, { mode: 0o600 })
  );
}

async function isEncryptedArchive(path) {
  const descriptor = await open(path, 'r');
  const magic = Buffer.alloc(ENCRYPTED_MAGIC.length);
  try {
    const { bytesRead } = await descriptor.read(magic, 0, magic.length, 0);
    return bytesRead === magic.length && magic.equals(ENCRYPTED_MAGIC);
  } finally {
    await descriptor.close();
  }
}

async function appendJournal(backupDir, record) {
  await mkdir(backupDir, { recursive: true });
  await appendFile(join(backupDir, JOURNAL_NAME), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (record.action === 'create' && record.status === 'success') {
    const temporary = join(backupDir, `${LATEST_NAME}.tmp-${process.pid}`);
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, join(backupDir, LATEST_NAME));
  }
}

export async function readLatestBackupStatus(backupDir) {
  const path = join(backupDir, LATEST_NAME);
  if (!(await exists(path))) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function rotateBackups(backupDir, keep) {
  if (!Number.isFinite(keep) || keep < 1 || !(await exists(backupDir))) return [];
  const candidates = [];
  for (const name of await readdir(backupDir)) {
    if (!/^kafedra-planner-backup-.*\.(?:tar\.gz|kpb)$/.test(name)) continue;
    const path = join(backupDir, name);
    const info = await stat(path);
    candidates.push({ path, name, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  const removed = [];
  for (const item of candidates.slice(keep)) {
    await rm(item.path, { force: true });
    removed.push(item.name);
  }
  return removed;
}

async function materializeArchive(archivePath, { keyFile } = {}) {
  const workDir = await mkdtemp(join(tmpdir(), 'kafedra-backup-verify-'));
  let tarPath = archivePath;
  try {
    if (await isEncryptedArchive(archivePath)) {
      tarPath = join(workDir, 'decrypted.tar.gz');
      await decryptArchive(archivePath, tarPath, keyFile);
    }
    await assertSafeTar(tarPath);
    await run('tar', ['-xzf', tarPath, '-C', workDir]);
    const root = join(workDir, ARCHIVE_ROOT);
    const manifestPath = join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.format !== 'kafedra-planner-backup' || manifest.formatVersion !== 1) {
      throw new Error('Unsupported backup manifest format.');
    }
    return { workDir, root, manifest, tarPath };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

async function verifyMaterialized(root, manifest) {
  const expected = new Map((manifest.files || []).map((record) => [record.path, record]));
  if (!expected.size) throw new Error('Backup manifest contains no files.');
  const actual = new Set(
    (await walkFiles(root))
      .map((path) => relative(root, path).split(sep).join('/'))
      .filter((name) => name !== 'manifest.json')
  );
  if (actual.size !== expected.size) {
    throw new Error(`Backup manifest file count mismatch: ${actual.size} != ${expected.size}`);
  }
  for (const name of actual) {
    if (!expected.has(name)) throw new Error(`Backup contains unmanifested file: ${name}`);
  }
  for (const [name, record] of expected) {
    if (!ensureArchiveEntrySafe(name)) throw new Error(`Unsafe manifest path: ${name}`);
    const path = join(root, ...name.split('/'));
    const info = await stat(path);
    if (!info.isFile() || info.size !== Number(record.size)) {
      throw new Error(`Backup file size mismatch: ${name}`);
    }
    if (await hashFile(path) !== record.sha256) {
      throw new Error(`Backup checksum mismatch: ${name}`);
    }
  }
  const databasePath = join(root, ...String(manifest.contents?.database || '').split('/'));
  const database = openReadonlyDatabase(databasePath);
  try {
    const quickCheck = database.prepare('PRAGMA quick_check').get()?.quick_check;
    if (quickCheck !== 'ok') throw new Error(`Restored database quick_check failed: ${quickCheck}`);
    const schemaVersion = Number(database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version || 0);
    if (schemaVersion !== Number(manifest.schemaVersion || 0)) {
      throw new Error(`Schema version mismatch: ${schemaVersion} != ${manifest.schemaVersion}`);
    }
  } finally {
    database.close();
  }
  return { fileCount: expected.size, databasePath };
}

export async function verifyBackup({ archivePath, keyFile = null } = {}) {
  if (!archivePath || !(await exists(archivePath))) throw new Error('Backup archive does not exist.');
  const materialized = await materializeArchive(resolve(archivePath), { keyFile });
  try {
    const verified = await verifyMaterialized(materialized.root, materialized.manifest);
    return {
      status: 'ok',
      archivePath: resolve(archivePath),
      encrypted: await isEncryptedArchive(resolve(archivePath)),
      manifest: materialized.manifest,
      ...verified
    };
  } finally {
    await rm(materialized.workDir, { recursive: true, force: true });
  }
}

export async function createBackup({
  databasePath,
  dataDir,
  blobDir = join(dataDir, 'blobs'),
  configPath = null,
  applicationDir = null,
  versionPath = applicationDir ? join(applicationDir, 'VERSION') : null,
  backupDir,
  keyFile = null,
  includeApplication = true,
  keep = 14,
  reason = 'manual',
  now = new Date()
} = {}) {
  if (!databasePath || !(await exists(databasePath))) throw new Error('SQLite database does not exist.');
  if (!backupDir) throw new Error('Backup directory is required.');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const workDir = await mkdtemp(join(tmpdir(), 'kafedra-backup-create-'));
  const root = join(workDir, ARCHIVE_ROOT);
  const appVersion = await readVersion(versionPath);
  const schemaVersion = databaseSchemaVersion(databasePath);
  const stamp = safeStamp(now);
  const baseName = `kafedra-planner-backup-${stamp}-${normalizeVersion(appVersion)}`;
  const rawArchive = join(workDir, `${baseName}.tar.gz`);
  const finalArchive = join(backupDir, keyFile ? `${baseName}.kpb` : `${baseName}.tar.gz`);
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const databaseRelative = 'database/kafedra-planner.sqlite3';
    await sqliteSnapshot(databasePath, join(root, databaseRelative));
    let blobsRelative = null;
    if (blobDir && await exists(blobDir)) {
      blobsRelative = 'blobs';
      await cp(blobDir, join(root, blobsRelative), { recursive: true, force: true, preserveTimestamps: true });
    } else {
      await mkdir(join(root, 'blobs'), { recursive: true });
      blobsRelative = 'blobs';
    }
    let configRelative = null;
    if (configPath && await exists(configPath)) {
      configRelative = 'config/kafedra-planner.env';
      await mkdir(join(root, 'config'), { recursive: true });
      await copyFile(configPath, join(root, configRelative));
    }
    let applicationRelative = null;
    if (includeApplication && applicationDir && await exists(applicationDir)) {
      applicationRelative = 'application';
      const excludedRoots = [dataDir, backupDir, keyFile]
        .filter(Boolean)
        .map((path) => resolve(path));
      await cp(applicationDir, join(root, applicationRelative), {
        recursive: true,
        force: true,
        preserveTimestamps: true,
        filter: (source) => {
          const absolute = resolve(source);
          if (excludedRoots.some((excluded) =>
            absolute === excluded || absolute.startsWith(`${excluded}${sep}`)
          )) return false;
          const name = basename(source);
          return !['.git', 'release', 'test-results', 'playwright-report', 'node_modules'].includes(name);
        }
      });
    }
    const files = await fileRecords(root, { exclude: new Set(['manifest.json']) });
    const manifest = {
      format: 'kafedra-planner-backup',
      formatVersion: 1,
      createdAt: now.toISOString(),
      reason,
      appVersion,
      schemaVersion,
      encrypted: Boolean(keyFile),
      contents: {
        database: databaseRelative,
        blobs: blobsRelative,
        config: configRelative,
        application: applicationRelative
      },
      files
    };
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await run('tar', ['-C', workDir, '-czf', rawArchive, ARCHIVE_ROOT]);
    if (keyFile) await encryptArchive(rawArchive, finalArchive, keyFile);
    else {
      await copyFile(rawArchive, finalArchive);
      await chmod(finalArchive, 0o600);
    }
    const verification = await verifyBackup({ archivePath: finalArchive, keyFile });
    const archiveInfo = await stat(finalArchive);
    const record = {
      action: 'create',
      status: 'success',
      createdAt: now.toISOString(),
      verifiedAt: new Date().toISOString(),
      archivePath: finalArchive,
      archiveName: basename(finalArchive),
      archiveSize: archiveInfo.size,
      appVersion,
      schemaVersion,
      encrypted: Boolean(keyFile),
      reason,
      fileCount: verification.fileCount
    };
    await appendJournal(backupDir, record);
    const removed = await rotateBackups(backupDir, keep);
    return { ...record, removed };
  } catch (error) {
    await appendJournal(backupDir, {
      action: 'create',
      status: 'failure',
      createdAt: now.toISOString(),
      reason,
      error: String(error?.message || error)
    }).catch(() => {});
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function copyRestoredTree(sourceRoot, manifest, dataStaging) {
  await mkdir(dataStaging, { recursive: true, mode: 0o700 });
  const databaseSource = join(sourceRoot, ...manifest.contents.database.split('/'));
  await copyFile(databaseSource, join(dataStaging, 'kafedra-planner.sqlite3'));
  const blobsSource = manifest.contents.blobs
    ? join(sourceRoot, ...manifest.contents.blobs.split('/'))
    : null;
  if (blobsSource && await exists(blobsSource)) {
    await cp(blobsSource, join(dataStaging, 'blobs'), { recursive: true, force: true, preserveTimestamps: true });
  } else {
    await mkdir(join(dataStaging, 'blobs'), { recursive: true });
  }
  await mkdir(join(dataStaging, 'tmp'), { recursive: true });
}

async function atomicReplaceDirectory(staging, target, force, suffix) {
  const targetExists = await exists(target);
  if (targetExists && !force) throw new Error(`Target already exists: ${target}. Use --force with --apply.`);
  const rollback = targetExists ? `${target}.before-restore-${suffix}` : null;
  if (rollback) {
    await rm(rollback, { recursive: true, force: true });
    await rename(target, rollback);
  }
  try {
    await rename(staging, target);
  } catch (error) {
    if (rollback && await exists(rollback) && !(await exists(target))) await rename(rollback, target);
    throw error;
  }
  return rollback;
}

async function atomicReplaceFile(source, target, force, suffix) {
  if (!target) return null;
  await mkdir(dirname(target), { recursive: true });
  const targetExists = await exists(target);
  if (targetExists && !force) throw new Error(`Target already exists: ${target}. Use --force with --apply.`);
  const temporary = `${target}.restore-${suffix}`;
  const rollback = targetExists ? `${target}.before-restore-${suffix}` : null;
  await copyFile(source, temporary);
  if (rollback) {
    await rm(rollback, { force: true });
    await rename(target, rollback);
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    if (rollback && await exists(rollback) && !(await exists(target))) await rename(rollback, target);
    throw error;
  }
  return rollback;
}

export async function restoreDatabaseFile({
  archivePath,
  keyFile = null,
  targetDatabasePath,
  apply = false,
  force = false,
  now = new Date()
} = {}) {
  if (!archivePath || !(await exists(archivePath))) throw new Error('Backup archive does not exist.');
  if (!targetDatabasePath) throw new Error('Target database path is required.');
  const materialized = await materializeArchive(resolve(archivePath), { keyFile });
  const target = resolve(targetDatabasePath);
  const suffix = safeStamp(now);
  try {
    const verified = await verifyMaterialized(materialized.root, materialized.manifest);
    if (!apply) {
      return {
        status: 'dry-run-ok',
        archivePath: resolve(archivePath),
        targetDatabasePath: target,
        manifest: materialized.manifest,
        ...verified
      };
    }
    await mkdir(dirname(target), { recursive: true });
    const targetExists = await exists(target);
    if (targetExists && !force) {
      throw new Error(`Target already exists: ${target}. Use --force with --apply.`);
    }
    const source = join(
      materialized.root,
      ...materialized.manifest.contents.database.split('/')
    );
    const temporary = `${target}.restore-${suffix}`;
    const rollback = targetExists ? `${target}.before-restore-${suffix}` : null;
    await copyFile(source, temporary);
    const copied = openReadonlyDatabase(temporary);
    try {
      const quickCheck = copied.prepare('PRAGMA quick_check').get()?.quick_check;
      if (quickCheck !== 'ok') throw new Error(`Restored database quick_check failed: ${quickCheck}`);
    } finally {
      copied.close();
    }
    await rm(`${target}-wal`, { force: true });
    await rm(`${target}-shm`, { force: true });
    if (rollback) {
      await rm(rollback, { force: true });
      await rename(target, rollback);
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      if (rollback && await exists(rollback) && !(await exists(target))) {
        await rename(rollback, target);
      }
      throw error;
    }
    return {
      status: 'restored',
      archivePath: resolve(archivePath),
      targetDatabasePath: target,
      rollback,
      manifest: materialized.manifest,
      ...verified
    };
  } finally {
    await rm(materialized.workDir, { recursive: true, force: true });
  }
}

async function undoDirectoryReplacement(target, rollback) {
  if (!rollback || !(await exists(rollback))) return;
  await rm(target, { recursive: true, force: true });
  await rename(rollback, target);
}

async function undoFileReplacement(target, rollback) {
  if (!target || !rollback || !(await exists(rollback))) return;
  await rm(target, { force: true });
  await rename(rollback, target);
}

export async function restoreBackup({
  archivePath,
  keyFile = null,
  targetDataDir,
  targetConfigPath = null,
  targetApplicationDir = null,
  apply = false,
  force = false,
  now = new Date()
} = {}) {
  if (!archivePath || !(await exists(archivePath))) throw new Error('Backup archive does not exist.');
  if (!targetDataDir) throw new Error('Target data directory is required.');
  const materialized = await materializeArchive(resolve(archivePath), { keyFile });
  const suffix = safeStamp(now);
  try {
    const verified = await verifyMaterialized(materialized.root, materialized.manifest);
    if (!apply) {
      return {
        status: 'dry-run-ok',
        archivePath: resolve(archivePath),
        targetDataDir: resolve(targetDataDir),
        manifest: materialized.manifest,
        ...verified
      };
    }
    const targetData = resolve(targetDataDir);
    const dataStaging = join(dirname(targetData), `.${basename(targetData)}.restore-${suffix}`);
    await rm(dataStaging, { recursive: true, force: true });
    await copyRestoredTree(materialized.root, materialized.manifest, dataStaging);
    const rollbacks = { data: null, config: null, application: null };
    try {
      rollbacks.data = await atomicReplaceDirectory(dataStaging, targetData, force, suffix);
      if (targetConfigPath && materialized.manifest.contents.config) {
        rollbacks.config = await atomicReplaceFile(
          join(materialized.root, ...materialized.manifest.contents.config.split('/')),
          resolve(targetConfigPath),
          force,
          suffix
        );
      }
      if (targetApplicationDir && materialized.manifest.contents.application) {
        const targetApplication = resolve(targetApplicationDir);
        const applicationStaging = join(dirname(targetApplication), `.${basename(targetApplication)}.restore-${suffix}`);
        await rm(applicationStaging, { recursive: true, force: true });
        await cp(
          join(materialized.root, ...materialized.manifest.contents.application.split('/')),
          applicationStaging,
          { recursive: true, force: true, preserveTimestamps: true }
        );
        rollbacks.application = await atomicReplaceDirectory(applicationStaging, targetApplication, force, suffix);
      }
    } catch (error) {
      await undoDirectoryReplacement(
        targetApplicationDir ? resolve(targetApplicationDir) : null,
        rollbacks.application
      ).catch(() => {});
      await undoFileReplacement(
        targetConfigPath ? resolve(targetConfigPath) : null,
        rollbacks.config
      ).catch(() => {});
      await undoDirectoryReplacement(targetData, rollbacks.data).catch(() => {});
      throw Object.assign(error, { rollbacks, rollbackAttempted: true });
    }
    return {
      status: 'restored',
      archivePath: resolve(archivePath),
      targetDataDir: targetData,
      manifest: materialized.manifest,
      rollbacks,
      ...verified
    };
  } finally {
    await rm(materialized.workDir, { recursive: true, force: true });
  }
}
