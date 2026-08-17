import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess, assertAssignmentAccess } from '../../../packages/access-control/src/service.mjs';
import { assertPlanAccess, assertPlanItemAccess } from '../../../packages/plans/src/access.mjs';
import {
  claimOpenPlanItem, createManualPlan, createManualPlanItem, planGenerationInput,
  setPlanItemExecution
} from '../../../packages/plans/src/manual.mjs';
import {
  createSupportingDocument, deleteSupportingDocument, getSupportingDocument,
  linkSupportingDocument, listSupportingDocuments, unlinkSupportingDocument
} from '../../../packages/supporting-documents/src/service.mjs';
import { generatePlanDocument, getPlanDocumentTemplate } from '../../../packages/plan-docx/src/service.mjs';
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
    manual_plan_kind_invalid: ['Выберите вид плана.', 400],
    manual_plan_period_kind_invalid: ['Выберите календарный или учебный год.', 400],
    manual_plan_period_invalid: ['Укажите корректный год плана.', 400],
    manual_plan_person_not_found: ['Сотрудник не найден в рабочем пространстве.', 400],
    manual_plan_not_found: ['План не найден.', 404],
    manual_plan_item_requires_manual_plan: ['Добавление вручную доступно для плана, созданного без исходного файла.', 409],
    manual_plan_item_title_required: ['Укажите название мероприятия.', 400],
    manual_plan_date_invalid: ['Проверьте дату мероприятия или контрольного срока.', 400],
    manual_plan_item_start_required: ['Для периода укажите дату начала.', 400],
    manual_plan_item_range_invalid: ['Дата окончания не может быть раньше даты начала.', 400],
    manual_plan_direction_invalid: ['Выберите направление работы.', 400],
    manual_plan_execution_mode_invalid: ['Выберите режим исполнения.', 400],
    manual_plan_item_not_found: ['Пункт плана не найден.', 404],
    manual_plan_executor_required: ['Для поручения выберите хотя бы одного исполнителя.', 400],
    manual_plan_execution_already_linked: ['У пункта уже есть поручение. Его нельзя молча превратить в информационный пункт.', 409],
    manual_plan_assignment_not_found: ['Связанное поручение не найдено.', 404],
    manual_plan_claim_person_required: ['Для принятия задачи нужен профиль сотрудника.', 400],
    manual_plan_claim_not_open: ['Эта задача не открыта для самостоятельного принятия.', 409],
    manual_plan_already_claimed: ['Задачу уже взял другой сотрудник.', 409],
    supporting_document_number_required: ['Укажите номер сопроводительного документа.', 400],
    supporting_document_date_invalid: ['Укажите корректную дату сопроводительного документа.', 400],
    supporting_document_file_not_found: ['Приложенный документ не найден.', 404],
    supporting_document_target_invalid: ['Не указан объект, к которому относится документ.', 400],
    supporting_document_target_not_found: ['Связываемый объект не найден.', 404],
    supporting_document_not_found: ['Сопроводительный документ не найден.', 404],
    plan_template_not_found: ['Шаблон плана не найден.', 404],
    plan_template_inactive: ['Шаблон плана отключён.', 409],
    plan_generation_idempotency_key_required: ['Не удалось определить ключ безопасной повторной генерации.', 400],
    plan_generation_period_kind_mismatch: ['Шаблон рассчитан на другой вид периода.', 400],
    plan_generation_period_invalid: ['Период плана задан неверно.', 400],
    plan_generation_items_required: ['В плане нет пунктов для формирования документа.', 400],
    plan_generation_in_progress: ['Документ с такими данными уже формируется.', 409],
    plan_generation_idempotency_conflict: ['Параметры повторной генерации отличаются от исходных.', 409]
  };
  const [message, status] = messages[code] || ['Не удалось выполнить операцию с планом.', 500];
  return new AppError(code, message, status, cause?.details);
}

function planItemBelongs(database, workspaceId, planId, itemId) {
  return Boolean(database.get(`
    SELECT 1 AS present FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND p.id = ? AND pi.id = ?
  `, workspaceId, planId, itemId));
}

function documentIdFromFileInput(database, workspaceId, body) {
  if (body.documentId) return body.documentId;
  if (!body.documentVersionId) return null;
  return database.get(`
    SELECT d.id FROM document_versions dv JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, body.documentVersionId)?.id || null;
}

function assertMeetingAccess(database, workspaceId, context, meetingId, action) {
  const meeting = database.get(`
    SELECT m.*, dv.document_id AS source_document_id
    FROM meetings m LEFT JOIN document_versions dv ON dv.id = m.source_document_version_id
    WHERE m.workspace_id = ? AND m.id = ?
  `, workspaceId, meetingId);
  if (!meeting) throw new AppError('meeting_not_found', 'Заседание не найдено.', 404);
  if (meeting.source_document_id) {
    assertObjectAccess(database, workspaceId, context, 'document', meeting.source_document_id, action);
    return;
  }
  if (!context?.authenticated) throw new AppError('meeting_access_forbidden', 'Нет доступа к заседанию.', 403);
  if (!context.enabled || context.role === 'admin' || meeting.created_by_person_id === context.personId) return;
  throw new AppError('meeting_access_forbidden', 'Нет доступа к заседанию.', 403);
}

function assertTargetAccess(database, workspaceId, context, targetKind, targetId, action = 'read') {
  if (targetKind === 'document') return assertObjectAccess(database, workspaceId, context, 'document', targetId, action);
  if (targetKind === 'scientific_item') return assertObjectAccess(database, workspaceId, context, 'scientific_item', targetId, action);
  if (targetKind === 'assignment') return assertAssignmentAccess(database, workspaceId, context, targetId, action === 'manage' ? 'control' : action);
  if (targetKind === 'plan_item') return assertPlanItemAccess(database, workspaceId, context, targetId, action);
  if (targetKind === 'meeting') return assertMeetingAccess(database, workspaceId, context, targetId, action);
  throw new AppError('supporting_document_target_invalid', 'Не указан объект, к которому относится документ.', 400);
}

function privilegedOwner(context, support) {
  return Boolean(context?.authenticated && (
    !context.enabled || context.role === 'admin' || support.created_by_person_id === context.personId
  ));
}

function assertSupportingRead(database, workspaceId, context, support) {
  if (!support) throw new AppError('supporting_document_not_found', 'Сопроводительный документ не найден.', 404);
  if (privilegedOwner(context, support)) return;
  const readable = support.links.some((link) => {
    try {
      assertTargetAccess(database, workspaceId, context, link.target_kind, link.target_id, 'read');
      return true;
    } catch {
      return false;
    }
  });
  if (!readable) throw new AppError('supporting_document_access_forbidden', 'Нет доступа к сопроводительному документу.', 403);
}

function assertSupportingEditAll(database, workspaceId, context, support) {
  if (!support) throw new AppError('supporting_document_not_found', 'Сопроводительный документ не найден.', 404);
  if (privilegedOwner(context, support)) return;
  if (!support.links.length) throw new AppError('supporting_document_access_forbidden', 'Нет доступа к сопроводительному документу.', 403);
  for (const link of support.links) {
    try {
      assertTargetAccess(database, workspaceId, context, link.target_kind, link.target_id, 'edit');
    } catch {
      throw new AppError(
        'supporting_document_access_forbidden',
        'Изменение затронет объект, к которому у вас нет прав редактирования.',
        403
      );
    }
  }
}

export function createManualPlansRouter({ database, config }) {
  return async function routeManualPlans(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const workspace = workspaceOf(database, request);
    const context = request.auth;
    const actorPersonId = context?.personId || null;

    if (method === 'POST' && path === '/api/plans') {
      const body = await readJson(request);
      try {
        const plan = createManualPlan(database, workspace.id, body, actorPersonId);
        return sendJson(response, 201, plan, { location: `/api/plans/${plan.id}` });
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const itemCollectionMatch = path.match(/^\/api\/plans\/([^/]+)\/items$/);
    if (method === 'POST' && itemCollectionMatch) {
      const planId = decodeURIComponent(itemCollectionMatch[1]);
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      const body = await readJson(request);
      try {
        const item = database.transaction(() => createManualPlanItem(
          database, workspace.id, planId, body, actorPersonId
        ));
        return sendJson(response, 201, item, { location: `/api/plans/${planId}` });
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const executionMatch = path.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)\/execution$/);
    if (method === 'POST' && executionMatch) {
      const planId = decodeURIComponent(executionMatch[1]);
      const itemId = decodeURIComponent(executionMatch[2]);
      if (!planItemBelongs(database, workspace.id, planId, itemId)) {
        throw new AppError('plan_item_not_found', 'Пункт плана не найден.', 404);
      }
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      const body = await readJson(request);
      try {
        return sendJson(response, 200, setPlanItemExecution(
          database, workspace.id, itemId, body, actorPersonId
        ));
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const claimMatch = path.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)\/claim$/);
    if (method === 'POST' && claimMatch) {
      const planId = decodeURIComponent(claimMatch[1]);
      const itemId = decodeURIComponent(claimMatch[2]);
      if (!planItemBelongs(database, workspace.id, planId, itemId)) {
        throw new AppError('plan_item_not_found', 'Пункт плана не найден.', 404);
      }
      assertPlanAccess(database, workspace.id, context, planId, 'read');
      try {
        return sendJson(response, 200, claimOpenPlanItem(
          database, workspace.id, itemId, actorPersonId
        ));
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const generateMatch = path.match(/^\/api\/plans\/([^/]+)\/generate$/);
    if (method === 'POST' && generateMatch) {
      const planId = decodeURIComponent(generateMatch[1]);
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      const body = await readJson(request);
      const templateId = String(body.templateId || '').trim();
      const template = templateId ? getPlanDocumentTemplate(database, workspace.id, templateId) : null;
      if (!template) throw new AppError('plan_template_not_found', 'Шаблон плана не найден.', 404);
      assertObjectAccess(database, workspace.id, context, 'document', template.source_document_id, 'edit');
      const headerKey = typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key'].trim() : '';
      try {
        const input = planGenerationInput(
          database, workspace.id, planId, body.idempotencyKey || headerKey || null
        );
        const result = await generatePlanDocument(
          database, workspace.id, templateId, input, config, actorPersonId
        );
        return sendJson(response, result.duplicateRequest ? 200 : 202, result, {
          location: result.generated_document_id ? `/api/documents/${result.generated_document_id}` : undefined
        });
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    if (method === 'GET' && path === '/api/supporting-documents') {
      const targetKind = url.searchParams.get('targetKind');
      const targetId = url.searchParams.get('targetId');
      if (!targetKind || !targetId) {
        throw new AppError('supporting_document_target_invalid', 'Выберите объект, для которого нужны документы.', 400);
      }
      assertTargetAccess(database, workspace.id, context, targetKind, targetId, 'read');
      try {
        return sendJson(response, 200, {
          items: listSupportingDocuments(database, workspace.id, { targetKind, targetId })
        });
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    if (method === 'POST' && path === '/api/supporting-documents') {
      const body = await readJson(request);
      if (body.targetKind && body.targetId) {
        assertTargetAccess(database, workspace.id, context, body.targetKind, body.targetId, 'edit');
      }
      const fileDocumentId = documentIdFromFileInput(database, workspace.id, body);
      if ((body.documentId || body.documentVersionId) && !fileDocumentId) {
        throw new AppError('supporting_document_file_not_found', 'Приложенный документ не найден.', 404);
      }
      if (fileDocumentId) {
        assertObjectAccess(database, workspace.id, context, 'document', fileDocumentId, 'read');
      }
      try {
        const item = createSupportingDocument(database, workspace.id, body, actorPersonId);
        return sendJson(response, 201, item, { location: `/api/supporting-documents/${item.id}` });
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const supportLinkMatch = path.match(/^\/api\/supporting-documents\/([^/]+)\/links$/);
    if (method === 'POST' && supportLinkMatch) {
      const id = decodeURIComponent(supportLinkMatch[1]);
      const support = getSupportingDocument(database, workspace.id, id);
      assertSupportingEditAll(database, workspace.id, context, support);
      const body = await readJson(request);
      assertTargetAccess(database, workspace.id, context, body.targetKind, body.targetId, 'edit');
      try {
        return sendJson(response, 200, linkSupportingDocument(
          database, workspace.id, id, body, actorPersonId
        ));
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const supportMatch = path.match(/^\/api\/supporting-documents\/([^/]+)$/);
    if (supportMatch && method === 'GET') {
      const item = getSupportingDocument(database, workspace.id, decodeURIComponent(supportMatch[1]));
      assertSupportingRead(database, workspace.id, context, item);
      return sendJson(response, 200, item);
    }
    if (supportMatch && method === 'DELETE') {
      const id = decodeURIComponent(supportMatch[1]);
      const item = getSupportingDocument(database, workspace.id, id);
      assertSupportingEditAll(database, workspace.id, context, item);
      try {
        return sendJson(response, 200, deleteSupportingDocument(
          database, workspace.id, id, actorPersonId
        ));
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    const unlinkMatch = path.match(/^\/api\/supporting-documents\/([^/]+)\/unlink$/);
    if (method === 'POST' && unlinkMatch) {
      const id = decodeURIComponent(unlinkMatch[1]);
      const body = await readJson(request);
      assertTargetAccess(database, workspace.id, context, body.targetKind, body.targetId, 'edit');
      const support = getSupportingDocument(database, workspace.id, id);
      assertSupportingRead(database, workspace.id, context, support);
      try {
        return sendJson(response, 200, unlinkSupportingDocument(
          database, workspace.id, id, body, actorPersonId
        ));
      } catch (cause) {
        throw mappedError(cause);
      }
    }

    return false;
  };
}
