import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  createBackup,
  hasPendingMigrations,
  restoreBackup
} from '../packages/backup/src/service.mjs';

const config = loadConfig();
const skipAutomaticBackup = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.KAFEDRA_SKIP_AUTO_BACKUP || '').toLowerCase()
);
let backup = null;
if (
  config.autoBackupBeforeMigration
  && !skipAutomaticBackup
  && await hasPendingMigrations(config.databasePath, config.migrationsDir)
) {
  backup = await createBackup({
    databasePath: config.databasePath,
    dataDir: config.dataDir,
    blobDir: config.blobDir,
    configPath: config.backupConfigPath || null,
    applicationDir: config.applicationDir,
    versionPath: `${config.applicationDir}/VERSION`,
    backupDir: config.backupDir,
    keyFile: config.backupEncryptionKeyFile || null,
    includeApplication: config.backupIncludeApplication,
    keep: config.backupKeep,
    reason: 'pre-migration'
  });
}

let database;
try {
  database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  console.log(JSON.stringify({
    status: 'ok',
    databasePath: config.databasePath,
    workspaceId: workspace.id,
    backup: backup?.archivePath || null
  }));
} catch (error) {
  if (database) {
    database.close();
    database = null;
  }
  if (backup?.archivePath) {
    await restoreBackup({
      archivePath: backup.archivePath,
      keyFile: config.backupEncryptionKeyFile || null,
      targetDataDir: config.dataDir,
      targetConfigPath: config.backupConfigPath || null,
      apply: true,
      force: true
    });
  }
  throw error;
} finally {
  database?.close();
}
