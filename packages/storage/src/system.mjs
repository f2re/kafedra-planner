export function systemHealth(database) {
  const migration = database.get('SELECT MAX(version) AS version FROM schema_migrations');
  const worker = database.get(`
    SELECT updated_at, status FROM jobs
    WHERE locked_by IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1
  `);
  return {
    status: database.quickCheck() ? 'ok' : 'degraded',
    database: database.quickCheck() ? 'ok' : 'error',
    schemaVersion: migration?.version ?? 0,
    activeWorkerJob: worker ?? null,
    time: new Date().toISOString()
  };
}
