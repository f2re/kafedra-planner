import { AppError } from '../../../packages/core/src/errors.mjs';
import { listUiPreferences, recordUiPreferences, supportedUiPreferenceKeys } from '../../../packages/preferences/src/service.mjs';
import {
  readPreferenceControls,
  resetLearnedPreferences,
  setPinnedPreference,
  setPreferenceLearning
} from '../../../packages/preferences/src/controls.mjs';
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

function emptyPreferences(keys) {
  return Object.fromEntries(keys.map((key) => [key, []]));
}

export function effectiveUiPreferences(database, workspaceId, accountId, keys, controls) {
  const preferences = controls.learningEnabled
    ? listUiPreferences(database, workspaceId, accountId, keys)
    : emptyPreferences(keys);
  for (const [key, value] of Object.entries(controls.pinned || {})) {
    if (!keys.includes(key)) continue;
    const rows = Array.isArray(preferences[key]) ? preferences[key] : [];
    preferences[key] = [
      { value, count: Number.MAX_SAFE_INTEGER, pinned: true },
      ...rows.filter((row) => String(row.value) !== String(value))
    ];
  }
  return preferences;
}

export function filterNeverLearnPreferenceBody(body) {
  const choices = Array.isArray(body?.choices)
    ? body.choices.filter((choice) => !NEVER_LEARN_KEYS.has(String(choice?.key || '')))
    : [];
  return { ...body, choices };
}

function controlsError(error) {
  const code = String(error?.message || error);
  if (code === 'preference_account_required') {
    return new AppError(code, 'Персональная настройка доступна после входа в аккаунт.', 409);
  }
  if (code === 'preference_pin_key_forbidden') {
    return new AppError(code, 'Это поле нельзя закреплять как личный default.', 400);
  }
  if (code === 'preference_pin_value_unknown') {
    return new AppError(code, 'Закрепить можно только ранее выбранное безопасное значение.', 400);
  }
  return error;
}

export function createUiPreferencesRouter({ database }) {
  return async function routeUiPreferences(request, response, url) {
    const preferencesPath = url.pathname === '/api/ui-preferences';
    const controlsPath = url.pathname === '/api/ui-preferences/controls';
    const resetPath = url.pathname === '/api/ui-preferences/reset';
    const calendarStartPath = url.pathname === '/api/ui-settings/calendar-start';
    if (!preferencesPath && !controlsPath && !resetPath && !calendarStartPath) return false;
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

    if (controlsPath) {
      if (method === 'GET') {
        return sendJson(response, 200, {
          controls: readPreferenceControls(database, workspace.id, accountId)
        });
      }
      if (method === 'PUT') {
        const body = await readJson(request);
        try {
          if (Object.prototype.hasOwnProperty.call(body, 'learningEnabled')) {
            setPreferenceLearning(database, workspace.id, accountId, body.learningEnabled !== false);
          }
          if (body.pin && typeof body.pin === 'object') {
            setPinnedPreference(
              database,
              workspace.id,
              accountId,
              body.pin.key,
              body.pin.value
            );
          }
          return sendJson(response, 200, {
            controls: readPreferenceControls(database, workspace.id, accountId)
          });
        } catch (error) {
          throw controlsError(error);
        }
      }
      throw new AppError('method_not_allowed', 'Метод не поддерживается.', 405);
    }

    if (resetPath) {
      if (method !== 'POST') throw new AppError('method_not_allowed', 'Метод не поддерживается.', 405);
      try {
        return sendJson(response, 200, resetLearnedPreferences(database, workspace.id, accountId));
      } catch (error) {
        throw controlsError(error);
      }
    }

    const requestedKeys = keysFrom(url);
    const controls = readPreferenceControls(database, workspace.id, accountId);
    if (method === 'GET') {
      return sendJson(response, 200, {
        controls,
        preferences: effectiveUiPreferences(database, workspace.id, accountId, requestedKeys, controls)
      });
    }
    if (method === 'POST') {
      const body = filterNeverLearnPreferenceBody(await readJson(request));
      if (controls.learningEnabled && body.choices.length) {
        recordUiPreferences(database, workspace.id, accountId, body);
      }
      const currentControls = readPreferenceControls(database, workspace.id, accountId);
      return sendJson(response, 200, {
        controls: currentControls,
        preferences: effectiveUiPreferences(database, workspace.id, accountId, requestedKeys, currentControls)
      });
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается.', 405);
  };
}
