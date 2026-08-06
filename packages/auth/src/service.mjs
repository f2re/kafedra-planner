import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import {
  hashPassword,
  hashSessionToken,
  opaqueNetworkHash,
  randomSessionToken,
  validatePassword,
  verifyPassword
} from './passwords.mjs';

const ROLES = new Set(['staff', 'manager', 'admin']);
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function normalizeUsername(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .trim();
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try { result[name] = decodeURIComponent(value); }
    catch { result[name] = value; }
  }
  return result;
}

function isoAfterHours(now, hours) {
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

function isoAfterMinutes(now, minutes) {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function requestIp(request, config) {
  if (config.authTrustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',', 1)[0].trim();
  }
  return request.socket?.remoteAddress || null;
}

function serializeAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    personId: row.person_id,
    username: row.username,
    role: row.role,
    active: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.person_id ? {
      id: row.person_id,
      displayName: row.display_name,
      email: row.email,
      position: row.position,
      managerId: row.manager_id,
      managerName: row.manager_name
    } : null
  };
}

function accountQuery() {
  return `
    SELECT a.*, p.display_name, p.email, p.position, p.manager_id,
      manager.display_name AS manager_name
    FROM auth_accounts a
    JOIN people p ON p.id = a.person_id
    LEFT JOIN people manager ON manager.id = p.manager_id
  `;
}

export function auditAction(database, {
  workspaceId,
  accountId = null,
  personId = null,
  action,
  targetKind = null,
  targetId = null,
  details = {},
  now = new Date().toISOString()
}) {
  if (!workspaceId || !action) return null;
  const id = newId('authaudit');
  database.run(`
    INSERT INTO auth_audit_events(
      id, workspace_id, account_id, person_id, action,
      target_kind, target_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, workspaceId, accountId, personId, action,
  targetKind, targetId, JSON.stringify(details || {}), now);
  return id;
}

export function createAuthAccount(database, workspaceId, input, now = new Date().toISOString()) {
  const personId = String(input.personId || '').trim();
  const person = database.get(
    'SELECT id FROM people WHERE workspace_id = ? AND id = ? AND status = \'active\'',
    workspaceId,
    personId
  );
  if (!person) throw new AppError('person_not_found', 'Сотрудник для аккаунта не найден.', 404);
  const username = String(input.username || '').normalize('NFKC').trim();
  const normalized = normalizeUsername(username);
  if (normalized.length < 3 || normalized.length > 80) {
    throw new AppError('username_invalid', 'Имя пользователя должно содержать от 3 до 80 символов.', 400);
  }
  const role = String(input.role || 'staff');
  if (!ROLES.has(role)) throw new AppError('role_invalid', 'Неизвестная роль аккаунта.', 400);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AppError('password_invalid', passwordError, 400);
  const id = newId('account');
  try {
    database.run(`
      INSERT INTO auth_accounts(
        id, workspace_id, person_id, username, normalized_username, role,
        password_hash, password_changed_at, must_change_password,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, id, workspaceId, personId, username, normalized, role,
    hashPassword(input.password), now, input.mustChangePassword ? 1 : 0, now, now);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || error))) {
      throw new AppError('account_conflict', 'Для этого сотрудника или имени пользователя аккаунт уже существует.', 409);
    }
    throw error;
  }
  return serializeAccount(database.get(`${accountQuery()} WHERE a.id = ?`, id));
}

export function listAuthAccounts(database, workspaceId) {
  return database.all(`${accountQuery()}
    WHERE a.workspace_id = ?
    ORDER BY a.is_active DESC, CASE a.role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, p.display_name
  `, workspaceId).map(serializeAccount);
}

export function updateAuthAccount(database, workspaceId, accountId, input, now = new Date().toISOString()) {
  const current = database.get('SELECT * FROM auth_accounts WHERE workspace_id = ? AND id = ?', workspaceId, accountId);
  if (!current) throw new AppError('account_not_found', 'Аккаунт не найден.', 404);
  const role = input.role === undefined ? current.role : String(input.role);
  if (!ROLES.has(role)) throw new AppError('role_invalid', 'Неизвестная роль аккаунта.', 400);
  const username = input.username === undefined
    ? current.username
    : String(input.username || '').normalize('NFKC').trim();
  const normalized = normalizeUsername(username);
  if (normalized.length < 3 || normalized.length > 80) {
    throw new AppError('username_invalid', 'Имя пользователя должно содержать от 3 до 80 символов.', 400);
  }
  const active = input.active === undefined ? current.is_active : input.active ? 1 : 0;
  const mustChange = input.mustChangePassword === undefined
    ? current.must_change_password
    : input.mustChangePassword ? 1 : 0;
  try {
    database.run(`
      UPDATE auth_accounts
      SET username = ?, normalized_username = ?, role = ?, is_active = ?,
        must_change_password = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, username, normalized, role, active, mustChange, now, workspaceId, accountId);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || error))) {
      throw new AppError('account_conflict', 'Это имя пользователя уже занято.', 409);
    }
    throw error;
  }
  if (!active) database.run('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ?', now, accountId);
  return serializeAccount(database.get(`${accountQuery()} WHERE a.id = ?`, accountId));
}

export function resetAuthPassword(database, workspaceId, accountId, password, {
  mustChangePassword = true,
  now = new Date().toISOString()
} = {}) {
  const account = database.get('SELECT id FROM auth_accounts WHERE workspace_id = ? AND id = ?', workspaceId, accountId);
  if (!account) throw new AppError('account_not_found', 'Аккаунт не найден.', 404);
  const passwordError = validatePassword(password);
  if (passwordError) throw new AppError('password_invalid', passwordError, 400);
  database.transaction(() => {
    database.run(`
      UPDATE auth_accounts
      SET password_hash = ?, password_changed_at = ?, must_change_password = ?,
        failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?
    `, hashPassword(password), now, mustChangePassword ? 1 : 0, now, accountId);
    database.run('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ?', now, accountId);
  });
  return true;
}

export function createSession(database, accountId, request, config, now = new Date()) {
  const token = randomSessionToken();
  const csrfToken = randomSessionToken();
  const id = newId('session');
  const expiresAt = isoAfterHours(now, config.authSessionHours || 12);
  database.run(`
    INSERT INTO auth_sessions(
      id, account_id, token_hash, csrf_token, created_at, expires_at, last_seen_at,
      user_agent, ip_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, accountId, hashSessionToken(token), csrfToken, now.toISOString(), expiresAt,
  now.toISOString(), String(request.headers['user-agent'] || '').slice(0, 500) || null,
  opaqueNetworkHash(requestIp(request, config)));
  return { id, token, csrfToken, expiresAt };
}

export function sessionCookie(config, token, expiresAt) {
  const parts = [
    `${config.authCookieName || 'kafedra_session'}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (config.authSecureCookies) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(config) {
  const parts = [
    `${config.authCookieName || 'kafedra_session'}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (config.authSecureCookies) parts.push('Secure');
  return parts.join('; ');
}

export function authenticateAccount(database, workspaceId, username, password, request, config, now = new Date()) {
  const normalized = normalizeUsername(username);
  const row = database.get(`${accountQuery()}
    WHERE a.workspace_id = ? AND a.normalized_username = ?
  `, workspaceId, normalized);
  const locked = row?.locked_until && new Date(row.locked_until).getTime() > now.getTime();
  const validPassword = verifyPassword(password, row?.password_hash);
  if (!row || !row.is_active || locked || !validPassword) {
    if (row?.is_active && !locked) {
      const attempts = Number(row.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? isoAfterMinutes(now, LOCK_MINUTES) : null;
      database.run(`
        UPDATE auth_accounts SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?
      `, attempts, lockedUntil, now.toISOString(), row.id);
    }
    auditAction(database, {
      workspaceId,
      accountId: row?.id || null,
      personId: row?.person_id || null,
      action: 'auth.login_failed',
      details: { username: normalized, locked: Boolean(locked) },
      now: now.toISOString()
    });
    if (locked) throw new AppError('account_locked', 'Вход временно заблокирован после нескольких неудачных попыток.', 429);
    throw new AppError('invalid_credentials', 'Неверное имя пользователя или пароль.', 401);
  }

  const session = database.transaction(() => {
    database.run(`
      UPDATE auth_accounts
      SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
      WHERE id = ?
    `, now.toISOString(), now.toISOString(), row.id);
    database.run('DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL', now.toISOString());
    return createSession(database, row.id, request, config, now);
  });
  auditAction(database, {
    workspaceId,
    accountId: row.id,
    personId: row.person_id,
    action: 'auth.login',
    details: { sessionId: session.id },
    now: now.toISOString()
  });
  return { account: serializeAccount({ ...row, last_login_at: now.toISOString() }), session };
}

export function resolveAuthContext(database, request, config, now = new Date()) {
  if (!config.authEnabled) {
    return {
      enabled: false,
      authenticated: true,
      accountId: null,
      workspaceId: null,
      personId: null,
      role: 'admin',
      mustChangePassword: false,
      sessionId: null,
      user: null
    };
  }
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[config.authCookieName || 'kafedra_session'];
  if (!token) return { enabled: true, authenticated: false, user: null };
  const row = database.get(`
    SELECT s.id AS session_id, s.expires_at, s.last_seen_at, s.csrf_token,
      a.*, p.display_name, p.email, p.position, p.manager_id,
      manager.display_name AS manager_name
    FROM auth_sessions s
    JOIN auth_accounts a ON a.id = s.account_id
    JOIN people p ON p.id = a.person_id
    LEFT JOIN people manager ON manager.id = p.manager_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
      AND s.expires_at > ? AND a.is_active = 1
  `, hashSessionToken(token), now.toISOString());
  if (!row) return { enabled: true, authenticated: false, user: null };
  if (!row.csrf_token) {
    row.csrf_token = randomSessionToken();
    database.run('UPDATE auth_sessions SET csrf_token = ? WHERE id = ?', row.csrf_token, row.session_id);
  }
  if (now.getTime() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    database.run('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?', now.toISOString(), row.session_id);
  }
  const account = serializeAccount(row);
  return {
    enabled: true,
    authenticated: true,
    accountId: row.id,
    workspaceId: row.workspace_id,
    personId: row.person_id,
    role: row.role,
    csrfToken: row.csrf_token,
    mustChangePassword: Boolean(row.must_change_password),
    sessionId: row.session_id,
    user: account
  };
}

export function revokeSession(database, context, now = new Date().toISOString()) {
  if (!context?.sessionId) return false;
  database.run(
    'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?',
    now,
    context.sessionId
  );
  auditAction(database, {
    workspaceId: context.workspaceId,
    accountId: context.accountId,
    personId: context.personId,
    action: 'auth.logout',
    details: { sessionId: context.sessionId },
    now
  });
  return true;
}

export function changeOwnPassword(database, context, currentPassword, newPassword, now = new Date().toISOString()) {
  if (!context?.authenticated || !context.accountId) throw new AppError('authentication_required', 'Требуется вход в систему.', 401);
  const account = database.get('SELECT * FROM auth_accounts WHERE id = ?', context.accountId);
  if (!account || !verifyPassword(currentPassword, account.password_hash)) {
    throw new AppError('current_password_invalid', 'Текущий пароль указан неверно.', 400);
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) throw new AppError('password_invalid', passwordError, 400);
  database.transaction(() => {
    database.run(`
      UPDATE auth_accounts
      SET password_hash = ?, password_changed_at = ?, must_change_password = 0,
        failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?
    `, hashPassword(newPassword), now, now, context.accountId);
    database.run(`
      UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
      WHERE account_id = ? AND id <> ?
    `, now, context.accountId, context.sessionId);
  });
  auditAction(database, {
    workspaceId: context.workspaceId,
    accountId: context.accountId,
    personId: context.personId,
    action: 'auth.password_changed',
    now
  });
  return true;
}
