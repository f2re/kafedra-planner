import { AppError } from '../../../packages/core/src/errors.mjs';
import { listUiPreferences, recordUiPreferences, supportedUiPreferenceKeys } from '../../../packages/preferences/src/service.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (workspace) return workspace;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

function keysFrom(url) {
  const requested = url.searchParams.getAll('key')
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return requested.length ? requested : supportedUiPreferenceKeys();
}

export function createUiPreferencesRouter({ database }) {
  return async function routeUiPreferences(request, response, url) {
    if (url.pathname !== '/api/ui-preferences') return false;
    const method = request.method || 'GET';
    const workspace = workspaceOf(database, request);
    const accountId = request.auth?.accountId || null;
    if (method === 'GET') {
      return sendJson(response, 200, {
        preferences: listUiPreferences(database, workspace.id, accountId, keysFrom(url))
      });
    }
    if (method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 200, recordUiPreferences(database, workspace.id, accountId, body));
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается.', 405);
  };
}
