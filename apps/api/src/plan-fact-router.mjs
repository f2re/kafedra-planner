import { AppError } from '../../../packages/core/src/errors.mjs';
import { auditAction } from '../../../packages/auth/src/service.mjs';
import {
  assertAssignmentScope,
  assertPersonScope,
  assertViewScope,
  requireAssignmentCorrection,
  requireSharedViewPermission,
  scopePlanFactFilters
} from '../../../packages/auth/src/policy.mjs';
import { rebuildPlanFact } from '../../../packages/plan-fact/src/service.mjs';
import {
  createMetricCorrection,
  getCorrectedAssignmentPlanFact,
  listCorrectedPlanFact,
  listMetricCorrections,
  revertMetricCorrection
} from '../../../packages/plan-fact/src/corrections.mjs';
import {
  deletePlanFactView,
  listPlanFactViews,
  savePlanFactView,
  touchPlanFactView
} from '../../../packages/plan-fact/src/views.mjs';
import {
  planFactExportCsv,
  planFactExportJson
} from '../../../packages/plan-fact/src/export.mjs';
import {
  listPersonalNotifications,
  setPersonalNotificationState
} from '../../../packages/plan-fact/src/notifications.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  const requested = request.auth?.enabled && request.auth.workspaceId
    ? request.auth.workspaceId
    : request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
    throw new AppError('workspace_not_found', 'Рабочее пространство не найдено.', 404);
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

function integerParam(value, fallback, max = 2000) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function filters(url) {
  return {
    from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '',
    direction: url.searchParams.get('direction') || '',
    status: url.searchParams.get('status') || '',
    ownerPersonId: url.searchParams.get('ownerPersonId') || '',
    managerPersonId: url.searchParams.get('managerPersonId') || '',
    periodKind: url.searchParams.get('periodKind') || '',
    periodKey: url.searchParams.get('periodKey') || '',
    limit: integerParam(url.searchParams.get('limit'), 500)
  };
}

function attachmentName(value) {
  return encodeURIComponent(value).replaceAll("'", '%27');
}

function sendDownload(response, body, { contentType, fileName }) {
  const payload = Buffer.from(body, 'utf8');
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': payload.length,
    'content-disposition': `attachment; filename*=UTF-8''${attachmentName(fileName)}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

function actorId(request, fallback = null) {
  return request.auth?.enabled ? request.auth.personId : fallback;
}

function audit(database, request, workspaceId, action, targetKind, targetId, details = {}) {
  if (!request.auth?.enabled) return;
  auditAction(database, {
    workspaceId,
    accountId: request.auth.accountId,
    personId: request.auth.personId,
    action,
    targetKind,
    targetId,
    details
  });
}

export function createPlanFactRouter({ database }) {
  return async function routePlanFact(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const assignmentMatch = path.match(/^\/api\/assignments\/([^/]+)\/plan-fact$/);
    const correctionCollectionMatch = path.match(/^\/api\/assignments\/([^/]+)\/plan-fact\/corrections$/);
    const correctionRevertMatch = path.match(/^\/api\/plan-fact\/corrections\/([^/]+)\/revert$/);
    const viewMatch = path.match(/^\/api\/plan-fact\/views\/([^/]+)$/);
    const recognized = path === '/api/plan-fact'
      || path === '/api/plan-fact/rebuild'
      || path === '/api/plan-fact/export.csv'
      || path === '/api/plan-fact/export.json'
      || path === '/api/plan-fact/views'
      || path === '/api/personal-notifications'
      || path === '/api/personal-notifications/state'
      || Boolean(assignmentMatch || correctionCollectionMatch || correctionRevertMatch || viewMatch);
    if (!recognized) return false;

    const workspace = workspaceOf(database, request);
    const scopedFilters = () => scopePlanFactFilters(database, workspace.id, request.auth, filters(url));

    if (method === 'GET' && path === '/api/plan-fact') {
      sendJson(response, 200, listCorrectedPlanFact(database, workspace.id, scopedFilters()));
      return true;
    }
    if (method === 'POST' && path === '/api/plan-fact/rebuild') {
      if (request.auth?.enabled && request.auth.role !== 'admin') {
        throw new AppError('forbidden', 'Полный пересчёт доступен только администратору.', 403);
      }
      sendJson(response, 200, rebuildPlanFact(database, workspace.id));
      return true;
    }
    if (method === 'GET' && path === '/api/plan-fact/export.csv') {
      sendDownload(response, planFactExportCsv(database, workspace.id, scopedFilters()), {
        contentType: 'text/csv; charset=utf-8',
        fileName: 'plan-fakt.csv'
      });
      return true;
    }
    if (method === 'GET' && path === '/api/plan-fact/export.json') {
      sendDownload(response, planFactExportJson(database, workspace.id, scopedFilters()), {
        contentType: 'application/json; charset=utf-8',
        fileName: 'plan-fakt.json'
      });
      return true;
    }
    if (method === 'GET' && path === '/api/plan-fact/views') {
      const personId = request.auth?.enabled
        ? request.auth.personId
        : url.searchParams.get('personId') || null;
      sendJson(response, 200, listPlanFactViews(database, workspace.id, personId));
      return true;
    }
    if (method === 'POST' && path === '/api/plan-fact/views') {
      const body = await readJson(request);
      if (request.auth?.enabled && body.isShared) requireSharedViewPermission(request.auth);
      const ownerPersonId = actorId(request, body.ownerPersonId || null);
      const item = savePlanFactView(database, workspace.id, {
        ...body,
        ownerPersonId,
        createdByPersonId: actorId(request, body.createdByPersonId || ownerPersonId)
      });
      audit(database, request, workspace.id, 'plan_fact.view_saved', 'plan_fact_view', item.id, {
        shared: item.isShared
      });
      sendJson(response, 201, item);
      return true;
    }
    if (method === 'POST' && viewMatch) {
      const viewId = decodeURIComponent(viewMatch[1]);
      if (request.auth?.enabled) assertViewScope(database, workspace.id, request.auth, viewId);
      touchPlanFactView(database, workspace.id, viewId);
      sendJson(response, 200, { status: 'used' });
      return true;
    }
    if (method === 'DELETE' && viewMatch) {
      const viewId = decodeURIComponent(viewMatch[1]);
      if (request.auth?.enabled) assertViewScope(database, workspace.id, request.auth, viewId, { deleteMode: true });
      const personId = request.auth?.enabled
        ? request.auth.role === 'admin' ? null : request.auth.personId
        : url.searchParams.get('personId') || null;
      deletePlanFactView(database, workspace.id, viewId, personId);
      audit(database, request, workspace.id, 'plan_fact.view_deleted', 'plan_fact_view', viewId);
      sendJson(response, 200, { status: 'deleted' });
      return true;
    }
    if (method === 'GET' && assignmentMatch) {
      const assignmentId = decodeURIComponent(assignmentMatch[1]);
      if (request.auth?.enabled) assertAssignmentScope(database, workspace.id, request.auth, assignmentId);
      const item = getCorrectedAssignmentPlanFact(database, workspace.id, assignmentId);
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      sendJson(response, 200, item);
      return true;
    }
    if (method === 'GET' && correctionCollectionMatch) {
      const assignmentId = decodeURIComponent(correctionCollectionMatch[1]);
      if (request.auth?.enabled) assertAssignmentScope(database, workspace.id, request.auth, assignmentId);
      const item = getCorrectedAssignmentPlanFact(database, workspace.id, assignmentId);
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      sendJson(response, 200, { items: listMetricCorrections(database, workspace.id, assignmentId) });
      return true;
    }
    if (method === 'POST' && correctionCollectionMatch) {
      const assignmentId = decodeURIComponent(correctionCollectionMatch[1]);
      if (request.auth?.enabled) requireAssignmentCorrection(database, workspace.id, request.auth, assignmentId);
      const body = await readJson(request);
      const result = createMetricCorrection(database, workspace.id, assignmentId, {
        ...body,
        actorPersonId: actorId(request, body.actorPersonId || null)
      });
      audit(database, request, workspace.id, 'plan_fact.correction_created', 'assignment', assignmentId, {
        correctionId: result.correction?.id,
        metricKey: body.metricKey,
        fieldKind: body.fieldKind
      });
      sendJson(response, 201, result);
      return true;
    }
    if (method === 'POST' && correctionRevertMatch) {
      const correctionId = decodeURIComponent(correctionRevertMatch[1]);
      const correction = database.get(`
        SELECT assignment_id FROM plan_fact_metric_corrections
        WHERE workspace_id = ? AND id = ?
      `, workspace.id, correctionId);
      if (!correction) throw new AppError('correction_not_found', 'Исправление не найдено.', 404);
      if (request.auth?.enabled) requireAssignmentCorrection(database, workspace.id, request.auth, correction.assignment_id);
      const body = await readJson(request);
      const result = revertMetricCorrection(database, workspace.id, correctionId, {
        ...body,
        actorPersonId: actorId(request, body.actorPersonId || null)
      });
      audit(database, request, workspace.id, 'plan_fact.correction_reverted', 'plan_fact_correction', correctionId, {
        assignmentId: correction.assignment_id
      });
      sendJson(response, 200, result);
      return true;
    }
    if (method === 'GET' && path === '/api/personal-notifications') {
      const personId = request.auth?.enabled
        ? url.searchParams.get('personId') || request.auth.personId
        : url.searchParams.get('personId');
      if (!personId) throw new AppError('person_id_required', 'Выберите сотрудника.', 400);
      if (request.auth?.enabled) assertPersonScope(database, workspace.id, request.auth, personId);
      const result = listPersonalNotifications(database, workspace.id, {
        personId,
        limit: integerParam(url.searchParams.get('limit'), 100, 500)
      });
      if (!result) throw new AppError('person_not_found', 'Сотрудник не найден.', 404);
      sendJson(response, 200, result);
      return true;
    }
    if (method === 'POST' && path === '/api/personal-notifications/state') {
      const body = await readJson(request);
      const personId = request.auth?.enabled ? request.auth.personId : body.personId;
      if (!personId || !body.key || !['read', 'dismiss'].includes(body.action)) {
        throw new AppError('personal_notification_state_invalid', 'Укажите сотрудника, уведомление и действие.', 400);
      }
      if (!setPersonalNotificationState(database, workspace.id, personId, body.key, body.action)) {
        throw new AppError('person_or_notification_not_found', 'Сотрудник или уведомление не найдены.', 404);
      }
      sendJson(response, 200, { status: body.action === 'dismiss' ? 'dismissed' : 'read' });
      return true;
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается для этого маршрута.', 405);
  };
}
