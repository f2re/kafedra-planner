import { resolve } from 'node:path';

function integer(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off', 'нет'].includes(String(value).trim().toLocaleLowerCase('ru-RU'));
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
    ocrEnabled: boolean(env.KAFEDRA_OCR_ENABLED, true),
    ocrLanguages: String(env.KAFEDRA_OCR_LANGUAGES || 'rus+eng').trim() || 'rus+eng',
    ocrDpi: integer(env.KAFEDRA_OCR_DPI, 250, { min: 100, max: 600 }),
    ocrMaxPages: integer(env.KAFEDRA_OCR_MAX_PAGES, 50, { min: 1, max: 500 }),
    ocrMinCharacters: integer(env.KAFEDRA_OCR_MIN_CHARACTERS, 40, { min: 0, max: 5000 }),
    previewEnabled: boolean(env.KAFEDRA_PREVIEW_ENABLED, true),
    llmEnabled: boolean(env.KAFEDRA_LLM_ENABLED, false),
    llmEndpoint: String(env.KAFEDRA_LLM_ENDPOINT || '').trim(),
    llmModel: String(env.KAFEDRA_LLM_MODEL || 'local-model').trim() || 'local-model',
    llmTimeoutMs: integer(env.KAFEDRA_LLM_TIMEOUT_MS, 45_000, { min: 1_000, max: 300_000 }),
    llmMaxTokens: integer(env.KAFEDRA_LLM_MAX_TOKENS, 4096, { min: 256, max: 32768 }),
    authEnabled: boolean(env.KAFEDRA_AUTH_ENABLED, true),
    authCookieName: String(env.KAFEDRA_AUTH_COOKIE_NAME || 'kafedra_session').trim() || 'kafedra_session',
    authSessionHours: integer(env.KAFEDRA_AUTH_SESSION_HOURS, 12, { min: 1, max: 720 }),
    authSecureCookies: boolean(env.KAFEDRA_AUTH_SECURE_COOKIES, false),
    authTrustProxy: boolean(env.KAFEDRA_AUTH_TRUST_PROXY, false),
    publicDir: resolve(cwd, 'public'),
    migrationsDir: resolve(cwd, 'migrations'),
    logLevel: env.KAFEDRA_LOG_LEVEL || 'info'
  });
}
