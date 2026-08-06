import { resolve } from 'node:path';
import { loadConfig } from '../packages/config/src/index.mjs';
import { verifyBackup } from '../packages/backup/src/service.mjs';
import { parseArguments, printResult } from '../packages/backup/src/cli.mjs';

const args = parseArguments(process.argv.slice(2));
const archive = args._[0] || args.archive;
if (!archive) throw new Error('Использование: npm run backup:verify -- <архив> [--key-file путь]');
const config = loadConfig();
printResult(await verifyBackup({
  archivePath: resolve(archive),
  keyFile: args.keyFile || config.backupEncryptionKeyFile || null
}));
