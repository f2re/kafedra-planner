import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  getAssignmentPlanFact,
  listPlanFact,
  rebuildPlanFact
} from '../../../packages/plan-fact/src/service.mjs';
import {
  listPersonalNotifications,
  setPersonalNotificationState
} from '../../../packages/plan-fact/src/notifications.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
    throw new AppError('workspace_not_found', 'Рабочее пространство не найдено.', 404);
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

function integerParam(value, fallback, max = 2000) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function filters(url) {
  return {
    from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '',
    direction: url.searchParams.get('direction') || '',
    status: url.searchParams.get('status') || '',
    ownerPersonId: url.searchParams.get('ownerPersonId') || '',
    managerPersonId: url.searchParams.get('managerPersonId') || '',
    periodKind: url.searchParams.get('periodKind') || '',
    periodKey: url.searchParams.get('periodKey') || '',
    limit: integerParam(url.searchParams.get('limit'), 500)
  };
}

export function createPlanFactRouter({ database }) {
  return async function routePlanFact(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const recognized = path === '/api/plan-fact'
      || path === '/api/plan-fact/rebuild'
      || path === '/api/personal-notifications'
      || path === '/api/personal-notifications/state'
      || /^\/api\/assignments\/[^/]+\/plan-fact$/.test(path);
    if (!recognized) return false;

    const workspace = workspaceOf(database, request);
    if (method === 'GET' && path === '/api/plan-fact') {
      sendJson(response, 200, listPlanFact(database, workspace.id, filters(url)));
      return true;
    }
    if (method === 'POST' && path === '/api/plan-fact/rebuild') {
      sendJson(response, 200, rebuildPlanFact(database, workspace.id));
      return true;
    }
    const assignmentMatch = path.match(/^\/api\/assignments\/([^/]+)\/plan-fact$/);
    if (method === 'GET' && assignmentMatch) {
      const item = getAssignmentPlanFact(database, workspace.id, decodeURIComponent(assignmentMatch[1]));
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      sendJson(response, 200, item);
      return true;
    }
    if (method === 'GET' && path === '/api/personal-notifications') {
      const personId = url.searchParams.get('personId');
      if (!personId) throw new AppError('person_id_required', 'Выберите сотрудника.', 400);
      const result = listPersonalNotifications(database, workspace.id, {
        personId,
        limit: integerParam(url.searchParams.get('limit'), 100, 500)
      });
      if (!result) throw new AppError('person_not_found', 'Сотрудник не найден.', 404);
      sendJson(response, 200, result);
      return true;
    }
    if (method === 'POST' && path === '/api/personal-notifications/state') {
      const body = await readJson(request);
      if (!body.personId || !body.key || !['read', 'dismiss'].includes(body.action)) {
        throw new AppError('personal_notification_state_invalid', 'Укажите сотрудника, уведомление и действие.', 400);
      }
      if (!setPersonalNotificationState(database, workspace.id, body.personId, body.key, body.action)) {
        throw new AppError('person_or_notification_not_found', 'Сотрудник или уведомление не найдены.', 404);
      }
      sendJson(response, 200, { status: body.action === 'dismiss' ? 'dismissed' : 'read' });
      return true;
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается для этого маршрута.', 405);
  };
}
