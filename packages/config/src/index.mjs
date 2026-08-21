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
  const applicationDir = resolve(env.KAFEDRA_APPLICATION_DIR || cwd);
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
    llmManaged: boolean(env.KAFEDRA_LLM_MANAGED, false),
    llmHost: String(env.KAFEDRA_LLM_HOST || '127.0.0.1').trim() || '127.0.0.1',
    llmPort: integer(env.KAFEDRA_LLM_PORT, 8081, { min: 1, max: 65535 }),
    llmModelPath: String(env.KAFEDRA_LLM_MODEL_PATH || '').trim(),
    llmContextSize: integer(env.KAFEDRA_LLM_CONTEXT_SIZE, 8192, { min: 512, max: 131072 }),
    llmThreads: integer(env.KAFEDRA_LLM_THREADS, 0, { min: 0, max: 1024 }),
    llmParallel: integer(env.KAFEDRA_LLM_PARALLEL, 1, { min: 1, max: 32 }),
    llmStartTimeoutSeconds: integer(env.KAFEDRA_LLM_START_TIMEOUT_SECONDS, 180, { min: 10, max: 900 }),
    authEnabled: boolean(env.KAFEDRA_AUTH_ENABLED, true),
    authCookieName: String(env.KAFEDRA_AUTH_COOKIE_NAME || 'kafedra_session').trim() || 'kafedra_session',
    authSessionHours: integer(env.KAFEDRA_AUTH_SESSION_HOURS, 12, { min: 1, max: 720 }),
    authSecureCookies: boolean(env.KAFEDRA_AUTH_SECURE_COOKIES, false),
    authTrustProxy: boolean(env.KAFEDRA_AUTH_TRUST_PROXY, false),
    authCsrfEnabled: boolean(env.KAFEDRA_AUTH_CSRF_ENABLED, true),
    authHierarchyMaxDepth: integer(env.KAFEDRA_AUTH_HIERARCHY_MAX_DEPTH, 32, { min: 1, max: 128 }),
    applicationDir,
    backupDir: resolve(env.KAFEDRA_BACKUP_DIR || resolve(dataDir, 'backups')),
    backupConfigPath: String(env.KAFEDRA_CONFIG_PATH || '').trim(),
    backupKeep: integer(env.KAFEDRA_BACKUP_KEEP, 14, { min: 1, max: 3650 }),
    backupMaxAgeHours: integer(env.KAFEDRA_BACKUP_MAX_AGE_HOURS, 36, { min: 1, max: 8760 }),
    backupEncryptionKeyFile: String(env.KAFEDRA_BACKUP_KEY_FILE || '').trim(),
    backupIncludeApplication: boolean(env.KAFEDRA_BACKUP_INCLUDE_APPLICATION, true),
    backupRequired: boolean(env.KAFEDRA_BACKUP_REQUIRED, true),
    autoBackupBeforeMigration: boolean(env.KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION, true),
    notificationDeliveryEnabled: boolean(env.KAFEDRA_NOTIFICATION_DELIVERY_ENABLED, false),
    notificationSweepMs: integer(env.KAFEDRA_NOTIFICATION_SWEEP_MS, 60_000, { min: 5_000, max: 3_600_000 }),
    notificationDefaultTimezone: String(env.KAFEDRA_NOTIFICATION_DEFAULT_TIMEZONE || 'Europe/Moscow').trim() || 'Europe/Moscow',
    smtpHost: String(env.KAFEDRA_SMTP_HOST || '').trim(),
    smtpPort: integer(env.KAFEDRA_SMTP_PORT, 25, { min: 1, max: 65535 }),
    smtpSecure: boolean(env.KAFEDRA_SMTP_SECURE, false),
    smtpStartTls: boolean(env.KAFEDRA_SMTP_STARTTLS, true),
    smtpRequireTls: boolean(env.KAFEDRA_SMTP_REQUIRE_TLS, false),
    smtpRejectUnauthorized: boolean(env.KAFEDRA_SMTP_REJECT_UNAUTHORIZED, true),
    smtpUsername: String(env.KAFEDRA_SMTP_USERNAME || '').trim(),
    smtpPassword: String(env.KAFEDRA_SMTP_PASSWORD || ''),
    smtpFrom: String(env.KAFEDRA_SMTP_FROM || '').trim(),
    smtpTimeoutMs: integer(env.KAFEDRA_SMTP_TIMEOUT_MS, 15_000, { min: 1_000, max: 120_000 }),
    telegramBotToken: String(env.KAFEDRA_TELEGRAM_BOT_TOKEN || '').trim(),
    telegramApiBase: String(env.KAFEDRA_TELEGRAM_API_BASE || 'https://api.telegram.org').trim() || 'https://api.telegram.org',
    telegramTimeoutMs: integer(env.KAFEDRA_TELEGRAM_TIMEOUT_MS, 15_000, { min: 1_000, max: 120_000 }),
    publicDir: resolve(applicationDir, 'public'),
    migrationsDir: resolve(applicationDir, 'migrations'),
    logLevel: env.KAFEDRA_LOG_LEVEL || 'info'
  });
}
