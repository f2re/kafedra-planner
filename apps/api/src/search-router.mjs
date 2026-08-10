import { AppError } from '../../../packages/core/src/errors.mjs';
import { canReadSearchResult } from '../../../packages/access-control/src/service.mjs';
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

export function createSearchRouter({ database }) {
  return async function routeSearch(request, response, url) {
    if ((request.method || 'GET') !== 'GET' || url.pathname !== '/api/search') return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const limit = integerParam(url.searchParams.get('limit'), 80, 300);
    const payload = searchFaceted(database, workspace, filters(url), Math.min(3000, limit * 12));
    const context = request.auth || { enabled: false };
    const accessible = context.enabled
      ? payload.items.filter((item) => canReadSearchResult(database, workspace, context, item))
      : payload.items;
    const items = accessible.slice(0, limit);
    return sendJson(response, 200, {
      query: payload.query,
      items,
      facets: buildSearchFacets(accessible),
      total: accessible.length
    });
  };
}
