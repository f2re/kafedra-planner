import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  getPlan, listPlans, planDocumentId, planItemAudience, planItemDocumentId
} from '../../../packages/plans/src/service.mjs';
import {
  getCalendarItem, listCalendarItems, listNotifications, listTasks
} from '../../../packages/calendar/src/service.mjs';
import {
  assertObjectAccess, canReadCalendarItem, resolveObjectAccess
} from '../../../packages/access-control/src/service.mjs';
import { assertPersonScope } from '../../../packages/auth/src/policy.mjs';
import { sendJson } from './http-utils.mjs';

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

export function createPlansRouter({ database }) {
  return async function routePlans(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const workspace = workspaceOf(database, request);
    const context = request.auth;

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
