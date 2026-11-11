import { AppError } from '../../../packages/core/src/errors.mjs';
import { suggestPlanEvents, getPlanSelectionRun, applyPlanSelection } from '../../../packages/plans/src/selection.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const row = database.get('SELECT id FROM workspaces WHERE id=?', request.auth.workspaceId);
    if (row) return row.id;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const row = database.get('SELECT id FROM workspaces WHERE id=? OR code=?', requested, requested);
    if (row) return row.id;
  }
  const row = database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1');
  if (!row) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return row.id;
}

export function createPlanSelectionRouter({ database, config }) {
  return async function routePlanSelection(request, response, url) {
    const path = url.pathname, method = request.method || 'GET';
    const apply = path.match(/^\/api\/monthly-plans\/([^/]+)\/apply-suggestion$/u);
    const detail = path.match(/^\/api\/plan-events\/suggestions\/([^/]+)$/u);
    if (path !== '/api/plan-events/suggest' && !apply && !detail) return false;
    const workspaceId = workspaceOf(database, request);
    if (path === '/api/plan-events/suggest' && method === 'POST') {
      const input = await readJson(request);
      if (input && !input.idempotencyKey && typeof request.headers['idempotency-key'] === 'string') input.idempotencyKey = request.headers['idempotency-key'];
      const controller = new AbortController();
      const stop = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', stop);
      try {
        const result = await suggestPlanEvents(database, workspaceId, input, request.auth, config, { signal: controller.signal });
        return sendJson(response, 200, result);
      } finally { response.off('close', stop); }
    }
    if (detail && method === 'GET') return sendJson(response, 200,
      getPlanSelectionRun(database, workspaceId, decodeURIComponent(detail[1]), request.auth));
    if (apply && method === 'POST') return sendJson(response, 200,
      applyPlanSelection(database, workspaceId, decodeURIComponent(apply[1]), await readJson(request), request.auth));
    return false;
  };
}
