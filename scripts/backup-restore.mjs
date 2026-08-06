import { resolve } from 'node:path';
import { loadConfig } from '../packages/config/src/index.mjs';
import { restoreBackup } from '../packages/backup/src/service.mjs';
import { booleanOption, parseArguments, printResult } from '../packages/backup/src/cli.mjs';

const args = parseArguments(process.argv.slice(2));
const archive = args._[0] || args.archive;
if (!archive) {
  throw new Error('Использование: npm run backup:restore -- <архив> --target-data-dir каталог [--apply --force]');
}
const config = loadConfig();
const apply = booleanOption(args.apply, false);
const targetDataDir = args.targetDataDir || (apply ? null : resolve(config.dataDir, 'restore-dry-run'));
if (!targetDataDir) throw new Error('Для фактического восстановления требуется --target-data-dir.');
printResult(await restoreBackup({
  archivePath: resolve(archive),
  keyFile: args.keyFile || config.backupEncryptionKeyFile || null,
  targetDataDir: resolve(targetDataDir),
  targetConfigPath: args.targetConfig ? resolve(args.targetConfig) : null,
  targetApplicationDir: args.targetApplicationDir ? resolve(args.targetApplicationDir) : null,
  apply,
  force: booleanOption(args.force, false)
}));
