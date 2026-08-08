import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertAssignmentAccess } from '../../../packages/access-control/src/service.mjs';
import {
  getAssignmentResponsibility,
  updateAssignmentResponsibility
} from '../../../packages/work-management/src/responsibility.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function responsibilityError(error) {
  const code = String(error?.message || error);
  if (code === 'responsibility_reason_required') {
    return new AppError(code, 'Кратко укажите причину изменения ответственности.', 400);
  }
  if (code === 'responsibility_person_invalid') {
    return new AppError(code, 'Один из выбранных сотрудников не найден или недоступен.', 400);
  }
  return error;
}

export function createAssignmentResponsibilityRouter({ database }) {
  return async function routeAssignmentResponsibility(request, response, url) {
    const match = url.pathname.match(/^\/api\/assignments\/([^/]+)\/responsibility$/);
    if (!match || !['GET', 'PUT'].includes(request.method || 'GET')) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const assignmentId = decodeURIComponent(match[1]);

    if (request.auth?.enabled) {
      assertAssignmentAccess(
        database,
        workspace,
        request.auth,
        assignmentId,
        request.method === 'GET' ? 'read' : 'control'
      );
    }

    if (request.method === 'GET') {
      const item = getAssignmentResponsibility(database, workspace, assignmentId);
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      return sendJson(response, 200, item);
    }

    const body = await readJson(request);
    try {
      const item = updateAssignmentResponsibility(database, workspace, assignmentId, body, {
        actorPersonId: request.auth?.personId || null
      });
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      return sendJson(response, 200, item);
    } catch (error) {
      throw responsibilityError(error);
    }
  };
}
