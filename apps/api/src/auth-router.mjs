import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  auditAction,
  authenticateAccount,
  changeOwnPassword,
  clearSessionCookie,
  createAuthAccount,
  listAuthAccounts,
  resetAuthPassword,
  revokeSession,
  sessionCookie,
  updateAuthAccount
} from '../../../packages/auth/src/service.mjs';
import { requireRole, requireSession } from '../../../packages/auth/src/policy.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function defaultWorkspace(database, request) {
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

function workspaceFor(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (workspace) return workspace;
  }
  return defaultWorkspace(database, request);
}

function mePayload(database, request, config) {
  const context = request.auth;
  if (!config.authEnabled) {
    return {
      authEnabled: false,
      authenticated: true,
      role: 'admin',
      permissions: ['development-bypass'],
      user: null,
      subordinates: []
    };
  }
  if (!context?.authenticated) {
    return { authEnabled: true, authenticated: false, user: null, subordinates: [] };
  }
  const subordinates = ['manager', 'admin'].includes(context.role)
    ? database.all(`
        SELECT id, display_name, email, position, manager_id
        FROM people
        WHERE workspace_id = ? AND manager_id = ? AND status = 'active'
        ORDER BY display_name
      `, context.workspaceId, context.personId)
    : [];
  return {
    authEnabled: true,
    authenticated: true,
    role: context.role,
    mustChangePassword: context.mustChangePassword,
    permissions: {
      manageAccounts: context.role === 'admin',
      correctMetrics: ['manager', 'admin'].includes(context.role),
      createSharedViews: ['manager', 'admin'].includes(context.role),
      reviewReports: ['manager', 'admin'].includes(context.role)
    },
    user: context.user,
    subordinates
  };
}

export function createAuthRouter({ database, config }) {
  return async function routeAuth(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const accountMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)$/);
    const resetMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/reset-password$/);
    const recognized = path === '/api/auth/me'
      || path === '/api/auth/login'
      || path === '/api/auth/logout'
      || path === '/api/auth/change-password'
      || path === '/api/admin/accounts'
      || Boolean(accountMatch || resetMatch);
    if (!recognized) return false;

    if (method === 'GET' && path === '/api/auth/me') {
      sendJson(response, 200, mePayload(database, request, config));
      return true;
    }
    if (method === 'POST' && path === '/api/auth/login') {
      if (!config.authEnabled) throw new AppError('auth_disabled', 'Авторизация отключена конфигурацией.', 409);
      const workspace = defaultWorkspace(database, request);
      const body = await readJson(request);
      const result = authenticateAccount(
        database,
        workspace.id,
        body.username,
        body.password,
        request,
        config
      );
      response.setHeader('set-cookie', sessionCookie(config, result.session.token, result.session.expiresAt));
      sendJson(response, 200, {
        status: 'authenticated',
        user: result.account,
        mustChangePassword: result.account.mustChangePassword
      });
      return true;
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      if (request.auth?.authenticated) revokeSession(database, request.auth);
      response.setHeader('set-cookie', clearSessionCookie(config));
      sendJson(response, 200, { status: 'signed_out' });
      return true;
    }
    if (method === 'POST' && path === '/api/auth/change-password') {
      requireSession(request.auth);
      const body = await readJson(request);
      changeOwnPassword(database, request.auth, body.currentPassword, body.newPassword);
      sendJson(response, 200, { status: 'password_changed' });
      return true;
    }

    requireRole(request.auth, 'admin');
    const workspace = workspaceFor(database, request);
    if (method === 'GET' && path === '/api/admin/accounts') {
      sendJson(response, 200, { items: listAuthAccounts(database, workspace.id) });
      return true;
    }
    if (method === 'POST' && path === '/api/admin/accounts') {
      const body = await readJson(request);
      const account = createAuthAccount(database, workspace.id, body);
      auditAction(database, {
        workspaceId: workspace.id,
        accountId: request.auth.accountId,
        personId: request.auth.personId,
        action: 'auth.account_created',
        targetKind: 'auth_account',
        targetId: account.id,
        details: { role: account.role, personId: account.personId }
      });
      sendJson(response, 201, account);
      return true;
    }
    if (method === 'PATCH' && accountMatch) {
      const accountId = decodeURIComponent(accountMatch[1]);
      const account = updateAuthAccount(database, workspace.id, accountId, await readJson(request));
      auditAction(database, {
        workspaceId: workspace.id,
        accountId: request.auth.accountId,
        personId: request.auth.personId,
        action: 'auth.account_updated',
        targetKind: 'auth_account',
        targetId: accountId,
        details: { role: account.role, active: account.active }
      });
      sendJson(response, 200, account);
      return true;
    }
    if (method === 'POST' && resetMatch) {
      const accountId = decodeURIComponent(resetMatch[1]);
      const body = await readJson(request);
      resetAuthPassword(database, workspace.id, accountId, body.password, {
        mustChangePassword: body.mustChangePassword !== false
      });
      auditAction(database, {
        workspaceId: workspace.id,
        accountId: request.auth.accountId,
        personId: request.auth.personId,
        action: 'auth.password_reset',
        targetKind: 'auth_account',
        targetId: accountId
      });
      sendJson(response, 200, { status: 'password_reset' });
      return true;
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается для этого маршрута.', 405);
  };
}
