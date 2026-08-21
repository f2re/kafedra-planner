#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../packages/config/src/index.mjs';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { resetLocalPin } from '../packages/auth/src/service.mjs';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const pinFile = argument('pin-file') || process.env.KAFEDRA_PIN_FILE || '';
if (!pinFile) {
  console.error('Не указан файл с PIN-кодом. Используйте --pin-file /root/kafedra-pin.');
  process.exit(2);
}

let pin;
try {
  pin = (await readFile(pinFile, 'utf8')).trim();
} catch (error) {
  console.error(`Не удалось прочитать файл PIN-кода: ${error.message}`);
  process.exit(2);
}

const config = loadConfig();
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
try {
  const workspace = ensureDefaultWorkspace(database);
  resetLocalPin(database, workspace.id, pin);
  console.log('PIN-код обновлён. Все прежние сессии завершены.');
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 2;
} finally {
  database.close();
}
