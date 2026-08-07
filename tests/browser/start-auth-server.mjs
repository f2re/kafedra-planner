import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../../packages/storage/src/bootstrap.mjs';
import { createAuthAccount } from '../../packages/auth/src/service.mjs';

const port = String(process.env.KAFEDRA_BROWSER_PORT || '4177');
const dataDir = mkdtempSync(join(tmpdir(), `kafedra-auth-browser-${port}-`));
const databasePath = join(dataDir, 'browser.sqlite3');
const env = {
  ...process.env,
  KAFEDRA_DATA_DIR: dataDir,
  KAFEDRA_DATABASE_PATH: databasePath,
  KAFEDRA_HOST: '127.0.0.1',
  KAFEDRA_PORT: port,
  KAFEDRA_AUTH_ENABLED: 'true',
  KAFEDRA_AUTH_SECURE_COOKIES: 'false',
  KAFEDRA_OCR_ENABLED: 'false',
  KAFEDRA_PREVIEW_ENABLED: 'false',
  KAFEDRA_NOTIFICATION_DELIVERY_ENABLED: 'true',
  KAFEDRA_SMTP_HOST: '127.0.0.1',
  KAFEDRA_SMTP_FROM: 'kafedra@test.local',
  KAFEDRA_LOG_LEVEL: 'error'
};

const database = new Database(databasePath, { migrationsDir: resolve('migrations') });
const workspace = ensureDefaultWorkspace(database);
const now = '2026-08-06T08:00:00.000Z';
for (const person of [
  ['person-manager', 'Петров Пётр Петрович', 'петров петр петрович', 'заведующий', null],
  ['person-staff', 'Сидоров Сергей Сергеевич', 'сидоров сергей сергеевич', 'доцент', 'person-manager'],
  ['person-outsider', 'Иванов Иван Иванович', 'иванов иван иванович', 'доцент', null],
  ['person-admin', 'Администратор Системы', 'администратор системы', 'администратор', null]
]) {
  database.run(`
    INSERT INTO people(id, workspace_id, display_name, normalized_name, position, manager_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `, person[0], workspace.id, person[1], person[2], person[3], person[4], now, now);
}
createAuthAccount(database, workspace.id, {
  personId: 'person-staff', username: 'staff', password: 'StaffPassword2026', role: 'staff'
}, now);
createAuthAccount(database, workspace.id, {
  personId: 'person-manager', username: 'manager', password: 'ManagerPass2026', role: 'manager'
}, now);
createAuthAccount(database, workspace.id, {
  personId: 'person-admin', username: 'admin', password: 'AdminPassword2026', role: 'admin'
}, now);
for (const suffix of ['desktop', 'mobile']) {
  database.run(`
    INSERT INTO notification_deliveries(
      id, workspace_id, person_id, notification_key, channel, delivery_kind,
      destination, title, body, status, retry_sequence, attempt_count, available_at,
      last_error, created_at, updated_at
    ) VALUES (?, ?, 'person-staff', ?, 'smtp', 'immediate', 'staff@department.test',
      'Тестовая ошибка доставки', 'Сообщение для проверки ручного повтора.', 'error', 0, 2, ?,
      'smtp_connection_refused', ?, ?)
  `, `browser-delivery-${suffix}`, workspace.id, `browser-error:${suffix}`, now, now, now);
}
database.close();

const api = spawn(process.execPath, ['apps/api/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'inherit' });
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