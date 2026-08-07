import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup, restoreBackup, verifyBackup } from '../packages/backup/src/service.mjs';

const root = await mkdtemp(join(tmpdir(), 'kafedra-backup-selftest-'));
try {
  const sourceData = join(root, 'source-data');
  const sourceApp = join(root, 'source-app');
  const backups = join(root, 'backups');
  const databasePath = join(sourceData, 'kafedra-planner.sqlite3');
  const configPath = join(root, 'kafedra-planner.env');
  const keyPath = join(root, 'backup.key');
  await mkdir(join(sourceData, 'blobs'), { recursive: true });
  await mkdir(sourceApp, { recursive: true });
  await writeFile(join(sourceData, 'blobs', 'sample.bin'), Buffer.from('backup-selftest-blob'));
  await writeFile(join(sourceApp, 'VERSION'), '0.1.0-rc.3\n');
  await writeFile(join(sourceApp, 'application.txt'), 'self-contained application snapshot\n');
  await writeFile(configPath, 'KAFEDRA_TEST_BACKUP=true\n');
  await writeFile(keyPath, 'local-backup-key-material-2026');

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
    INSERT INTO schema_migrations VALUES (15, '015_notification_delivery.sql', '2026-08-07T00:00:00.000Z');
    CREATE TABLE sample(id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO sample VALUES ('one', 'restorable');
  `);
  database.close();

  const created = await createBackup({
    databasePath,
    dataDir: sourceData,
    blobDir: join(sourceData, 'blobs'),
    configPath,
    applicationDir: sourceApp,
    versionPath: join(sourceApp, 'VERSION'),
    backupDir: backups,
    keyFile: keyPath,
    includeApplication: true,
    keep: 3,
    reason: 'ci-selftest'
  });
  const verified = await verifyBackup({ archivePath: created.archivePath, keyFile: keyPath });
  if (verified.status !== 'ok' || verified.manifest.schemaVersion !== 15) {
    throw new Error('Backup verification did not return expected schema.');
  }

  const dryRun = await restoreBackup({
    archivePath: created.archivePath,
    keyFile: keyPath,
    targetDataDir: join(root, 'dry-run-target')
  });
  if (dryRun.status !== 'dry-run-ok') throw new Error('Restore dry-run failed.');

  const restoredData = join(root, 'restored-data');
  const restoredConfig = join(root, 'restored-config.env');
  const restoredApp = join(root, 'restored-application');
  const restored = await restoreBackup({
    archivePath: created.archivePath,
    keyFile: keyPath,
    targetDataDir: restoredData,
    targetConfigPath: restoredConfig,
    targetApplicationDir: restoredApp,
    apply: true,
    force: true
  });
  if (restored.status !== 'restored') throw new Error('Restore apply failed.');

  const restoredDatabase = new DatabaseSync(join(restoredData, 'kafedra-planner.sqlite3'), { readOnly: true });
  const value = restoredDatabase.prepare('SELECT value FROM sample WHERE id = ?').get('one')?.value;
  const quickCheck = restoredDatabase.prepare('PRAGMA quick_check').get()?.quick_check;
  restoredDatabase.close();
  if (value !== 'restorable' || quickCheck !== 'ok') throw new Error('Restored SQLite database is invalid.');
  if ((await readFile(join(restoredData, 'blobs', 'sample.bin'), 'utf8')) !== 'backup-selftest-blob') {
    throw new Error('Restored blob differs from source.');
  }
  if (!(await readFile(restoredConfig, 'utf8')).includes('KAFEDRA_TEST_BACKUP=true')) {
    throw new Error('Restored configuration differs from source.');
  }
  if ((await readFile(join(restoredApp, 'VERSION'), 'utf8')).trim() !== '0.1.0-rc.3') {
    throw new Error('Restored application version differs from source.');
  }
  process.stdout.write(`${JSON.stringify({ status: 'ok', archive: created.archiveName, encrypted: created.encrypted })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}