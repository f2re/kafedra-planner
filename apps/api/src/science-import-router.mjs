import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import {
  analyzeScienceImport, getScienceImportRun, importScienceRows, listScienceImportRuns
} from '../../../packages/science-import/src/service.mjs';
import { copyScienceImportAccess } from '../../../packages/science-import/src/access.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function mapped(error) {
  if (error instanceof AppError) return error;
  const code = String(error?.code || error?.message || error);
  const messages = {
    science_import_document_not_found: ['Файл для импорта не найден.', 404],
    science_import_document_not_ready: ['Дождитесь завершения обработки файла.', 409],
    science_import_mapping_title_required: ['Укажите колонку с названием научного материала.', 400],
    science_import_idempotency_required: ['Не удалось определить ключ безопасного повтора импорта.', 400],
    science_import_idempotency_conflict: ['Параметры повторного импорта отличаются от исходных.', 409],
    science_import_title_required: ['В строке не указано название.', 400],
    science_import_date_invalid: ['В строке указана некорректная дата.', 400],
    science_import_year_invalid: ['В строке указан некорректный год.', 400]
  };
  const [message, status] = messages[code] || ['Не удалось выполнить массовый импорт.', 500];
  return new AppError(code, message, status, error?.details);
}

function sourceDocumentId(database, workspaceId, body) {
  if (body.documentId) return body.documentId;
  if (!body.runId) return null;
  return database.get(`
    SELECT d.id FROM science_import_runs sir
    JOIN document_versions dv ON dv.id = sir.source_document_version_id
    JOIN documents d ON d.id = dv.document_id
    WHERE sir.workspace_id = ? AND sir.id = ?
  `, workspaceId, body.runId)?.id || null;
}

export function createScienceImportRouter({ database }) {
  return async function routeScienceImport(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/science-imports')) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const context = request.auth || { enabled: false };
    const actorPersonId = context.personId || null;
    const method = request.method || 'GET';
    try {
      if (path === '/api/science-imports' && method === 'GET') {
        return sendJson(response, 200, { items: listScienceImportRuns(database, workspace, url.searchParams.get('limit') || 100) });
      }
      if (path === '/api/science-imports/analyze' && method === 'POST') {
        const body = await readJson(request);
        assertObjectAccess(database, workspace, context, 'document', body.documentId, 'read');
        return sendJson(response, 200, await analyzeScienceImport(database, workspace, body.documentId));
      }
      if (path === '/api/science-imports' && method === 'POST') {
        const body = await readJson(request);
        assertObjectAccess(database, workspace, context, 'document', body.documentId, 'read');
        const result = await importScienceRows(database, workspace, body, actorPersonId);
        copyScienceImportAccess(database, workspace, body.documentId,
          result.rows.map((row) => row.scientific_item_id), actorPersonId);
        return sendJson(response, result.error_rows || result.review_rows ? 207 : 201, result, {
          location: `/api/science-imports/${result.id}`
        });
      }
      const runMatch = path.match(/^\/api\/science-imports\/([^/]+)$/u);
      if (runMatch && method === 'GET') {
        const run = getScienceImportRun(database, workspace, decodeURIComponent(runMatch[1]));
        if (!run) throw new AppError('science_import_not_found', 'Импорт не найден.', 404);
        if (run.source_document_id) assertObjectAccess(database, workspace, context, 'document', run.source_document_id, 'read');
        return sendJson(response, 200, run);
      }
      return false;
    } catch (error) {
      throw mapped(error);
    }
  };
}
