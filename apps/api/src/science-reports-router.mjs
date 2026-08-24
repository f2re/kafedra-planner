import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import {
  generateScienceReport, getScienceReportRun, listScienceReportRuns, scienceReportData
} from '../../../packages/science-reports/src/service.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function requireReportRole(context) {
  if (!context?.enabled) return;
  if (!['admin','manager'].includes(context.role)) {
    throw new AppError('science_report_access_forbidden', 'Научный отчёт по подразделению формирует руководитель или администратор.', 403);
  }
}

function mapped(error) {
  if (error instanceof AppError) return error;
  const code = String(error?.code || error?.message || error);
  const messages = {
    science_report_fields_required: ['Выберите хотя бы одно поле отчёта.', 400],
    science_report_format_invalid: ['Выберите CSV или DOCX.', 400],
    science_report_idempotency_required: ['Не удалось определить ключ безопасного повтора отчёта.', 400],
    science_report_idempotency_conflict: ['Параметры повторного отчёта отличаются от исходных.', 409],
    science_report_template_not_found: ['DOCX-образец не найден.', 404],
    science_report_template_not_docx: ['Для образца нужен файл DOCX.', 400],
    science_report_template_placeholder_missing: ['В образце нет поля {{SCIENCE_TABLE}}.', 400],
    science_report_template_placeholder_invalid: ['Поле {{SCIENCE_TABLE}} должно находиться в отдельном абзаце.', 400]
  };
  const [message, status] = messages[code] || ['Не удалось сформировать научный отчёт.', 500];
  return new AppError(code, message, status, error?.details);
}

function filtersFromQuery(params) {
  return {
    lifecycleStatus: params.get('status') || null,
    unitId: params.get('unitId') || null,
    personId: params.get('personId') || null,
    yearFrom: params.get('yearFrom') || null,
    yearTo: params.get('yearTo') || null,
    kind: params.get('kind') || null,
    classification: params.get('classification') || null
  };
}

export function createScienceReportsRouter({ database, config }) {
  return async function routeScienceReports(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/science-reports')) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const context = request.auth || { enabled: false };
    requireReportRole(context);
    const actorPersonId = context.personId || null;
    const method = request.method || 'GET';
    try {
      if (path === '/api/science-reports/preview' && method === 'GET') {
        const fields = url.searchParams.getAll('field');
        return sendJson(response, 200, scienceReportData(database, workspace, filtersFromQuery(url.searchParams), fields.length ? fields : undefined));
      }
      if (path === '/api/science-reports' && method === 'GET') {
        return sendJson(response, 200, { items: listScienceReportRuns(database, workspace, url.searchParams.get('limit') || 100) });
      }
      if (path === '/api/science-reports' && method === 'POST') {
        const body = await readJson(request);
        if (body.templateDocumentId) assertObjectAccess(database, workspace, context, 'document', body.templateDocumentId, 'read');
        const result = await generateScienceReport(database, workspace, body, config, actorPersonId);
        return sendJson(response, result.duplicateRequest ? 200 : 201, result, {
          location: result.generated_document_id ? `/api/documents/${result.generated_document_id}` : undefined
        });
      }
      const match = path.match(/^\/api\/science-reports\/([^/]+)$/u);
      if (match && method === 'GET') {
        const run = getScienceReportRun(database, workspace, decodeURIComponent(match[1]));
        if (!run) throw new AppError('science_report_not_found', 'Научный отчёт не найден.', 404);
        if (run.generated_document_id) assertObjectAccess(database, workspace, context, 'document', run.generated_document_id, 'read');
        return sendJson(response, 200, run);
      }
      return false;
    } catch (error) {
      throw mapped(error);
    }
  };
}
