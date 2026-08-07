import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  getPlan, listPlans, planDocumentId, planItemAudience, planItemDocumentId
} from '../../../packages/plans/src/service.mjs';
import {
  analyzePlanTemplate, createPlanTemplate, generatePlanDocument,
  getPlanDocumentTemplate, listPlanDocumentTemplates, listPlanGenerationRuns
} from '../../../packages/plan-docx/src/service.mjs';
import {
  getCalendarItem, listCalendarItems, listNotifications, listTasks
} from '../../../packages/calendar/src/service.mjs';
import {
  assertObjectAccess, canReadCalendarItem, resolveObjectAccess
} from '../../../packages/access-control/src/service.mjs';
import { assertPersonScope } from '../../../packages/auth/src/policy.mjs';
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

function integerParam(value, fallback, max = 1000) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function categoriesParam(url) {
  return url.searchParams.getAll('category')
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function planFilters(url, limit) {
  return {
    q: url.searchParams.get('q') || '',
    kind: url.searchParams.get('kind') || '',
    periodKind: url.searchParams.get('periodKind') || '',
    periodKey: url.searchParams.get('periodKey') || '',
    ownerPersonId: url.searchParams.get('ownerPersonId') || '',
    responsible: url.searchParams.get('responsible') || '',
    direction: url.searchParams.get('direction') || '',
    status: url.searchParams.get('status') || '',
    limit
  };
}

function canReadPlan(database, workspaceId, context, plan) {
  const documentId = plan.source_document_id || planDocumentId(database, workspaceId, plan.id);
  return Boolean(documentId && resolveObjectAccess(database, workspaceId, context, 'document', documentId).allowed);
}

function planCalendarDocumentId(database, workspaceId, item) {
  if (!item || item.source_kind !== 'plan_item') return null;
  return item.origin_document_id || planItemDocumentId(database, workspaceId, item.source_id);
}

function canReadCalendar(database, workspaceId, context, item) {
  if (item.source_kind !== 'plan_item') return canReadCalendarItem(database, workspaceId, context, item);
  const documentId = planCalendarDocumentId(database, workspaceId, item);
  return Boolean(documentId && resolveObjectAccess(database, workspaceId, context, 'document', documentId).allowed);
}

function assertPlanCalendar(database, workspaceId, context, item, action) {
  if (!item || item.source_kind !== 'plan_item') return false;
  const documentId = planCalendarDocumentId(database, workspaceId, item);
  if (!documentId) throw new AppError('plan_source_not_found', 'Исходный документ плана не найден.', 404);
  assertObjectAccess(database, workspaceId, context, 'document', documentId, action);
  return true;
}

function facetValues(items, field) {
  const counts = new Map();
  for (const item of items) {
    const values = field === 'directions'
      ? String(item.directions || '').split(',').filter(Boolean)
      : [item[field]].filter(Boolean);
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ru'))
    .map(([value, count]) => ({ value, count }));
}

function filterPlanNotifications(database, workspaceId, context, personId, items, limit) {
  const result = [];
  for (const notification of items) {
    const calendar = getCalendarItem(database, workspaceId, notification.calendarItemId);
    if (!calendar) continue;
    if (calendar.source_kind !== 'plan_item') {
      if (canReadCalendarItem(database, workspaceId, context, calendar)) result.push(notification);
      continue;
    }
    if (!canReadCalendar(database, workspaceId, context, calendar)) continue;
    const audience = planItemAudience(database, workspaceId, calendar.source_id);
    if (personId && audience.length && !audience.includes(personId)) continue;
    result.push({ ...notification, audience: { ...(notification.audience || {}), personIds: audience } });
    if (result.length >= limit) break;
  }
  return result;
}

function planTemplateError(cause) {
  if (cause instanceof AppError) return cause;
  const code = String(cause?.code || cause?.message || cause);
  const details = cause?.details;
  const messages = {
    plan_template_source_not_found: ['Исходный документ шаблона не найден.', 404],
    plan_template_source_not_docx: ['Для формирования плана нужен шаблон DOCX.', 415],
    plan_template_name_required: ['Назовите шаблон плана.', 400],
    plan_template_already_exists: ['Такой шаблон для этой версии документа уже сохранён.', 409],
    plan_template_review_required: ['Структура шаблона определена неоднозначно. Проверьте найденный год и таблицу.', 409],
    plan_template_unmapped_columns: ['В таблице есть колонки, назначение которых не определено. Подтвердите их очистку или настройте шаблон.', 409],
    plan_template_period_anchor_required: ['Не найдено место для безопасной автоподстановки года.', 409],
    plan_template_period_anchor_invalid: ['Настройка года больше не соответствует исходному DOCX.', 409],
    plan_template_table_invalid: ['Выбранная таблица не найдена в исходном DOCX.', 409],
    plan_template_rows_invalid: ['Строка-образец или диапазон строк шаблона заданы неверно.', 409],
    plan_template_row_complex: ['Строка-образец содержит объединённые ячейки и не может клонироваться автоматически.', 409],
    plan_template_columns_required: ['Укажите колонки мероприятия и даты или контрольного срока.', 400],
    plan_template_column_invalid: ['Одна из колонок шаблона указана неверно.', 400],
    plan_template_clear_column_invalid: ['Колонка для очистки указана неверно.', 400],
    plan_template_kind_invalid: ['Неизвестный вид плана.', 400],
    plan_template_period_kind_invalid: ['Неизвестный вид периода плана.', 400],
    plan_template_not_found: ['Шаблон плана не найден.', 404],
    plan_template_inactive: ['Шаблон плана отключён.', 409],
    plan_generation_idempotency_key_required: ['Передайте ключ идемпотентности генерации.', 400],
    plan_generation_idempotency_key_invalid: ['Ключ идемпотентности слишком длинный.', 400],
    plan_generation_idempotency_conflict: ['Этот ключ генерации уже использован с другими данными.', 409],
    plan_generation_in_progress: ['Формирование с этим ключом уже выполняется.', 409],
    plan_generation_period_kind_mismatch: ['Период не соответствует виду периода шаблона.', 400],
    plan_generation_period_invalid: ['Укажите корректный календарный или учебный год.', 400],
    plan_generation_items_required: ['Добавьте хотя бы один пункт плана.', 400],
    plan_generation_items_too_many: ['В одном документе допускается не более 5000 пунктов.', 400],
    plan_generation_item_title_required: ['У каждого пункта плана должно быть наименование.', 400],
    plan_generation_item_date_invalid: ['Дата пункта плана задана неверно.', 400],
    plan_generation_column_invalid: ['Структура строки шаблона изменилась. Повторно проверьте шаблон.', 409],
    plan_generation_period_anchor_changed: ['Место автоподстановки года изменилось. Повторно проверьте шаблон.', 409],
    plan_generation_table_changed: ['Таблица плана изменилась. Повторно проверьте шаблон.', 409],
    plan_generation_template_row_changed: ['Строка-образец плана изменилась. Повторно проверьте шаблон.', 409]
  };
  const [message, status] = messages[code] || ['Не удалось сформировать план по шаблону.', 500];
  return new AppError(code, message, status, details);
}

export function createPlansRouter({ database, config }) {
  return async function routePlans(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const workspace = workspaceOf(database, request);
    const context = request.auth;

    if (method === 'POST' && path === '/api/plan-templates/analyze') {
      const body = await readJson(request);
      if (!body.documentId) throw new AppError('document_id_required', 'Выберите DOCX-образец плана.', 400);
      assertObjectAccess(database, workspace.id, context, 'document', body.documentId, 'read');
      try {
        return sendJson(response, 200, await analyzePlanTemplate(database, workspace.id, body.documentId, body));
      } catch (cause) { throw planTemplateError(cause); }
    }

    if (method === 'GET' && path === '/api/plan-templates') {
      const limit = integerParam(url.searchParams.get('limit'), 300, 1000);
      const items = listPlanDocumentTemplates(database, workspace.id, {
        status: url.searchParams.get('status') || 'active', limit: Math.min(2000, limit * 4)
      }).filter((item) => resolveObjectAccess(
        database, workspace.id, context, 'document', item.source_document_id
      ).allowed).slice(0, limit);
      return sendJson(response, 200, { items });
    }

    if (method === 'POST' && path === '/api/plan-templates') {
      const body = await readJson(request);
      if (!body.documentId) throw new AppError('document_id_required', 'Выберите DOCX-образец плана.', 400);
      assertObjectAccess(database, workspace.id, context, 'document', body.documentId, 'edit');
      try {
        const item = await createPlanTemplate(database, workspace.id, body, context?.personId || null);
        return sendJson(response, 201, item);
      } catch (cause) { throw planTemplateError(cause); }
    }

    const generationMatch = path.match(/^\/api\/plan-templates\/([^/]+)\/generate$/);
    if (method === 'POST' && generationMatch) {
      const templateId = decodeURIComponent(generationMatch[1]);
      const template = getPlanDocumentTemplate(database, workspace.id, templateId);
      if (!template) throw new AppError('plan_template_not_found', 'Шаблон плана не найден.', 404);
      assertObjectAccess(database, workspace.id, context, 'document', template.source_document_id, 'edit');
      const body = await readJson(request);
      const headerKey = typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'].trim() : '';
      if (!body.idempotencyKey && headerKey) body.idempotencyKey = headerKey;
      try {
        const result = await generatePlanDocument(
          database, workspace.id, templateId, body, config, context?.personId || null
        );
        return sendJson(response, result.duplicateRequest ? 200 : 202, result, {
          location: result.generated_document_id ? `/api/documents/${result.generated_document_id}` : undefined
        });
      } catch (cause) { throw planTemplateError(cause); }
    }

    const generationsMatch = path.match(/^\/api\/plan-templates\/([^/]+)\/generations$/);
    if (method === 'GET' && generationsMatch) {
      const templateId = decodeURIComponent(generationsMatch[1]);
      const template = getPlanDocumentTemplate(database, workspace.id, templateId);
      if (!template) throw new AppError('plan_template_not_found', 'Шаблон плана не найден.', 404);
      assertObjectAccess(database, workspace.id, context, 'document', template.source_document_id, 'read');
      return sendJson(response, 200, {
        items: listPlanGenerationRuns(database, workspace.id, templateId, integerParam(url.searchParams.get('limit'), 50, 200))
      });
    }

    const templateMatch = path.match(/^\/api\/plan-templates\/([^/]+)$/);
    if (method === 'GET' && templateMatch) {
      const item = getPlanDocumentTemplate(database, workspace.id, decodeURIComponent(templateMatch[1]));
      if (!item) throw new AppError('plan_template_not_found', 'Шаблон плана не найден.', 404);
      assertObjectAccess(database, workspace.id, context, 'document', item.source_document_id, 'read');
      return sendJson(response, 200, item);
    }

    if (method === 'GET' && path === '/api/plans') {
      const limit = integerParam(url.searchParams.get('limit'), 300, 1000);
      const candidates = listPlans(database, workspace.id, planFilters(url, Math.min(2000, limit * 6)));
      const readable = candidates.filter((item) => canReadPlan(database, workspace.id, context, item));
      const items = readable.slice(0, limit);
      return sendJson(response, 200, {
        items,
        facets: {
          kinds: facetValues(readable, 'plan_kind'),
          periods: facetValues(readable, 'period_key'),
          directions: facetValues(readable, 'directions')
        }
      });
    }

    const planMatch = path.match(/^\/api\/plans\/([^/]+)$/);
    if (method === 'GET' && planMatch) {
      const planId = decodeURIComponent(planMatch[1]);
      const documentId = planDocumentId(database, workspace.id, planId);
      if (!documentId) throw new AppError('plan_not_found', 'План не найден.', 404);
      assertObjectAccess(database, workspace.id, context, 'document', documentId, 'read');
      const plan = getPlan(database, workspace.id, planId);
      if (!plan) throw new AppError('plan_not_found', 'План не найден.', 404);
      return sendJson(response, 200, plan);
    }

    if (method === 'GET' && path === '/api/calendar') {
      const limit = integerParam(url.searchParams.get('limit'), 500, 2000);
      const items = listCalendarItems(database, workspace.id, {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        kind: url.searchParams.get('kind'),
        status: url.searchParams.get('status'),
        categories: categoriesParam(url),
        limit: Math.min(5000, limit * 4)
      }).filter((item) => canReadCalendar(database, workspace.id, context, item)).slice(0, limit);
      return sendJson(response, 200, { items });
    }

    const calendarUndoMatch = path.match(/^\/api\/calendar\/([^/]+)\/undo$/);
    if (method === 'POST' && calendarUndoMatch) {
      const item = getCalendarItem(database, workspace.id, decodeURIComponent(calendarUndoMatch[1]));
      if (item?.source_kind === 'plan_item') assertPlanCalendar(database, workspace.id, context, item, 'edit');
      return false;
    }

    const calendarMatch = path.match(/^\/api\/calendar\/([^/]+)$/);
    if (['GET', 'PATCH'].includes(method) && calendarMatch) {
      const item = getCalendarItem(database, workspace.id, decodeURIComponent(calendarMatch[1]));
      if (item?.source_kind === 'plan_item') {
        assertPlanCalendar(database, workspace.id, context, item, method === 'GET' ? 'read' : 'edit');
        if (method === 'GET') return sendJson(response, 200, item);
      }
      return false;
    }

    if (method === 'GET' && path === '/api/tasks') {
      const limit = integerParam(url.searchParams.get('limit'), 500, 2000);
      const items = listTasks(database, workspace.id, {
        categories: categoriesParam(url), limit: Math.min(5000, limit * 4)
      }).filter((item) => canReadCalendar(database, workspace.id, context, item)).slice(0, limit);
      return sendJson(response, 200, { items });
    }

    if (method === 'GET' && path === '/api/notifications') {
      const personId = url.searchParams.get('personId') || context?.personId || null;
      if (personId) assertPersonScope(database, workspace.id, context, personId);
      const limit = integerParam(url.searchParams.get('limit'), 50, 200);
      const candidates = listNotifications(database, workspace.id, {
        limit: Math.min(1000, limit * 5), personId
      });
      const items = filterPlanNotifications(database, workspace.id, context, personId, candidates, limit);
      return sendJson(response, 200, { items, unread: items.filter((item) => !item.read).length });
    }

    return false;
  };
}
