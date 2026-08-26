import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess, resolveObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { assertPlanAccess, resolvePlanAccess } from '../../../packages/plans/src/access.mjs';
import { getPlan, listPlans } from '../../../packages/plans/src/service.mjs';
import { getDocument } from '../../../packages/storage/src/documents.mjs';
import {
  archiveDocument,
  archivePlan,
  documentImpact,
  planImpact,
  restoreDocument,
  restorePlan,
  updateDocumentMetadata,
  updatePlanMetadata
} from '../../../packages/lifecycle/src/service.mjs';
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

function planFilters(url, limit, status) {
  return {
    q: url.searchParams.get('q') || '',
    kind: url.searchParams.get('kind') || '',
    periodKind: url.searchParams.get('periodKind') || '',
    periodKey: url.searchParams.get('periodKey') || '',
    ownerPersonId: url.searchParams.get('ownerPersonId') || '',
    responsible: url.searchParams.get('responsible') || '',
    direction: url.searchParams.get('direction') || '',
    status,
    limit
  };
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

function documentLifecycle(value) {
  return ['active', 'archived', 'all'].includes(value) ? value : 'active';
}

function planLifecycle(value) {
  return ['active', 'archived', 'all'].includes(value) ? value : 'active';
}

function listDocuments(database, workspaceId, { lifecycle = 'active', q = '', limit = 100 } = {}) {
  const clauses = ['d.workspace_id = ?'];
  const params = [workspaceId];
  if (lifecycle !== 'all') {
    clauses.push("COALESCE(d.lifecycle_status, 'active') = ?");
    params.push(lifecycle);
  }
  if (q) {
    clauses.push('(d.title LIKE ? OR dv.original_name LIKE ? OR d.document_type LIKE ?)');
    const search = `%${q}%`;
    params.push(search, search, search);
  }
  params.push(limit);
  return database.all(`
    SELECT
      d.id, d.title, d.document_type, d.status, d.lifecycle_status,
      d.archived_at, d.archive_reason, d.replacement_document_id,
      replacement.title AS replacement_title,
      d.created_at, d.updated_at,
      dv.id AS version_id, dv.original_name, dv.media_type, dv.detected_format,
      dv.processing_status, dv.extraction_error, dv.structure_status,
      dv.ocr_status, dv.ocr_engine, dv.ocr_languages, dv.ocr_confidence, dv.ocr_error,
      dv.preview_status, dv.preview_media_type, dv.preview_error,
      fb.size_bytes, fb.sha256
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    LEFT JOIN documents replacement ON replacement.id = d.replacement_document_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY d.updated_at DESC
    LIMIT ?
  `, ...params);
}

function enrichDocument(database, workspaceId, document) {
  if (!document) return null;
  const replacement = document.replacement_document_id
    ? database.get(`
        SELECT id, title, document_type, lifecycle_status
        FROM documents WHERE workspace_id = ? AND id = ?
      `, workspaceId, document.replacement_document_id)
    : null;
  return { ...document, lifecycle_status: document.lifecycle_status || 'active', replacement };
}

function enrichPlan(database, workspaceId, plan) {
  if (!plan) return null;
  const replacement = plan.replacement_plan_id
    ? database.get(`
        SELECT id, title, plan_kind, period_key, status
        FROM plans WHERE workspace_id = ? AND id = ?
      `, workspaceId, plan.replacement_plan_id)
    : null;
  return {
    ...plan,
    lifecycle_status: plan.status === 'archived' ? 'archived' : 'active',
    replacement
  };
}

export function createLifecycleRouter({ database }) {
  return async function routeLifecycle(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const workspace = workspaceOf(database, request);
    const context = request.auth;
    const actorPersonId = context?.personId || null;

    if (method === 'GET' && path === '/api/documents') {
      const lifecycle = documentLifecycle(url.searchParams.get('lifecycle') || 'active');
      const limit = integerParam(url.searchParams.get('limit'), 100, 1000);
      const candidates = listDocuments(database, workspace.id, {
        lifecycle,
        q: String(url.searchParams.get('q') || '').trim(),
        limit: Math.min(4000, limit * 4)
      });
      const items = candidates.filter((item) =>
        resolveObjectAccess(database, workspace.id, context, 'document', item.id, 'read').allowed
      ).slice(0, limit);
      return sendJson(response, 200, { items, lifecycle });
    }

    const documentImpactMatch = path.match(/^\/api\/documents\/([^/]+)\/impact$/u);
    if (method === 'GET' && documentImpactMatch) {
      const documentId = decodeURIComponent(documentImpactMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'document', documentId, 'edit');
      return sendJson(response, 200, documentImpact(database, workspace.id, documentId));
    }

    const documentArchiveMatch = path.match(/^\/api\/documents\/([^/]+)\/archive$/u);
    if (method === 'POST' && documentArchiveMatch) {
      const documentId = decodeURIComponent(documentArchiveMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'document', documentId, 'edit');
      const body = await readJson(request);
      if (body.replacementDocumentId) {
        assertObjectAccess(database, workspace.id, context, 'document', body.replacementDocumentId, 'read');
      }
      return sendJson(response, 200, enrichDocument(database, workspace.id,
        archiveDocument(database, workspace.id, documentId, body, actorPersonId)));
    }

    const documentRestoreMatch = path.match(/^\/api\/documents\/([^/]+)\/restore$/u);
    if (method === 'POST' && documentRestoreMatch) {
      const documentId = decodeURIComponent(documentRestoreMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'document', documentId, 'edit');
      return sendJson(response, 200, enrichDocument(database, workspace.id,
        restoreDocument(database, workspace.id, documentId, actorPersonId)));
    }

    const documentMatch = path.match(/^\/api\/documents\/([^/]+)$/u);
    if (documentMatch && ['GET', 'PATCH'].includes(method)) {
      const documentId = decodeURIComponent(documentMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'document', documentId, method === 'GET' ? 'read' : 'edit');
      if (method === 'PATCH') {
        updateDocumentMetadata(database, workspace.id, documentId, await readJson(request), actorPersonId);
      }
      const document = getDocument(database, workspace.id, documentId);
      if (!document) throw new AppError('document_not_found', 'Документ не найден.', 404);
      return sendJson(response, 200, enrichDocument(database, workspace.id, document));
    }

    if (method === 'GET' && path === '/api/plans') {
      const lifecycle = planLifecycle(url.searchParams.get('status') || 'active');
      const limit = integerParam(url.searchParams.get('limit'), 300, 1000);
      const status = lifecycle === 'all' ? '' : lifecycle;
      const candidates = listPlans(database, workspace.id, planFilters(url, Math.min(3000, limit * 6), status));
      const readable = candidates.filter((item) =>
        resolvePlanAccess(database, workspace.id, context, item.id, 'read').allowed
      );
      const items = readable.slice(0, limit).map((item) => enrichPlan(database, workspace.id, item));
      return sendJson(response, 200, {
        items,
        lifecycle,
        facets: {
          kinds: facetValues(readable, 'plan_kind'),
          periods: facetValues(readable, 'period_key'),
          directions: facetValues(readable, 'directions')
        }
      });
    }

    const planImpactMatch = path.match(/^\/api\/plans\/([^/]+)\/impact$/u);
    if (method === 'GET' && planImpactMatch) {
      const planId = decodeURIComponent(planImpactMatch[1]);
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      return sendJson(response, 200, planImpact(database, workspace.id, planId));
    }

    const planArchiveMatch = path.match(/^\/api\/plans\/([^/]+)\/archive$/u);
    if (method === 'POST' && planArchiveMatch) {
      const planId = decodeURIComponent(planArchiveMatch[1]);
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      const body = await readJson(request);
      if (body.replacementPlanId) assertPlanAccess(database, workspace.id, context, body.replacementPlanId, 'read');
      return sendJson(response, 200, enrichPlan(database, workspace.id,
        archivePlan(database, workspace.id, planId, body, actorPersonId)));
    }

    const planRestoreMatch = path.match(/^\/api\/plans\/([^/]+)\/restore$/u);
    if (method === 'POST' && planRestoreMatch) {
      const planId = decodeURIComponent(planRestoreMatch[1]);
      assertPlanAccess(database, workspace.id, context, planId, 'edit');
      return sendJson(response, 200, enrichPlan(database, workspace.id,
        restorePlan(database, workspace.id, planId, actorPersonId)));
    }

    const planMatch = path.match(/^\/api\/plans\/([^/]+)$/u);
    if (planMatch && ['GET', 'PATCH'].includes(method)) {
      const planId = decodeURIComponent(planMatch[1]);
      assertPlanAccess(database, workspace.id, context, planId, method === 'GET' ? 'read' : 'edit');
      if (method === 'PATCH') {
        updatePlanMetadata(database, workspace.id, planId, await readJson(request), actorPersonId);
      }
      const plan = getPlan(database, workspace.id, planId);
      if (!plan) throw new AppError('plan_not_found', 'План не найден.', 404);
      return sendJson(response, 200, enrichPlan(database, workspace.id, plan));
    }

    return false;
  };
}
