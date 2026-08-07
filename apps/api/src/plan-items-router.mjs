import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { planDocumentId } from '../../../packages/plans/src/service.mjs';
import { updatePlanItem, undoPlanItemCorrection } from '../../../packages/plans/src/corrections.mjs';
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

function mappedError(cause) {
  if (cause instanceof AppError) return cause;
  const code = String(cause?.code || cause?.message || cause);
  const messages = {
    plan_item_not_found: ['Пункт плана не найден.', 404],
    plan_item_title_required: ['Укажите наименование пункта.', 400],
    plan_item_date_invalid: ['Укажите корректную дату.', 400],
    plan_item_date_range_invalid: ['Дата окончания не может быть раньше даты начала.', 400],
    plan_item_direction_invalid: ['Выберите допустимое направление работы.', 400],
    plan_item_undo_unavailable: ['Для этого пункта нет изменения, которое можно отменить.', 409],
    plan_item_undo_invalid: ['История изменения повреждена. Автоматическая отмена невозможна.', 409]
  };
  const [message, status] = messages[code] || ['Не удалось сохранить исправление пункта плана.', 500];
  return new AppError(code, message, status);
}

export function createPlanItemsRouter({ database }) {
  return async function routePlanItems(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const undoMatch = path.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)\/undo$/);
    const itemMatch = path.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)$/);
    if (!undoMatch && !itemMatch) return false;

    const workspace = workspaceOf(database, request);
    const context = request.auth;
    const match = undoMatch || itemMatch;
    const planId = decodeURIComponent(match[1]);
    const itemId = decodeURIComponent(match[2]);
    const documentId = planDocumentId(database, workspace.id, planId);
    if (!documentId) throw new AppError('plan_not_found', 'План не найден.', 404);
    assertObjectAccess(database, workspace.id, context, 'document', documentId, 'edit');

    try {
      if (method === 'PATCH' && itemMatch) {
        const body = await readJson(request);
        return sendJson(response, 200, updatePlanItem(
          database, workspace.id, planId, itemId, body, context?.personId || null
        ));
      }
      if (method === 'POST' && undoMatch) {
        return sendJson(response, 200, undoPlanItemCorrection(
          database, workspace.id, planId, itemId, context?.personId || null
        ));
      }
    } catch (cause) {
      throw mappedError(cause);
    }
    return false;
  };
}
