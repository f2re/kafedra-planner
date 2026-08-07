import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  createBackup,
  readLatestBackupStatus,
  restoreBackup,
  restoreDatabaseFile,
  verifyBackup
} from '../packages/backup/src/service.mjs';

const run = promisify(execFile);

test('резервная копия проверяется и восстанавливает базу, файлы, конфигурацию и версию', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-backup-test-'));
  try {
    const dataDir = join(root, 'data');
    const blobDir = join(dataDir, 'blobs');
    const appDir = join(root, 'application');
    const backupDir = join(root, 'backups');
    const configPath = join(root, 'kafedra-planner.env');
    const databasePath = join(dataDir, 'kafedra-planner.sqlite3');
    await mkdir(blobDir, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await writeFile(join(blobDir, 'evidence.bin'), 'verified-evidence');
    await writeFile(join(appDir, 'VERSION'), '0.1.0-rc.3\n');
    await writeFile(join(appDir, 'application.txt'), 'application snapshot');
    await writeFile(configPath, 'KAFEDRA_HOST=127.0.0.1\n');

    const database = new Database(databasePath, { migrationsDir: resolve('migrations') });
    const workspace = ensureDefaultWorkspace(database);
    database.run(
      'INSERT INTO people(id, workspace_id, display_name, normalized_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'person-backup', workspace.id, 'Проверяемый Сотрудник', 'проверяемый сотрудник', 'active',
      '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'
    );
    database.close();

    const created = await createBackup({
      databasePath,
      dataDir,
      blobDir,
      configPath,
      applicationDir: appDir,
      versionPath: join(appDir, 'VERSION'),
      backupDir,
      includeApplication: true,
      keep: 2,
      reason: 'test'
    });
    const verified = await verifyBackup({ archivePath: created.archivePath });
    assert.equal(verified.status, 'ok');
    assert.equal((await stat(created.archivePath)).mode & 0o077, 0);
    assert.equal(verified.manifest.appVersion, '0.1.0-rc.3');
    assert.equal(verified.manifest.schemaVersion, 15);
    assert.ok(verified.fileCount >= 4);

    const latest = await readLatestBackupStatus(backupDir);
    assert.equal(latest.archiveName, created.archiveName);
    assert.equal(latest.status, 'success');

    const dryRun = await restoreBackup({
      archivePath: created.archivePath,
      targetDataDir: join(root, 'dry-run')
    });
    assert.equal(dryRun.status, 'dry-run-ok');

    const targetDataDir = join(root, 'restored-data');
    const targetConfigPath = join(root, 'restored.env');
    const targetApplicationDir = join(root, 'restored-application');
    const restored = await restoreBackup({
      archivePath: created.archivePath,
      targetDataDir,
      targetConfigPath,
      targetApplicationDir,
      apply: true,
      force: true
    });
    assert.equal(restored.status, 'restored');

    const restoredDatabase = new Database(join(targetDataDir, 'kafedra-planner.sqlite3'), { readonly: true });
    assert.equal(restoredDatabase.quickCheck(), true);
    assert.equal(
      restoredDatabase.get('SELECT display_name FROM people WHERE id = ?', 'person-backup').display_name,
      'Проверяемый Сотрудник'
    );
    restoredDatabase.close();
    assert.equal(await readFile(join(targetDataDir, 'blobs', 'evidence.bin'), 'utf8'), 'verified-evidence');
    assert.match(await readFile(targetConfigPath, 'utf8'), /KAFEDRA_HOST=127\.0\.0\.1/);
    assert.equal((await readFile(join(targetApplicationDir, 'VERSION'), 'utf8')).trim(), '0.1.0-rc.3');

    const changed = new Database(databasePath, { migrationsDir: resolve('migrations') });
    changed.run('DELETE FROM people WHERE id = ?', 'person-backup');
    changed.close();
    const databaseRollback = await restoreDatabaseFile({
      archivePath: created.archivePath,
      targetDatabasePath: databasePath,
      apply: true,
      force: true
    });
    assert.equal(databaseRollback.status, 'restored');
    const rolledBack = new Database(databasePath, { readonly: true });
    assert.equal(
      rolledBack.get('SELECT display_name FROM people WHERE id = ?', 'person-backup').display_name,
      'Проверяемый Сотрудник'
    );
    rolledBack.close();

    const unpacked = join(root, 'unpacked');
    await mkdir(unpacked, { recursive: true });
    await run('tar', ['-xzf', created.archivePath, '-C', unpacked]);
    await writeFile(join(unpacked, 'kafedra-backup', 'unmanifested.txt'), 'must be rejected');
    const unmanifested = join(root, 'unmanifested.tar.gz');
    await run('tar', ['-C', unpacked, '-czf', unmanifested, 'kafedra-backup']);
    await assert.rejects(() => verifyBackup({ archivePath: unmanifested }), /not listed in manifest/i);

    const files = await readdir(backupDir);
    assert.ok(files.some((name) => name.endsWith('.tar.gz')));
    const second = await createBackup({
      databasePath,
      dataDir,
      blobDir,
      configPath,
      applicationDir: appDir,
      versionPath: join(appDir, 'VERSION'),
      backupDir,
      includeApplication: true,
      keep: 1,
      reason: 'rotation'
    });
    assert.ok(second.archivePath);
    const rotatedFiles = await readdir(backupDir);
    assert.equal(rotatedFiles.filter((name) => name.endsWith('.tar.gz')).length, 1);

    const linked = join(root, 'linked-data');
    await symlink(dataDir, linked);
    const linkedBackup = await createBackup({
      databasePath,
      dataDir: linked,
      blobDir: join(linked, 'blobs'),
      configPath,
      applicationDir: appDir,
      versionPath: join(appDir, 'VERSION'),
      backupDir: join(root, 'linked-backups'),
      includeApplication: false,
      keep: 1,
      reason: 'symlink-path'
    });
    assert.ok(linkedBackup.archivePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});