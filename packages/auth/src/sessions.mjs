import { AppError } from '../../core/src/errors.mjs';

function serialize(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    username: row.username,
    role: row.role,
    personId: row.person_id,
    personName: row.display_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    userAgent: row.user_agent,
    active: !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()
  };
}

export function listAuthSessions(database, workspaceId, { accountId = null } = {}) {
  const params = [workspaceId];
  let clause = '';
  if (accountId) {
    clause = ' AND a.id = ?';
    params.push(accountId);
  }
  return database.all(`
    SELECT s.*, a.workspace_id, a.username, a.role, a.person_id, p.display_name
    FROM auth_sessions s
    JOIN auth_accounts a ON a.id = s.account_id
    JOIN people p ON p.id = a.person_id
    WHERE a.workspace_id = ?${clause}
    ORDER BY
      CASE WHEN s.revoked_at IS NULL AND s.expires_at > datetime('now') THEN 0 ELSE 1 END,
      s.last_seen_at DESC
  `, ...params).map(serialize);
}

export function revokeAuthSession(database, workspaceId, sessionId, now = new Date().toISOString()) {
  const row = database.get(`
    SELECT s.id FROM auth_sessions s
    JOIN auth_accounts a ON a.id = s.account_id
    WHERE a.workspace_id = ? AND s.id = ?
  `, workspaceId, sessionId);
  if (!row) throw new AppError('session_not_found', 'Сессия не найдена.', 404);
  const result = database.run(
    'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?',
    now,
    sessionId
  );
  return Number(result.changes || 0);
}

export function revokeAccountSessions(
  database,
  workspaceId,
  accountId,
  { exceptSessionId = null, now = new Date().toISOString() } = {}
) {
  const account = database.get(
    'SELECT id FROM auth_accounts WHERE workspace_id = ? AND id = ?',
    workspaceId,
    accountId
  );
  if (!account) throw new AppError('account_not_found', 'Аккаунт не найден.', 404);
  const result = exceptSessionId
    ? database.run(`
        UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE account_id = ? AND id <> ? AND revoked_at IS NULL
      `, now, accountId, exceptSessionId)
    : database.run(`
        UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE account_id = ? AND revoked_at IS NULL
      `, now, accountId);
  return Number(result.changes || 0);
}

export function revokeWorkspaceSessions(
  database,
  workspaceId,
  { exceptSessionId = null, now = new Date().toISOString() } = {}
) {
  const result = exceptSessionId
    ? database.run(`
        UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id IN (
          SELECT s.id FROM auth_sessions s
          JOIN auth_accounts a ON a.id = s.account_id
          WHERE a.workspace_id = ? AND s.id <> ? AND s.revoked_at IS NULL
        )
      `, now, workspaceId, exceptSessionId)
    : database.run(`
        UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id IN (
          SELECT s.id FROM auth_sessions s
          JOIN auth_accounts a ON a.id = s.account_id
          WHERE a.workspace_id = ? AND s.revoked_at IS NULL
        )
      `, now, workspaceId);
  return Number(result.changes || 0);
}
