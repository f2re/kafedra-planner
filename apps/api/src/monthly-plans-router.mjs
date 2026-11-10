import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  addMonthlyPlanItems, createMonthlyPlan, getMonthlyPlan, listMonthlyPlans, listPlanEvents,
  removeMonthlyPlanItem, updateMonthlyPlan, updateMonthlyPlanItem
} from '../../../packages/plans/src/monthly.mjs';
import { generateMonthlyPlanDocument } from '../../../packages/plan-docx/src/monthly-export.mjs';
import { readJson, sendJson } from './http-utils.mjs';

async function readFields(request) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('monthly_plan_input_invalid', 'Передайте поля месячного плана.', 400);
  }
  return body;
}

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get('SELECT id FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (workspace) return workspace;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

export function createMonthlyPlansRouter({ database, config }) {
  return async function routeMonthlyPlans(request, response, url) {
    const path = url.pathname;
    if (path !== '/api/plan-events' && !path.startsWith('/api/monthly-plans')) return false;
    const method = request.method || 'GET';
    const workspace = workspaceOf(database, request);
    const context = request.auth;
    if (method === 'GET' && path === '/api/plan-events') {
      return sendJson(response, 200, listPlanEvents(database, workspace.id, context, Object.fromEntries(url.searchParams)));
    }
    if (path === '/api/monthly-plans' && method === 'GET') {
      return sendJson(response, 200, { items: listMonthlyPlans(database, workspace.id, context, Object.fromEntries(url.searchParams)) });
    }
    if (path === '/api/monthly-plans' && method === 'POST') {
      const body = await readFields(request);
      if (!body.idempotencyKey && typeof request.headers['idempotency-key'] === 'string') body.idempotencyKey = request.headers['idempotency-key'];
      const draft = createMonthlyPlan(database, workspace.id, body, context);
      return sendJson(response, draft.duplicateRequest ? 200 : 201, draft, { location: `/api/monthly-plans/${draft.id}` });
    }
    const exportMatch = path.match(/^\/api\/monthly-plans\/([^/]+)\/export$/u);
    if (exportMatch && method === 'POST') {
      const body = await readFields(request);
      if (!body.idempotencyKey && typeof request.headers['idempotency-key'] === 'string') body.idempotencyKey = request.headers['idempotency-key'];
      return sendJson(response, 200, await generateMonthlyPlanDocument(
        database, workspace.id, decodeURIComponent(exportMatch[1]), body, config, context
      ));
    }
    const itemsMatch = path.match(/^\/api\/monthly-plans\/([^/]+)\/items$/u);
    if (itemsMatch && method === 'POST') {
      return sendJson(response, 200, addMonthlyPlanItems(
        database, workspace.id, decodeURIComponent(itemsMatch[1]), await readFields(request), context
      ));
    }
    const itemMatch = path.match(/^\/api\/monthly-plans\/([^/]+)\/items\/([^/]+)$/u);
    if (itemMatch && method === 'PATCH') {
      return sendJson(response, 200, updateMonthlyPlanItem(
        database, workspace.id, decodeURIComponent(itemMatch[1]), decodeURIComponent(itemMatch[2]), await readFields(request), context
      ));
    }
    if (itemMatch && method === 'DELETE') {
      return sendJson(response, 200, removeMonthlyPlanItem(
        database, workspace.id, decodeURIComponent(itemMatch[1]), decodeURIComponent(itemMatch[2]),
        { expectedRevision: url.searchParams.get('expectedRevision') }, context
      ));
    }
    const draftMatch = path.match(/^\/api\/monthly-plans\/([^/]+)$/u);
    if (draftMatch && method === 'GET') {
      return sendJson(response, 200, getMonthlyPlan(database, workspace.id, decodeURIComponent(draftMatch[1]), context));
    }
    if (draftMatch && method === 'PATCH') {
      return sendJson(response, 200, updateMonthlyPlan(database, workspace.id, decodeURIComponent(draftMatch[1]), await readFields(request), context));
    }
    return false;
  };
}
