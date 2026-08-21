import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { assertPlanAccess, assertPlanItemAccess } from '../../../packages/plans/src/access.mjs';
import {
  getScienceLifecycleItem,
  listScienceLifecycleItems,
  transitionScienceLifecycle,
  unlinkScienceFromPlan,
  updateScienceEditorial
} from '../../../packages/science-lifecycle/src/service.mjs';
import { linkSciencePlan } from '../../../packages/science-lifecycle/src/plan-link.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function mapped(error) {
  if (error instanceof AppError) return error;
  const code = String(error?.code || error?.message || error);
  const messages = {
    scientific_item_not_found: ['Научный материал не найден.', 404],
    science_editor_reason_required: ['Укажите причину ручного исправления.', 400],
    science_editor_title_required: ['Укажите название научного материала.', 400],
    science_editor_kind_invalid: ['Выберите корректный вид научного материала.', 400],
    science_editor_year_invalid: ['Проверьте год публикации.', 400],
    science_editor_authors_invalid: ['Список авторов задан неверно.', 400],
    science_editor_authors_required: ['Добавьте хотя бы одного автора.', 400],
    science_editor_classifications_invalid: ['Классификации заданы неверно.', 400],
    science_lifecycle_date_invalid: ['Проверьте дату события или следующего действия.', 400],
    science_lifecycle_status_invalid: ['Выберите корректный этап научной работы.', 400],
    science_lifecycle_transition_invalid: ['Такой переход этапа недоступен. Выберите следующий предметный шаг.', 409],
    science_lifecycle_evidence_not_found: ['Подтверждающий документ не найден.', 404],
    science_plan_required: ['Выберите план для создания мероприятия.', 400],
    science_plan_item_not_found: ['Пункт плана не найден.', 404],
    science_plan_link_exists: ['Научный материал уже связан с пунктом плана.', 409],
    science_plan_link_not_found: ['Связь с планом не найдена.', 404]
  };
  const [message, status] = messages[code] || ['Не удалось сохранить научную карточку.', 500];
  return new AppError(code, message, status, error?.details);
}

function filterReadable(database, workspaceId, context, items) {
  return items.filter((item) => {
    try {
      assertObjectAccess(database, workspaceId, context, 'scientific_item', item.id, 'read');
      return true;
    } catch {
      return false;
    }
  });
}

function assertEvidenceAccess(database, workspaceId, context, documentVersionId) {
  if (!documentVersionId) return;
  const documentId = database.get(`
    SELECT d.id FROM document_versions dv JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, documentVersionId)?.id;
  if (documentId) assertObjectAccess(database, workspaceId, context, 'document', documentId, 'read');
}

export function createScienceLifecycleRouter({ database }) {
  return async function routeScienceLifecycle(request, response, url) {
    const path = url.pathname;
    const relevant = path === '/api/science-lifecycle'
      || /^\/api\/science\/[^/]+\/(lifecycle|editor|lifecycle-events|plan-link|unlink-plan)$/u.test(path);
    if (!relevant) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const context = request.auth || { enabled: false };
    const actorPersonId = context.personId || null;
    const method = request.method || 'GET';
    try {
      if (path === '/api/science-lifecycle' && method === 'GET') {
        const items = listScienceLifecycleItems(database, workspace, {
          lifecycleStatus: url.searchParams.get('status') || null,
          unitId: url.searchParams.get('unitId') || null,
          personId: url.searchParams.get('personId') || null,
          yearFrom: url.searchParams.get('yearFrom') || null,
          yearTo: url.searchParams.get('yearTo') || null,
          limit: url.searchParams.get('limit') || 1000
        });
        return sendJson(response, 200, { items: filterReadable(database, workspace, context, items) });
      }

      const match = path.match(/^\/api\/science\/([^/]+)\/(lifecycle|editor|lifecycle-events|plan-link|unlink-plan)$/u);
      if (!match) return false;
      const scientificItemId = decodeURIComponent(match[1]);
      const action = match[2];
      if (action === 'lifecycle' && method === 'GET') {
        assertObjectAccess(database, workspace, context, 'scientific_item', scientificItemId, 'read');
        const item = getScienceLifecycleItem(database, workspace, scientificItemId);
        if (!item) throw new AppError('scientific_item_not_found', 'Научный материал не найден.', 404);
        return sendJson(response, 200, item);
      }
      assertObjectAccess(database, workspace, context, 'scientific_item', scientificItemId, 'edit');
      if (action === 'editor' && method === 'PATCH') {
        return sendJson(response, 200, updateScienceEditorial(
          database, workspace, scientificItemId, await readJson(request), actorPersonId
        ));
      }
      if (action === 'lifecycle-events' && method === 'POST') {
        const body = await readJson(request);
        assertEvidenceAccess(database, workspace, context, body.evidenceDocumentVersionId);
        return sendJson(response, 200, transitionScienceLifecycle(
          database, workspace, scientificItemId, body, actorPersonId
        ));
      }
      if (action === 'plan-link' && method === 'POST') {
        const body = await readJson(request);
        if (body.planItemId) assertPlanItemAccess(database, workspace, context, body.planItemId, 'edit');
        else if (body.planId) assertPlanAccess(database, workspace, context, body.planId, 'edit');
        return sendJson(response, 200, linkSciencePlan(
          database, workspace, scientificItemId, body, actorPersonId
        ));
      }
      if (action === 'unlink-plan' && method === 'POST') {
        return sendJson(response, 200, unlinkScienceFromPlan(
          database, workspace, scientificItemId, await readJson(request), actorPersonId
        ));
      }
      return false;
    } catch (error) {
      throw mapped(error);
    }
  };
}
