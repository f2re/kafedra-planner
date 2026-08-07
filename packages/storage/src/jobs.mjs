import { newId } from '../../core/src/ids.mjs';

export function enqueueJob(database, {
  kind,
  payload,
  priority = 0,
  maxAttempts = 5,
  idempotencyKey = null,
  availableAt = new Date().toISOString()
}) {
  const existing = idempotencyKey
    ? database.get('SELECT * FROM jobs WHERE idempotency_key = ?', idempotencyKey)
    : null;
  if (existing) return existing;
  const now = new Date().toISOString();
  const job = {
    id: newId('job'),
    kind,
    payload_json: JSON.stringify(payload),
    status: 'queued',
    priority,
    attempts: 0,
    max_attempts: maxAttempts,
    available_at: availableAt,
    locked_by: null,
    lease_until: null,
    last_error: null,
    idempotency_key: idempotencyKey,
    created_at: now,
    updated_at: now
  };
  database.run(`
    INSERT INTO jobs(
      id, kind, payload_json, status, priority, attempts, max_attempts,
      available_at, locked_by, lease_until, last_error, idempotency_key,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ...Object.values(job));
  return job;
}

export function acquireJob(database, workerId, leaseSeconds, now = new Date(), { excludeKinds = [] } = {}) {
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const excluded = [...new Set((Array.isArray(excludeKinds) ? excludeKinds : []).map(String).filter(Boolean))];
  const exclusion = excluded.length ? `AND kind NOT IN (${excluded.map(() => '?').join(', ')})` : '';
  return database.transaction(() => {
    const candidate = database.get(`
      SELECT id FROM jobs
      WHERE
        status IN ('queued', 'retry')
        AND available_at <= ?
        AND (lease_until IS NULL OR lease_until < ?)
        ${exclusion}
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `, nowIso, nowIso, ...excluded);
    if (!candidate) return null;
    database.run(`
      UPDATE jobs
      SET status = 'running', locked_by = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ?
    `, workerId, leaseUntil, nowIso, candidate.id);
    return database.get('SELECT * FROM jobs WHERE id = ?', candidate.id);
  });
}

export function completeJob(database, jobId, now = new Date().toISOString()) {
  database.run(`
    UPDATE jobs SET status = 'completed', locked_by = NULL, lease_until = NULL,
      last_error = NULL, updated_at = ? WHERE id = ?
  `, now, jobId);
}

export function failJob(database, job, error, now = new Date()) {
  const exhausted = job.attempts >= job.max_attempts;
  const delaySeconds = Math.min(3600, 15 * (2 ** Math.max(0, job.attempts - 1)));
  const availableAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  database.run(`
    UPDATE jobs
    SET status = ?, available_at = ?, locked_by = NULL, lease_until = NULL,
      last_error = ?, updated_at = ?
    WHERE id = ?
  `, exhausted ? 'failed' : 'retry', availableAt, String(error?.stack || error), now.toISOString(), job.id);
}