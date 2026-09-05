import { AppError } from '../../../packages/core/src/errors.mjs';
import { canReadSearchResult } from '../../../packages/access-control/src/service.mjs';
import { resolvePlanAccess, resolvePlanItemAccess } from '../../../packages/plans/src/access.mjs';
import { buildSearchFacets, searchFaceted } from '../../../packages/storage/src/faceted-search.mjs';
import { sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function integerParam(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

function filters(url) {
  return {
    q: url.searchParams.get('q') || '',
    sourceKind: url.searchParams.get('sourceKind') || '',
    kind: url.searchParams.get('kind') || '',
    number: url.searchParams.get('number') || '',
    from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '',
    direction: url.searchParams.get('direction') || '',
    person: url.searchParams.get('person') || '',
    role: url.searchParams.get('role') || '',
    status: url.searchParams.get('status') || '',
    period: url.searchParams.get('period') || '',
    report: url.searchParams.get('report') || ''
  };
}

function canReadResult(database, workspace, context, item) {
  if (item.source_kind === 'plan') {
    return resolvePlanAccess(database, workspace, context, item.source_id, 'read').allowed;
  }
  if (item.source_kind === 'plan_item') {
    return resolvePlanItemAccess(database, workspace, context, item.source_id, 'read').allowed;
  }
  return canReadSearchResult(database, workspace, context, item);
}

export function routeForSearchResult(database, workspace, item) {
  if (!item?.source_kind || !item?.source_id) return null;
  switch (item.source_kind) {
    case 'document':
      return { kind: 'document', id: item.source_id };
    case 'meeting':
      return { kind: 'meeting', id: item.source_id };
    case 'assignment':
      return { kind: 'assignment', id: item.source_id };
    case 'periodic_task':
      return { kind: 'periodic_task', id: item.source_id };
    case 'plan':
      return { kind: 'plan', id: item.source_id };
    case 'plan_item': {
      const parent = database.get(`
        SELECT p.id
        FROM plan_items pi
        JOIN plans p ON p.id = pi.plan_id
        WHERE p.workspace_id = ? AND pi.id = ?
      `, workspace, item.source_id);
      return parent ? { kind: 'plan', id: parent.id } : null;
    }
    case 'decision': {
      const parent = database.get(`
        SELECT m.id
        FROM decisions d
        JOIN agenda_items ai ON ai.id = d.agenda_item_id
        JOIN meetings m ON m.id = ai.meeting_id
        WHERE m.workspace_id = ? AND d.id = ?
      `, workspace, item.source_id);
      return parent ? { kind: 'meeting', id: parent.id } : null;
    }
    case 'directive':
      return { kind: 'directive', id: item.source_id };
    case 'scientific_item':
      return { kind: 'science', id: item.source_id };
    case 'template_extraction':
      return item.source_document_id ? { kind: 'document', id: item.source_document_id } : null;
    default:
      return item.source_document_id ? { kind: 'document', id: item.source_document_id } : null;
  }
}

export function createSearchRouter({ database }) {
  return async function routeSearch(request, response, url) {
    if ((request.method || 'GET') !== 'GET' || url.pathname !== '/api/search') return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const limit = integerParam(url.searchParams.get('limit'), 80, 300);
    const payload = searchFaceted(database, workspace, filters(url), Math.min(3000, limit * 12));
    const context = request.auth || { enabled: false };
    const accessible = context.enabled
      ? payload.items.filter((item) => canReadResult(database, workspace, context, item))
      : payload.items;
    const items = accessible.slice(0, limit).map((item) => ({
      ...item,
      route: routeForSearchResult(database, workspace, item)
    }));
    return sendJson(response, 200, {
      query: payload.query,
      items,
      facets: buildSearchFacets(accessible),
      total: accessible.length
    });
  };
}
