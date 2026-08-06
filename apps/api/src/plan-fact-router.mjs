import { AppError } from '../../../packages/core/src/errors.mjs';
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

function sendDownload(response, body, {
  contentType,
  fileName
}) {
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

    if (method === 'GET' && path === '/api/plan-fact') {
      sendJson(response, 200, listCorrectedPlanFact(database, workspace.id, filters(url)));
      return true;
    }
    if (method === 'POST' && path === '/api/plan-fact/rebuild') {
      sendJson(response, 200, rebuildPlanFact(database, workspace.id));
      return true;
    }
    if (method === 'GET' && path === '/api/plan-fact/export.csv') {
      sendDownload(response, planFactExportCsv(database, workspace.id, filters(url)), {
        contentType: 'text/csv; charset=utf-8',
        fileName: 'plan-fakt.csv'
      });
      return true;
    }
    if (method === 'GET' && path === '/api/plan-fact/export.json') {
      sendDownload(response, planFactExportJson(database, workspace.id, filters(url)), {
        contentType: 'application/json; charset=utf-8',
        fileName: 'plan-fakt.json'
      });
      return true;
    }
    if (method === 'GET' && path === '/api/plan-fact/views') {
      const personId = url.searchParams.get('personId') || null;
      sendJson(response, 200, listPlanFactViews(database, workspace.id, personId));
      return true;
    }
    if (method === 'POST' && path === '/api/plan-fact/views') {
      const body = await readJson(request);
      sendJson(response, 201, savePlanFactView(database, workspace.id, body));
      return true;
    }
    if (method === 'POST' && viewMatch) {
      touchPlanFactView(database, workspace.id, decodeURIComponent(viewMatch[1]));
      sendJson(response, 200, { status: 'used' });
      return true;
    }
    if (method === 'DELETE' && viewMatch) {
      const personId = url.searchParams.get('personId') || null;
      deletePlanFactView(database, workspace.id, decodeURIComponent(viewMatch[1]), personId);
      sendJson(response, 200, { status: 'deleted' });
      return true;
    }
    if (method === 'GET' && assignmentMatch) {
      const item = getCorrectedAssignmentPlanFact(
        database,
        workspace.id,
        decodeURIComponent(assignmentMatch[1])
      );
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      sendJson(response, 200, item);
      return true;
    }
    if (method === 'GET' && correctionCollectionMatch) {
      const assignmentId = decodeURIComponent(correctionCollectionMatch[1]);
      const item = getCorrectedAssignmentPlanFact(database, workspace.id, assignmentId);
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      sendJson(response, 200, { items: listMetricCorrections(database, workspace.id, assignmentId) });
      return true;
    }
    if (method === 'POST' && correctionCollectionMatch) {
      const assignmentId = decodeURIComponent(correctionCollectionMatch[1]);
      const body = await readJson(request);
      sendJson(response, 201, createMetricCorrection(
        database,
        workspace.id,
        assignmentId,
        body
      ));
      return true;
    }
    if (method === 'POST' && correctionRevertMatch) {
      const body = await readJson(request);
      sendJson(response, 200, revertMetricCorrection(
        database,
        workspace.id,
        decodeURIComponent(correctionRevertMatch[1]),
        body
      ));
      return true;
    }
    if (method === 'GET' && path === '/api/personal-notifications') {
      const personId = url.searchParams.get('personId');
      if (!personId) throw new AppError('person_id_required', 'Выберите сотрудника.', 400);
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
      if (!body.personId || !body.key || !['read', 'dismiss'].includes(body.action)) {
        throw new AppError('personal_notification_state_invalid', 'Укажите сотрудника, уведомление и действие.', 400);
      }
      if (!setPersonalNotificationState(database, workspace.id, body.personId, body.key, body.action)) {
        throw new AppError('person_or_notification_not_found', 'Сотрудник или уведомление не найдены.', 404);
      }
      sendJson(response, 200, { status: body.action === 'dismiss' ? 'dismissed' : 'read' });
      return true;
    }
    throw new AppError('method_not_allowed', 'Метод не поддерживается для этого маршрута.', 405);
  };
}
