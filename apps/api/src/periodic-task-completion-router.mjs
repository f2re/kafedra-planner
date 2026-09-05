import { AppError } from '../../../packages/core/src/errors.mjs';
import { managesPerson } from '../../../packages/auth/src/policy.mjs';
import { getPeriodicTaskV2 } from '../../../packages/work-management/src/periodic-tasks.mjs';
import { transitionPeriodicTaskV2 } from '../../../packages/work-management/src/periodic-task-completion.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

export function canTransitionPeriodicTask(database, workspaceIdValue, context, task) {
  if (!context?.enabled || context.role === 'admin') return true;
  if (task.owner_person_id === context.personId || task.manager_person_id === context.personId) return true;
  return context.role === 'manager' && task.owner_person_id
    && managesPerson(database, workspaceIdValue, context.personId, task.owner_person_id);
}

function transitionError(error) {
  const code = String(error?.message || error);
  if (code === 'periodic_task_transition_invalid') {
    return new AppError(code, 'Допустимы действия complete и reopen.', 400);
  }
  if (code === 'periodic_task_transition_cancelled') {
    return new AppError(code, 'Отменённую задачу нельзя завершить или вернуть в работу.', 409);
  }
  if (code === 'periodic_task_transition_invalid_state') {
    return new AppError(code, 'Вернуть в работу можно только выполненную задачу.', 409);
  }
  return error;
}

export function createPeriodicTaskCompletionRouter({ database }) {
  return async function routePeriodicTaskCompletion(request, response, url) {
    if ((request.method || 'GET') !== 'POST') return false;
    const match = url.pathname.match(/^\/api\/periodic-tasks\/([^/]+)\/transition$/u);
    if (!match) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const taskId = decodeURIComponent(match[1]);
    const task = getPeriodicTaskV2(database, workspace, taskId);
    if (!task) throw new AppError('periodic_task_not_found', 'Периодическая задача не найдена.', 404);
    const context = request.auth || { enabled: false };
    if (!canTransitionPeriodicTask(database, workspace, context, task)) {
      throw new AppError('periodic_task_transition_forbidden', 'Завершить эту задачу может исполнитель или его руководитель.', 403);
    }
    try {
      const body = await readJson(request);
      return sendJson(response, 200, transitionPeriodicTaskV2(database, workspace, taskId, body.action, {
        actorPersonId: context.personId || null
      }));
    } catch (error) {
      throw transitionError(error);
    }
  };
}
