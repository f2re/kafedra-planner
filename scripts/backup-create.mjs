import { resolve } from 'node:path';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createBackup } from '../packages/backup/src/service.mjs';
import { booleanOption, parseArguments, printResult } from '../packages/backup/src/cli.mjs';

const args = parseArguments(process.argv.slice(2));
const config = loadConfig();
const result = await createBackup({
  databasePath: resolve(args.database || config.databasePath),
  dataDir: resolve(args.dataDir || config.dataDir),
  blobDir: resolve(args.blobDir || config.blobDir),
  configPath: args.config === false ? null : (args.config || config.backupConfigPath || null),
  applicationDir: args.applicationDir || config.applicationDir,
  versionPath: args.version || resolve(args.applicationDir || config.applicationDir, 'VERSION'),
  backupDir: resolve(args.outputDir || config.backupDir),
  keyFile: args.keyFile || config.backupEncryptionKeyFile || null,
  includeApplication: !booleanOption(args.noApplication, false) && config.backupIncludeApplication,
  keep: Number.parseInt(args.keep || config.backupKeep, 10),
  reason: String(args.reason || 'manual')
});
printResult(result);
