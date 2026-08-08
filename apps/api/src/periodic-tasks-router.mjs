import { AppError } from '../../../packages/core/src/errors.mjs';
import { managesPerson } from '../../../packages/auth/src/policy.mjs';
import {
  createPeriodicTaskV2,
  getPeriodicTaskV2,
  listPeriodicTasksV2,
  updatePeriodicTaskV2
} from '../../../packages/work-management/src/periodic-tasks.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function visible(database, workspaceId, context, task) {
  if (!context?.enabled || context.role === 'admin') return true;
  if ([task.owner_person_id, task.manager_person_id].includes(context.personId)) return true;
  return context.role === 'manager' && task.owner_person_id
    && managesPerson(database, workspaceId, context.personId, task.owner_person_id);
}

function manageable(database, workspaceId, context, task) {
  if (!context?.enabled || context.role === 'admin') return true;
  if (task.manager_person_id === context.personId) return true;
  if (!task.manager_person_id && task.owner_person_id === context.personId) return true;
  return context.role === 'manager' && task.owner_person_id
    && managesPerson(database, workspaceId, context.personId, task.owner_person_id);
}

function canCreate(database, workspaceId, context, body) {
  if (!context?.enabled || context.role === 'admin') return true;
  if (!body.ownerPersonId) return false;
  if (body.ownerPersonId === context.personId) {
    if (!body.managerPersonId) return true;
    const owner = database.get('SELECT manager_id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, context.personId);
    return body.managerPersonId === owner?.manager_id || body.managerPersonId === context.personId;
  }
  return context.role === 'manager'
    && managesPerson(database, workspaceId, context.personId, body.ownerPersonId);
}

function taskError(error) {
  const code = String(error?.message || error);
  if (code === 'periodic_task_fields_required') return new AppError(code, 'Укажите сотрудника, название и период задачи.', 400);
  if (code === 'periodic_task_due_required') return new AppError(code, 'Укажите контрольный срок задачи.', 400);
  if (code === 'periodic_task_planned_invalid') return new AppError(code, 'Плановый рубеж должен быть корректной датой.', 400);
  if (code === 'periodic_task_dates_invalid') return new AppError(code, 'Плановый рубеж не может быть позже контрольного срока.', 400);
  if (code === 'periodic_task_owner_invalid') return new AppError(code, 'Выбранный сотрудник не найден.', 400);
  if (code === 'periodic_task_manager_invalid') return new AppError(code, 'Выбранный руководитель не найден.', 400);
  if (code === 'periodic_task_reason_required') return new AppError(code, 'Кратко укажите причину переноса или изменения.', 400);
  return error;
}

function filters(url) {
  return {
    ownerPersonId: url.searchParams.get('ownerPersonId') || '',
    managerPersonId: url.searchParams.get('managerPersonId') || '',
    periodKind: url.searchParams.get('periodKind') || '',
    periodKey: url.searchParams.get('periodKey') || '',
    status: url.searchParams.get('status') || '',
    from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '',
    limit: Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 500)))
  };
}

export function createPeriodicTasksRouter({ database }) {
  return async function routePeriodicTasks(request, response, url) {
    const method = request.method || 'GET';
    if (!url.pathname.startsWith('/api/periodic-tasks')) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const context = request.auth || { enabled: false };

    if (url.pathname === '/api/periodic-tasks') {
      if (method === 'GET') {
        const items = listPeriodicTasksV2(database, workspace, filters(url))
          .filter((item) => visible(database, workspace, context, item));
        return sendJson(response, 200, { items });
      }
      if (method === 'POST') {
        const body = await readJson(request);
        if (!canCreate(database, workspace, context, body)) {
          throw new AppError('periodic_task_scope_forbidden', 'Нельзя создать задачу для этого сотрудника.', 403);
        }
        try {
          return sendJson(response, 201, createPeriodicTaskV2(database, workspace, body, {
            actorPersonId: context.personId || null
          }));
        } catch (error) {
          throw taskError(error);
        }
      }
      return false;
    }

    const match = url.pathname.match(/^\/api\/periodic-tasks\/([^/]+)$/);
    if (!match || !['GET', 'PATCH'].includes(method)) return false;
    const taskId = decodeURIComponent(match[1]);
    const current = getPeriodicTaskV2(database, workspace, taskId);
    if (!current) throw new AppError('periodic_task_not_found', 'Периодическая задача не найдена.', 404);
    if (!visible(database, workspace, context, current)) {
      throw new AppError('periodic_task_scope_forbidden', 'Нет доступа к этой задаче.', 403);
    }
    if (method === 'GET') return sendJson(response, 200, current);
    if (!manageable(database, workspace, context, current)) {
      throw new AppError('periodic_task_control_forbidden', 'Переносить и делегировать эту задачу может только руководитель.', 403);
    }
    try {
      return sendJson(response, 200, updatePeriodicTaskV2(database, workspace, taskId, await readJson(request), {
        actorPersonId: context.personId || null
      }));
    } catch (error) {
      throw taskError(error);
    }
  };
}
