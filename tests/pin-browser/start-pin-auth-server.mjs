import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../../packages/work-management/src/service.mjs';
import { createAuthAccount } from '../../packages/auth/src/service.mjs';

const port = String(process.env.KAFEDRA_BROWSER_PORT || '4181');
const dataDir = mkdtempSync(join(tmpdir(), `kafedra-pin-browser-${port}-`));
const databasePath = join(dataDir, 'browser.sqlite3');
const env = {
  ...process.env,
  KAFEDRA_DATA_DIR: dataDir,
  KAFEDRA_DATABASE_PATH: databasePath,
  KAFEDRA_HOST: '127.0.0.1',
  KAFEDRA_PORT: port,
  KAFEDRA_AUTH_ENABLED: 'true',
  KAFEDRA_AUTH_MODE: 'pin',
  KAFEDRA_AUTH_CSRF_ENABLED: 'true',
  KAFEDRA_AUTH_SECURE_COOKIES: 'false',
  KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION: 'false',
  KAFEDRA_OCR_ENABLED: 'false',
  KAFEDRA_PREVIEW_ENABLED: 'false',
  KAFEDRA_LOG_LEVEL: 'error'
};

const database = new Database(databasePath, { migrationsDir: resolve('migrations') });
const workspace = ensureDefaultWorkspace(database);
const admin = createPerson(database, workspace.id, {
  displayName: 'Администратор системы',
  position: 'Администратор системы'
});
createAuthAccount(database, workspace.id, {
  personId: admin.id,
  username: 'admin',
  password: 'TemporaryAdmin2026',
  role: 'admin'
});
database.close();

const api = spawn(process.execPath, ['apps/api/src/main.mjs'], {
  cwd: resolve('.'),
  env,
  stdio: 'inherit'
});
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  api.kill('SIGTERM');
  setTimeout(() => {
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(code);
  }, 250).unref();
}
process.on('SIGINT', () => close(0));
process.on('SIGTERM', () => close(0));
api.on('exit', (code) => { if (!closing && code) close(code); });
setInterval(() => {}, 60_000);
