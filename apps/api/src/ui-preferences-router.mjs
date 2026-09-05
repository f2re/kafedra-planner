import { AppError } from '../../../packages/core/src/errors.mjs';
import { listUiPreferences, recordUiPreferences, supportedUiPreferenceKeys } from '../../../packages/preferences/src/service.mjs';
import { readCalendarStartMode, writeCalendarStartMode } from '../../../packages/preferences/src/calendar-start.mjs';
import { readJson, sendJson } from './http-utils.mjs';

const NEVER_LEARN_KEYS = new Set(['work.periodic.edit.status']);

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

function allowedKeys(keys) {
  return keys.filter((key) => !NEVER_LEARN_KEYS.has(key));
}

function keysFrom(url) {
  const requested = url.searchParams.getAll('key')
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedKeys(requested.length ? requested : supportedUiPreferenceKeys());
}

function withoutNeverLearn(body) {
  const choices = Array.isArray(body?.choices)
    ? body.choices.filter((choice) => !NEVER_LEARN_KEYS.has(String(choice?.key || '')))
    : [];
  return { ...body, choices };
}

export function createUiPreferencesRouter({ database }) {
  return async function routeUiPreferences(request, response, url) {
    const preferencesPath = url.pathname === '/api/ui-preferences';
    const calendarStartPath = url.pathname === '/api/ui-settings/calendar-start';
    if (!preferencesPath && !calendarStartPath) return false;
    const method = request.method || 'GET';
    const workspace = workspaceOf(database, request);
    const accountId = request.auth?.accountId || null;

    if (calendarStartPath) {
      if (!accountId) {
        throw new AppError(
          'calendar_start_mode_account_required',
          'Персональная настройка доступна после входа в аккаунт.',
          409
        );
      }
      if (method === 'GET') {
        return sendJson(response, 200, {
          calendarStartMode: readCalendarStartMode(database, workspace.id, accountId)
        });
      }
      if (method === 'PUT') {
        const body = await readJson(request);
        return sendJson(response, 200, {
          calendarStartMode: writeCalendarStartMode(
            database,
            workspace.id,
            accountId,
            body.calendarStartMode
          )
        });
      }
      throw new AppError('method_not_allowed', 'Метод не поддерживается.', 405);
    }

    if (method === 'GET') {
      return sendJson(response, 200, {
        preferences: listUiPreferences(database, workspace.id, accountId, keysFrom(url))
      });
    }
    if (method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 200, recordUiPreferences(
        database,
        workspace.id,
        accountId,
        withoutNeverLearn(body)
      ));
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается.', 405);
  };
}
