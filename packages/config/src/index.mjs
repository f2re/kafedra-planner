import { resolve } from 'node:path';

function integer(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const dataDir = resolve(env.KAFEDRA_DATA_DIR || resolve(cwd, 'data'));
  return Object.freeze({
    host: env.KAFEDRA_HOST || '127.0.0.1',
    port: integer(env.KAFEDRA_PORT, 8080, { min: 1, max: 65535 }),
    dataDir,
    databasePath: resolve(env.KAFEDRA_DATABASE_PATH || resolve(dataDir, 'kafedra-planner.sqlite3')),
    blobDir: resolve(dataDir, 'blobs'),
    tempDir: resolve(dataDir, 'tmp'),
    maxUploadBytes: integer(env.KAFEDRA_MAX_UPLOAD_BYTES, 200 * 1024 * 1024, { min: 1024 }),
    workerPollMs: integer(env.KAFEDRA_WORKER_POLL_MS, 1500, { min: 250 }),
    workerLeaseSeconds: integer(env.KAFEDRA_WORKER_LEASE_SECONDS, 120, { min: 10 }),
    publicDir: resolve(cwd, 'public'),
    migrationsDir: resolve(cwd, 'migrations'),
    logLevel: env.KAFEDRA_LOG_LEVEL || 'info'
  });
}
