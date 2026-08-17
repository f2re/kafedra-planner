import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { assertPlanItemAccess } from '../../../packages/plans/src/access.mjs';
import { getPlan } from '../../../packages/plans/src/service.mjs';
import { updateManualPlanItem } from '../../../packages/plans/src/manual.mjs';
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
    plan_item_undo_invalid: ['История изменения повреждена. Автоматическая отмена невозможна.', 409],
    manual_plan_item_title_required: ['Укажите наименование пункта.', 400],
    manual_plan_date_invalid: ['Укажите корректную дату.', 400],
    manual_plan_item_range_invalid: ['Дата окончания не может быть раньше даты начала.', 400],
    manual_plan_direction_invalid: ['Выберите допустимое направление работы.', 400],
    manual_plan_execution_already_linked: ['У пункта уже есть поручение. Его нельзя молча превратить в информационный пункт.', 409]
  };
  const [message, status] = messages[code] || ['Не удалось сохранить пункт плана.', 500];
  return new AppError(code, message, status, cause?.details);
}

function itemContext(database, workspaceId, itemId) {
  return database.get(`
    SELECT pi.*, p.id AS plan_id, p.origin_kind AS plan_origin_kind,
      p.source_document_version_id
    FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, itemId) || null;
}

function calendarItem(database, workspaceId, calendarId) {
  return database.get(
    'SELECT * FROM calendar_items WHERE workspace_id = ? AND id = ?', workspaceId, calendarId
  ) || null;
}

function calendarPatch(calendar, body) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    let title = String(body.title || '').trim();
    if (calendar.item_kind === 'task' && title.startsWith('Срок: ')) title = title.slice(6).trim();
    patch.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'category')) patch.direction = body.category;
  if (calendar.item_kind === 'task') {
    if (Object.prototype.hasOwnProperty.call(body, 'startsAt')) patch.dueDate = body.startsAt;
  } else {
    if (Object.prototype.hasOwnProperty.call(body, 'startsAt')) patch.startsAt = body.startsAt;
    if (Object.prototype.hasOwnProperty.call(body, 'endsAt')) patch.endsAt = body.endsAt;
  }
  return patch;
}

export function createPlanItemsRouter({ database }) {
  return async function routePlanItems(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const undoMatch = path.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)\/undo$/);
    const itemMatch = path.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)$/);
    const calendarMatch = path.match(/^\/api\/calendar\/([^/]+)$/);
    const documentStatusMatch = path.match(/^\/api\/plan-documents\/([^/]+)\/status$/);
    if (!undoMatch && !itemMatch && !(['GET', 'PATCH'].includes(method) && calendarMatch)
      && !(method === 'GET' && documentStatusMatch)) return false;

    const workspace = workspaceOf(database, request);
    const context = request.auth;

    if (method === 'GET' && documentStatusMatch) {
      const documentId = decodeURIComponent(documentStatusMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'document', documentId, 'read');
      const row = database.get(`
        SELECT d.id, d.document_type, d.status, d.updated_at,
          dv.id AS version_id, dv.processing_status, dv.extraction_error,
          dv.structure_status, dv.ocr_status, dv.preview_status
        FROM documents d
        JOIN document_versions dv ON dv.id = d.current_version_id
        WHERE d.workspace_id = ? AND d.id = ?
      `, workspace.id, documentId);
      if (!row) throw new AppError('document_not_found', 'Документ не найден.', 404);
      return sendJson(response, 200, row);
    }

    if (calendarMatch && ['GET', 'PATCH'].includes(method)) {
      const calendarId = decodeURIComponent(calendarMatch[1]);
      const projection = calendarItem(database, workspace.id, calendarId);
      if (!projection || projection.source_kind !== 'plan_item') return false;
      assertPlanItemAccess(
        database, workspace.id, context, projection.source_id, method === 'GET' ? 'read' : 'edit'
      );
      const item = itemContext(database, workspace.id, projection.source_id);
      if (!item) throw new AppError('plan_item_not_found', 'Пункт плана не найден.', 404);
      const plan = getPlan(database, workspace.id, item.plan_id);
      if (method === 'GET') {
        return sendJson(response, 200, {
          ...projection,
          plan_id: item.plan_id,
          plan_origin_kind: item.plan_origin_kind,
          source_document_id: plan?.source_document_id || null
        });
      }
      const body = await readJson(request);
      const patch = calendarPatch(projection, body);
      if (!Object.keys(patch).length) return sendJson(response, 200, projection);
      try {
        if (item.origin_kind === 'manual' && item.plan_origin_kind === 'manual') {
          database.transaction(() => updateManualPlanItem(
            database, workspace.id, item.id, patch, context?.personId || null
          ));
        } else {
          updatePlanItem(database, workspace.id, item.plan_id, item.id, patch, context?.personId || null);
        }
        const refreshed = calendarItem(database, workspace.id, calendarId);
        if (refreshed) return sendJson(response, 200, refreshed);
        const replacements = database.all(`
          SELECT * FROM calendar_items
          WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
          ORDER BY CASE item_kind WHEN ? THEN 0 ELSE 1 END, starts_at
        `, workspace.id, item.id, projection.item_kind);
        return sendJson(response, 200, replacements[0] || null);
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const match = undoMatch || itemMatch;
    const planId = decodeURIComponent(match[1]);
    const itemId = decodeURIComponent(match[2]);
    const item = itemContext(database, workspace.id, itemId);
    if (!item || item.plan_id !== planId) throw new AppError('plan_item_not_found', 'Пункт плана не найден.', 404);
    assertPlanItemAccess(database, workspace.id, context, itemId, 'edit');

    try {
      if (method === 'PATCH' && itemMatch) {
        const body = await readJson(request);
        if (item.origin_kind === 'manual' && item.plan_origin_kind === 'manual') {
          return sendJson(response, 200, database.transaction(() => updateManualPlanItem(
            database, workspace.id, itemId, body, context?.personId || null
          )));
        }
        return sendJson(response, 200, updatePlanItem(
          database, workspace.id, planId, itemId, body, context?.personId || null
        ));
      }
      if (method === 'POST' && undoMatch) {
        if (item.origin_kind === 'manual') {
          throw new AppError(
            'plan_item_undo_unavailable',
            'Для ручного пункта используйте обычное редактирование; история изменений остаётся в аудите.',
            409
          );
        }
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
