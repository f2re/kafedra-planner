import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertPlanAccess } from '../../../packages/plans/src/access.mjs';
import { listPlanSourceRows, materializePlanSourceRow } from '../../../packages/plans/src/service.mjs';
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
    plan_source_plan_not_found: ['План не найден.', 404],
    plan_source_row_not_found: ['Исходная строка плана не найдена.', 404],
    plan_source_tasks_required: ['Добавьте хотя бы одну задачу из выбранной строки.', 400],
    plan_source_tasks_too_many: ['Одну строку можно разделить не более чем на 20 задач за один раз.', 400],
    plan_source_task_title_required: ['У каждой задачи должно быть название.', 400],
    plan_source_execution_mode_invalid: ['Выберите допустимый режим исполнения.', 400],
    plan_source_assignment_preserved: ['У пункта уже есть поручение. Оно сохранено; сначала измените режим исполнения без удаления существующей работы.', 409],
    plan_item_date_invalid: ['Проверьте дату мероприятия или контрольного срока.', 400],
    plan_item_date_range_invalid: ['Дата окончания не может быть раньше даты начала.', 400],
    plan_item_direction_invalid: ['Выберите допустимое направление работы.', 400],
    manual_plan_person_not_found: ['Выбранный сотрудник не найден в справочнике.', 400],
    manual_plan_executor_required: ['Для поручения выберите хотя бы одного исполнителя.', 400],
    manual_plan_execution_mode_invalid: ['Выберите допустимый режим исполнения.', 400],
    manual_plan_execution_already_linked: ['У пункта уже есть поручение. Система не удаляет его автоматически.', 409]
  };
  const [message, status] = messages[code] || ['Не удалось разобрать выбранную строку плана.', 500];
  return new AppError(code, message, status, cause?.details);
}

export function createPlanSourceRowsRouter({ database }) {
  return async function routePlanSourceRows(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const collection = path.match(/^\/api\/plans\/([^/]+)\/source-rows$/);
    const materialize = path.match(/^\/api\/plans\/([^/]+)\/source-rows\/([^/]+)\/materialize$/);
    if (!(method === 'GET' && collection) && !(method === 'POST' && materialize)) return false;

    const workspace = workspaceOf(database, request);
    const context = request.auth;
    try {
      if (method === 'GET' && collection) {
        const planId = decodeURIComponent(collection[1]);
        assertPlanAccess(database, workspace.id, context, planId, 'read');
        return sendJson(response, 200, listPlanSourceRows(database, workspace.id, planId));
      }
      const planId = decodeURIComponent(materialize[1]);
      const sourceRowId = decodeURIComponent(materialize[2]);
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      const body = await readJson(request);
      return sendJson(response, 200, materializePlanSourceRow(
        database,
        workspace.id,
        planId,
        sourceRowId,
        body,
        context?.personId || null
      ));
    } catch (cause) {
      throw mappedError(cause);
    }
  };
}
