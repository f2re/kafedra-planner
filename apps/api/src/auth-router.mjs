import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  auditAction,
  authenticateAccount,
  authenticatePin,
  changeOwnPassword,
  changeOwnPin,
  clearSessionCookie,
  configureLocalPin,
  createAuthAccount,
  isLocalPinConfigured,
  listAuthAccounts,
  resetAuthPassword,
  revokeSession,
  sessionCookie,
  updateAuthAccount
} from '../../../packages/auth/src/service.mjs';
import {
  listAuthSessions,
  revokeAccountSessions,
  revokeAuthSession,
  revokeWorkspaceSessions
} from '../../../packages/auth/src/sessions.mjs';
import { getReleaseReadiness } from '../../../packages/auth/src/readiness.mjs';
import {
  listManagedPeople,
  requireRole,
  requireSession
} from '../../../packages/auth/src/policy.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function authMode(config) {
  return config.authMode || 'accounts';
}

function defaultWorkspace(database, request) {
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get(
      'SELECT * FROM workspaces WHERE id = ? OR code = ?',
      requested,
      requested
    );
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) {
    throw new AppError(
      'workspace_not_initialized',
      'Рабочее пространство не создано.',
      500
    );
  }
  return workspace;
}

function workspaceFor(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get(
      'SELECT * FROM workspaces WHERE id = ?',
      request.auth.workspaceId
    );
    if (workspace) return workspace;
  }
  return defaultWorkspace(database, request);
}

function mePayload(database, request, config) {
  const context = request.auth;
  const mode = authMode(config);
  if (!config.authEnabled) {
    return {
      authEnabled: false,
      authMode: mode,
      authenticated: true,
      role: 'admin',
      csrfToken: null,
      permissions: ['development-bypass'],
      user: null,
      subordinates: []
    };
  }
  if (!context?.authenticated) {
    const workspace = defaultWorkspace(database, request);
    return {
      authEnabled: true,
      authMode: mode,
      authenticated: false,
      pinConfigured: mode === 'pin' ? isLocalPinConfigured(database, workspace.id) : null,
      csrfToken: null,
      user: null,
      subordinates: []
    };
  }
  const subordinates = context.role === 'manager'
    ? listManagedPeople(database, context.workspaceId, context.personId)
    : context.role === 'admin'
      ? database.all(`
          SELECT id, display_name, email, position, manager_id, 0 AS depth
          FROM people
          WHERE workspace_id = ? AND status = 'active'
          ORDER BY display_name
        `, context.workspaceId)
      : [];
  return {
    authEnabled: true,
    authMode: mode,
    authenticated: true,
    pinConfigured: mode === 'pin' ? true : null,
    role: context.role,
    csrfToken: context.csrfToken,
    mustChangePassword: mode === 'accounts' ? context.mustChangePassword : false,
    permissions: {
      manageAccounts: context.role === 'admin',
      manageSessions: context.role === 'admin',
      correctMetrics: ['manager', 'admin'].includes(context.role),
      createSharedViews: ['manager', 'admin'].includes(context.role),
      reviewReports: ['manager', 'admin'].includes(context.role)
    },
    user: context.user,
    subordinates
  };
}

function audit(database, request, workspaceId, action, targetKind, targetId, details = {}) {
  auditAction(database, {
    workspaceId,
    accountId: request.auth.accountId,
    personId: request.auth.personId,
    action,
    targetKind,
    targetId,
    details
  });
}

function setSessionResponse(response, config, result, status) {
  response.setHeader(
    'set-cookie',
    sessionCookie(config, result.session.token, result.session.expiresAt)
  );
  sendJson(response, 200, {
    status,
    user: result.account,
    csrfToken: result.session.csrfToken,
    mustChangePassword: Boolean(result.account.mustChangePassword)
  });
}

export function createAuthRouter({ database, config }) {
  return async function routeAuth(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const mode = authMode(config);
    const accountMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)$/);
    const resetMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/reset-password$/);
    const accountSessionsMatch = path.match(
      /^\/api\/admin\/accounts\/([^/]+)\/revoke-sessions$/
    );
    const sessionRevokeMatch = path.match(
      /^\/api\/admin\/sessions\/([^/]+)\/revoke$/
    );
    const recognized = path === '/api/auth/me'
      || path === '/api/auth/setup-pin'
      || path === '/api/auth/login'
      || path === '/api/auth/logout'
      || path === '/api/auth/change-pin'
      || path === '/api/auth/change-password'
      || path === '/api/admin/accounts'
      || path === '/api/admin/sessions'
      || path === '/api/admin/sessions/revoke-all'
      || path === '/api/admin/readiness'
      || Boolean(
        accountMatch
        || resetMatch
        || accountSessionsMatch
        || sessionRevokeMatch
      );
    if (!recognized) return false;

    if (method === 'GET' && path === '/api/auth/me') {
      sendJson(response, 200, mePayload(database, request, config));
      return true;
    }
    if (method === 'POST' && path === '/api/auth/setup-pin') {
      if (!config.authEnabled) {
        throw new AppError('auth_disabled', 'Авторизация отключена конфигурацией.', 409);
      }
      if (mode !== 'pin') {
        throw new AppError('pin_mode_disabled', 'В этом окружении используется вход по аккаунтам.', 409);
      }
      const workspace = defaultWorkspace(database, request);
      const body = await readJson(request);
      const result = configureLocalPin(database, workspace.id, body.pin, request, config);
      setSessionResponse(response, config, result, 'pin_configured');
      return true;
    }
    if (method === 'POST' && path === '/api/auth/login') {
      if (!config.authEnabled) {
        throw new AppError(
          'auth_disabled',
          'Авторизация отключена конфигурацией.',
          409
        );
      }
      const workspace = defaultWorkspace(database, request);
      const body = await readJson(request);
      const result = mode === 'pin'
        ? authenticatePin(database, workspace.id, body.pin, request, config)
        : authenticateAccount(
            database,
            workspace.id,
            body.username,
            body.password,
            request,
            config
          );
      setSessionResponse(response, config, result, 'authenticated');
      return true;
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      if (request.auth?.authenticated) revokeSession(database, request.auth);
      response.setHeader('set-cookie', clearSessionCookie(config));
      sendJson(response, 200, { status: 'signed_out' });
      return true;
    }
    if (method === 'POST' && path === '/api/auth/change-pin') {
      if (mode !== 'pin') {
        throw new AppError('pin_mode_disabled', 'В этом окружении используется вход по аккаунтам.', 409);
      }
      requireSession(request.auth);
      const body = await readJson(request);
      changeOwnPin(database, request.auth, body.currentPin, body.newPin);
      sendJson(response, 200, { status: 'pin_changed' });
      return true;
    }
    if (method === 'POST' && path === '/api/auth/change-password') {
      if (mode !== 'accounts') {
        throw new AppError('account_mode_disabled', 'Для локального доступа используется PIN-код.', 409);
      }
      requireSession(request.auth);
      const body = await readJson(request);
      changeOwnPassword(
        database,
        request.auth,
        body.currentPassword,
        body.newPassword
      );
      sendJson(response, 200, { status: 'password_changed' });
      return true;
    }

    requireRole(request.auth, 'admin');
    const workspace = workspaceFor(database, request);
    if (method === 'GET' && path === '/api/admin/readiness') {
      sendJson(response, 200, getReleaseReadiness(database, workspace.id, config));
      return true;
    }
    if (method === 'GET' && path === '/api/admin/accounts') {
      sendJson(response, 200, { items: listAuthAccounts(database, workspace.id) });
      return true;
    }
    if (method === 'POST' && path === '/api/admin/accounts') {
      const body = await readJson(request);
      const account = createAuthAccount(database, workspace.id, body);
      audit(
        database,
        request,
        workspace.id,
        'auth.account_created',
        'auth_account',
        account.id,
        { role: account.role, personId: account.personId }
      );
      sendJson(response, 201, account);
      return true;
    }
    if (method === 'PATCH' && accountMatch) {
      const accountId = decodeURIComponent(accountMatch[1]);
      const account = updateAuthAccount(
        database,
        workspace.id,
        accountId,
        await readJson(request)
      );
      audit(
        database,
        request,
        workspace.id,
        'auth.account_updated',
        'auth_account',
        accountId,
        { role: account.role, active: account.active }
      );
      sendJson(response, 200, account);
      return true;
    }
    if (method === 'POST' && resetMatch) {
      const accountId = decodeURIComponent(resetMatch[1]);
      const body = await readJson(request);
      resetAuthPassword(database, workspace.id, accountId, body.password, {
        mustChangePassword: body.mustChangePassword !== false
      });
      audit(
        database,
        request,
        workspace.id,
        'auth.password_reset',
        'auth_account',
        accountId
      );
      sendJson(response, 200, { status: 'password_reset' });
      return true;
    }
    if (method === 'GET' && path === '/api/admin/sessions') {
      const accountId = url.searchParams.get('accountId') || null;
      const items = listAuthSessions(database, workspace.id, { accountId })
        .map((item) => ({
          ...item,
          current: item.id === request.auth.sessionId
        }));
      sendJson(response, 200, { items });
      return true;
    }
    if (method === 'POST' && sessionRevokeMatch) {
      const sessionId = decodeURIComponent(sessionRevokeMatch[1]);
      if (sessionId === request.auth.sessionId) {
        throw new AppError(
          'current_session_revoke_forbidden',
          'Текущую сессию завершайте командой «Выйти».',
          409
        );
      }
      const count = revokeAuthSession(database, workspace.id, sessionId);
      audit(
        database,
        request,
        workspace.id,
        'auth.session_revoked',
        'auth_session',
        sessionId
      );
      sendJson(response, 200, { status: 'revoked', count });
      return true;
    }
    if (method === 'POST' && accountSessionsMatch) {
      const accountId = decodeURIComponent(accountSessionsMatch[1]);
      const count = revokeAccountSessions(database, workspace.id, accountId, {
        exceptSessionId:
          accountId === request.auth.accountId ? request.auth.sessionId : null
      });
      audit(
        database,
        request,
        workspace.id,
        'auth.account_sessions_revoked',
        'auth_account',
        accountId,
        { count }
      );
      sendJson(response, 200, { status: 'revoked', count });
      return true;
    }
    if (method === 'POST' && path === '/api/admin/sessions/revoke-all') {
      const body = await readJson(request);
      const keepCurrent = body.keepCurrent !== false;
      const count = revokeWorkspaceSessions(database, workspace.id, {
        exceptSessionId: keepCurrent ? request.auth.sessionId : null
      });
      audit(
        database,
        request,
        workspace.id,
        'auth.workspace_sessions_revoked',
        'workspace',
        workspace.id,
        { count, keepCurrent }
      );
      sendJson(response, 200, { status: 'revoked', count, keepCurrent });
      return true;
    }
    throw new AppError(
      'method_not_allowed',
      'Метод не поддерживается для этого маршрута.',
      405
    );
  };
}
