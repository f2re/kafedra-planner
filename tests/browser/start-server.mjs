import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port = String(process.env.KAFEDRA_BROWSER_PORT || '4173');
const dataDir = mkdtempSync(join(tmpdir(), `kafedra-browser-${port}-`));
const env = {
  ...process.env,
  KAFEDRA_DATA_DIR: dataDir,
  KAFEDRA_DATABASE_PATH: join(dataDir, 'browser.sqlite3'),
  KAFEDRA_HOST: '127.0.0.1',
  KAFEDRA_PORT: port,
  KAFEDRA_WORKER_POLL_MS: '60',
  KAFEDRA_OCR_ENABLED: 'false',
  KAFEDRA_PREVIEW_ENABLED: 'true',
  KAFEDRA_AUTH_ENABLED: 'false',
  KAFEDRA_LOG_LEVEL: process.env.KAFEDRA_BROWSER_LOG_LEVEL || 'info'
};
const api = spawn(process.execPath, ['apps/api/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'inherit' });
const worker = spawn(process.execPath, ['apps/worker/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'inherit' });

let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  api.kill('SIGTERM');
  worker.kill('SIGTERM');
  setTimeout(() => {
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(code);
  }, 250).unref();
}
process.on('SIGINT', () => close(0));
process.on('SIGTERM', () => close(0));
api.on('exit', (code) => { if (!closing && code) close(code); });
worker.on('exit', (code) => { if (!closing && code) close(code); });
setInterval(() => {}, 60_000);
