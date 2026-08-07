import { basename } from 'node:path';
import { AppError } from '../../../packages/core/src/errors.mjs';
import { detectFormat } from '../../../packages/document-intake/src/formats.mjs';
import { storeIncomingStream } from '../../../packages/document-intake/src/blob-store.mjs';
import { registerDocument } from '../../../packages/storage/src/documents.mjs';
import { getCalendarItem, listCalendarItems, listTasks } from '../../../packages/calendar/src/service.mjs';
import { assertPersonScope, listManagedPeople } from '../../../packages/auth/src/policy.mjs';
import {
  getPlan,
  listPlanCalendarSources,
  listPlans,
  setPlanIngestHint
} from '../../../packages/plans/src/service.mjs';
import {
  analyzePlanTemplate,
  generatePlanFromTemplate,
  getPlanTemplate,
  listPlanTemplates,
  savePlanTemplate
} from '../../../packages/plans/src/templates.mjs';
import { readJson, requireHeader, sendJson } from './http-utils.mjs';

const PLAN_SCOPES = new Set(['department', 'faculty', 'personal', 'unit', 'organization']);
const PERIOD_KINDS = new Set(['calendar_year', 'academic_year', 'custom']);

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

function planFilters(url) {
  return {
    q: url.searchParams.get('q') || '',
    scope: url.searchParams.get('scope') || '',
    period: url.searchParams.get('period') || '',
    periodKind: url.searchParams.get('periodKind') || '',
    direction: url.searchParams.get('direction') || '',
    responsible: url.searchParams.get('responsible') || '',
    ownerPersonId: url.searchParams.get('ownerPersonId') || '',
    status: url.searchParams.get('status') || '',
    limit: integerParam(url.searchParams.get('limit'), 300, 1000)
  };
}

function visiblePersonalIds(database, workspaceId, context) {
  if (!context?.enabled || context.role === 'admin') return null;
  if (!context.personId) return [];
  if (context.role === 'manager') {
    return [context.personId, ...listManagedPeople(database, workspaceId, context.personId).map((item) => item.id)];
  }
  return [context.personId];
}

function planVisible(plan, allowedPersonalIds) {
  if (!plan || plan.plan_scope !== 'personal' || allowedPersonalIds === null) return true;
  return Boolean(plan.owner_person_id && allowedPersonalIds.includes(plan.owner_person_id));
}

function calendarItemVisible(database, item, allowedPersonalIds) {
  if (!item || item.source_kind !== 'plan_item' || allowedPersonalIds === null) return true;
  const plan = database.get(`
    SELECT p.plan_scope, p.owner_person_id
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    WHERE pi.id = ?
  `, item.source_id);
  return Boolean(plan && planVisible(plan, allowedPersonalIds));
}

function guardCalendarItem(database, workspaceId, itemId, allowedPersonalIds) {
  const item = getCalendarItem(database, workspaceId, itemId);
  if (!item) return null;
  if (!calendarItemVisible(database, item, allowedPersonalIds)) {
    throw new AppError('plan_calendar_forbidden', 'Нет доступа к сроку из этого личного плана.', 403);
  }
  return item;
}

function scopeHeader(request) {
  const value = String(request.headers['x-plan-scope'] || '').trim();
  if (!value || value === 'auto') return null;
  if (!PLAN_SCOPES.has(value)) throw new AppError('plan_scope_invalid', 'Неизвестный вид плана.', 400);
  return value;
}

function periodKindHeader(request) {
  const value = String(request.headers['x-plan-period-kind'] || '').trim();
  if (!value) return null;
  if (!PERIOD_KINDS.has(value)) throw new AppError('plan_period_kind_invalid', 'Неизвестный вид периода плана.', 400);
  return value;
}

function planError(error) {
  const code = String(error?.message || error);
  const errors = {
    plan_template_document_not_found: ['Исходный документ шаблона не найден.', 404],
    plan_template_docx_required: ['Для формирования по образцу нужен DOCX.', 415],
    plan_template_not_ready: ['Шаблон ещё обрабатывается. Дождитесь извлечения структуры документа.', 409],
    plan_template_table_not_found: ['Не удалось надёжно определить таблицу мероприятий.', 409],
    plan_template_name_required: ['Назовите шаблон плана.', 400],
    plan_template_year_required: ['Укажите найденный в шаблоне год или заполнитель года.', 400],
    plan_template_table_invalid: ['Проверьте номер таблицы и строки-образца.', 400],
    plan_template_columns_required: ['В шаблоне должны быть столбец мероприятия и дата или срок.', 400],
    plan_template_not_found: ['Шаблон плана не найден.', 404],
    plan_generation_year_invalid: ['Укажите год, например 2026.', 400],
    plan_generation_academic_year_invalid: ['Учебный год должен состоять из двух последовательных лет.', 400],
    plan_generation_date_invalid: ['Дата пункта плана должна быть корректной датой.', 400],
    plan_generation_items_required: ['Добавьте хотя бы один пункт плана.', 400],
    plan_generation_item_title_required: ['У каждого пункта должно быть название.', 400],
    plan_template_year_not_found: ['Год в DOCX не найден в ожидаемом месте. Исправьте настройку шаблона.', 409],
    plan_template_sample_row_not_found: ['Строка-образец таблицы не найдена в DOCX.', 409],
    plan_template_column_map_invalid: ['Столбцы шаблона не совпадают со строкой-образцом.', 409],
    plan_template_document_xml_missing: ['В DOCX отсутствует основной XML документа.', 422],
    plan_template_unpacked_too_large: ['Распакованный шаблон слишком велик для безопасной обработки.', 413]
  };
  const mapped = errors[code];
  return mapped ? new AppError(code, mapped[0], mapped[1]) : error;
}

async function acceptFile(database, workspace, request, config, { templateOnly = false } = {}) {
  const encodedName = requireHeader(request, 'x-file-name', 'Передайте исходное имя файла в заголовке X-File-Name.');
  let decodedName;
  try { decodedName = decodeURIComponent(encodedName); } catch { decodedName = encodedName; }
  const originalName = basename(decodedName);
  const mediaType = String(request.headers['content-type'] || 'application/octet-stream').split(';', 1)[0];
  const format = detectFormat(originalName, mediaType);
  if (templateOnly && format !== 'docx') {
    throw new AppError('plan_template_docx_required', 'Для шаблона формирования плана загрузите DOCX.', 415);
  }
  const blob = await storeIncomingStream(request, {
    blobDir: config.blobDir,
    tempDir: config.tempDir,
    maxBytes: config.maxUploadBytes,
    mediaType
  });
  const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
    ? request.headers['idempotency-key'].trim()
    : null;
  const planScope = templateOnly ? null : scopeHeader(request);
  const periodKind = templateOnly ? null : periodKindHeader(request);
  const periodKey = templateOnly ? null : String(request.headers['x-plan-period'] || '').trim() || null;
  const ownerPersonId = templateOnly ? null : String(request.headers['x-plan-owner-person-id'] || '').trim() || null;
  if (ownerPersonId) assertPersonScope(database, workspace.id, request.auth, ownerPersonId);
  let result;
  database.transaction(() => {
    result = registerDocument(database, {
      workspaceId: workspace.id,
      title: originalName.replace(/\.[^.]+$/, '') || originalName,
      originalName,
      mediaType,
      detectedFormat: format,
      blob,
      requestedType: templateOnly ? 'plan_template' : (planScope ? `${planScope}_plan` : 'plan'),
      idempotencyKey
    });
    if (result.jobId && !result.duplicateRequest) {
      database.run('UPDATE jobs SET kind = ? WHERE id = ?', templateOnly ? 'process_plan_template' : 'process_plan_document', result.jobId);
    }
    if (!templateOnly) {
      setPlanIngestHint(database, {
        workspaceId: workspace.id,
        documentVersionId: result.versionId,
        planScope,
        periodKind,
        periodKey,
        ownerPersonId
      });
    }
  });
  return result;
}

export function createPlansRouter({ database, config, logger }) {
  return async function routePlans(request, response, url, requestId) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const calendarGuarded = path === '/api/calendar'
      || path === '/api/tasks'
      || /^\/api\/calendar\/[^/]+(?:\/undo)?$/.test(path);
    if (!path.startsWith('/api/plans') && !path.startsWith('/api/plan-templates') && !calendarGuarded) return false;
    const workspace = workspaceOf(database, request);
    const allowedPersonalIds = visiblePersonalIds(database, workspace.id, request.auth);

    if (method === 'GET' && path === '/api/calendar') {
      const items = listCalendarItems(database, workspace.id, {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        kind: url.searchParams.get('kind'),
        status: url.searchParams.get('status'),
        categories: categoriesParam(url),
        limit: integerParam(url.searchParams.get('limit'), 500, 2000)
      }).filter((item) => calendarItemVisible(database, item, allowedPersonalIds));
      sendJson(response, 200, { items });
      return true;
    }
    if (method === 'GET' && path === '/api/tasks') {
      const items = listTasks(database, workspace.id, {
        categories: categoriesParam(url),
        limit: integerParam(url.searchParams.get('limit'), 500, 2000)
      }).filter((item) => calendarItemVisible(database, item, allowedPersonalIds));
      sendJson(response, 200, { items });
      return true;
    }
    const calendarUndoMatch = path.match(/^\/api\/calendar\/([^/]+)\/undo$/);
    if (method === 'POST' && calendarUndoMatch) {
      guardCalendarItem(database, workspace.id, decodeURIComponent(calendarUndoMatch[1]), allowedPersonalIds);
      return false;
    }
    const calendarMatch = path.match(/^\/api\/calendar\/([^/]+)$/);
    if (calendarMatch && ['GET', 'PATCH'].includes(method)) {
      const item = guardCalendarItem(database, workspace.id, decodeURIComponent(calendarMatch[1]), allowedPersonalIds);
      if (method === 'GET' && item) {
        sendJson(response, 200, item);
        return true;
      }
      return false;
    }

    if (method === 'POST' && path === '/api/plans/file') {
      const result = await acceptFile(database, workspace, request, config);
      logger.info('plan document accepted', { requestId, workspaceId: workspace.id, ...result });
      sendJson(response, 202, result, { location: `/api/documents/${result.documentId}` });
      return true;
    }
    if (method === 'GET' && path === '/api/plans') {
      const items = listPlans(database, workspace.id, planFilters(url))
        .filter((item) => planVisible(item, allowedPersonalIds));
      sendJson(response, 200, { items });
      return true;
    }
    if (method === 'GET' && path === '/api/plans/calendar-sources') {
      const sourceByPlan = new Map(listPlans(database, workspace.id, { limit: 1000 }).map((item) => [item.id, item]));
      const items = listPlanCalendarSources(database, workspace.id, integerParam(url.searchParams.get('limit'), 3000, 10000))
        .filter((item) => planVisible(sourceByPlan.get(item.plan_id), allowedPersonalIds));
      sendJson(response, 200, { items });
      return true;
    }
    const planMatch = path.match(/^\/api\/plans\/([^/]+)$/);
    if (method === 'GET' && planMatch) {
      const item = getPlan(database, workspace.id, decodeURIComponent(planMatch[1]));
      if (!item) throw new AppError('plan_not_found', 'План не найден.', 404);
      if (!planVisible(item, allowedPersonalIds)) throw new AppError('plan_forbidden', 'Нет доступа к этому личному плану.', 403);
      sendJson(response, 200, item);
      return true;
    }

    if (method === 'POST' && path === '/api/plan-templates/file') {
      const result = await acceptFile(database, workspace, request, config, { templateOnly: true });
      logger.info('plan template document accepted', { requestId, workspaceId: workspace.id, ...result });
      sendJson(response, 202, result, { location: `/api/documents/${result.documentId}` });
      return true;
    }
    if (method === 'GET' && path === '/api/plan-templates') {
      sendJson(response, 200, { items: listPlanTemplates(database, workspace.id) });
      return true;
    }
    if (method === 'POST' && path === '/api/plan-templates/analyze') {
      const body = await readJson(request);
      if (!body.documentId) throw new AppError('document_id_required', 'Выберите DOCX-шаблон.', 400);
      try { sendJson(response, 200, analyzePlanTemplate(database, workspace.id, body.documentId)); }
      catch (error) { throw planError(error); }
      return true;
    }
    if (method === 'POST' && path === '/api/plan-templates') {
      const body = await readJson(request);
      try {
        const item = database.transaction(() => savePlanTemplate(database, workspace.id, body));
        sendJson(response, 201, item);
      } catch (error) { throw planError(error); }
      return true;
    }
    const generationMatch = path.match(/^\/api\/plan-templates\/([^/]+)\/generate$/);
    if (method === 'POST' && generationMatch) {
      const body = await readJson(request);
      if (body.ownerPersonId) assertPersonScope(database, workspace.id, request.auth, body.ownerPersonId);
      try {
        const result = await generatePlanFromTemplate(
          database, workspace.id, decodeURIComponent(generationMatch[1]), body, config
        );
        sendJson(response, 202, result, { location: `/api/documents/${result.documentId}` });
      } catch (error) { throw planError(error); }
      return true;
    }
    const templateMatch = path.match(/^\/api\/plan-templates\/([^/]+)$/);
    if (method === 'GET' && templateMatch) {
      const item = getPlanTemplate(database, workspace.id, decodeURIComponent(templateMatch[1]));
      if (!item) throw new AppError('plan_template_not_found', 'Шаблон плана не найден.', 404);
      sendJson(response, 200, item);
      return true;
    }
    return false;
  };
}
