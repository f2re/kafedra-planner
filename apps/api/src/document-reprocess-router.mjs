import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { requestDocumentReprocess } from '../../../packages/storage/src/documents.mjs';
import { sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

export function createDocumentReprocessRouter({ database }) {
  return async function documentReprocessRouter(request, response, url) {
    if (request.method !== 'POST') return false;
    const match = url.pathname.match(/^\/api\/documents\/([^/]+)\/reprocess$/u);
    if (!match) return false;

    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_found', 'Рабочая область не найдена.', 404);
    const documentId = decodeURIComponent(match[1]);
    if (request.auth?.enabled) {
      assertObjectAccess(database, workspace, request.auth, 'document', documentId, 'edit');
    }
    const result = requestDocumentReprocess(database, { workspaceId: workspace, documentId });
    if (!result) throw new AppError('document_not_found', 'Документ не найден.', 404);
    sendJson(response, result.duplicateRequest ? 200 : 202, result);
    return true;
  };
}
