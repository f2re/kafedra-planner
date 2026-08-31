import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import {
  academicDisciplineDetails,
  academicHierarchy,
  analyzeAcademicPerformance,
  archiveAcademicImport,
  getAcademicImport,
  importAcademicPerformance,
  listAcademicImports,
  restoreAcademicImport
} from '../../../packages/academic-performance/src/service.mjs';
import {
  academicPeriodTotals,
  academicReportExport
} from '../../../packages/academic-performance/src/report.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function requireManager(context) {
  if (!context?.enabled) return;
  if (!['admin', 'manager'].includes(context.role)) {
    throw new AppError(
      'academic_access_forbidden',
      'Ведомости загружает руководитель или администратор.',
      403
    );
  }
}

function canReadRun(database, workspace, context, run) {
  if (!run?.source_document_id) return false;
  try {
    assertObjectAccess(database, workspace, context, 'document', run.source_document_id, 'read');
    return true;
  } catch {
    return false;
  }
}

function requireReadableRun(database, workspace, context, importId) {
  const run = getAcademicImport(database, workspace, importId);
  if (!run) throw new AppError('academic_import_not_found', 'Ведомость не найдена.', 404);
  assertObjectAccess(database, workspace, context, 'document', run.source_document_id, 'read');
  return run;
}

function filteredAccessibleRuns(database, workspace, context, url, { includeHistory = false } = {}) {
  return listAcademicImports(database, workspace, {
    includeHistory,
    academicYear: url.searchParams.get('academicYear') || null,
    semester: url.searchParams.get('semester') || null,
    groupCode: url.searchParams.get('groupCode') || null,
    limit: url.searchParams.get('limit') || 500
  }).filter((run) => canReadRun(database, workspace, context, run));
}


function requestedImportIds(url) {
  const values = [
    ...url.searchParams.getAll('importId'),
    ...(url.searchParams.get('importIds') || '').split(',')
  ];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function selectedAccessibleRuns(database, workspace, context, url) {
  const runs = filteredAccessibleRuns(database, workspace, context, url);
  const requested = requestedImportIds(url);
  if (!requested.length) return runs;
  const allowed = new Set(requested);
  return runs.filter((run) => allowed.has(run.id));
}

function safeFilePart(value, fallback) {
  return String(value || fallback)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || fallback;
}

function exportFilename(runs, extension) {
  if (runs.length === 1) {
    const run = runs[0];
    return `uspevaemost-${safeFilePart(run.academic_year.replace('/', '-'), 'period')}-${safeFilePart(run.group_code, 'group')}.${extension}`;
  }
  return `uspevaemost-svodnaya.${extension}`;
}

function sendExport(response, output, fileName) {
  response.writeHead(200, {
    'content-type': output.mediaType,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'content-length': Buffer.byteLength(output.body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(output.body);
}

export function createAcademicPerformanceRouter({ database }) {
  return async function routeAcademicPerformance(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/academic-performance')) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) {
      throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    }
    const context = request.auth || { enabled: false };
    const actorPersonId = context.personId || null;
    const method = request.method || 'GET';

    if (path === '/api/academic-performance' && method === 'GET') {
      const includeHistory = url.searchParams.get('includeHistory') === '1';
      const items = filteredAccessibleRuns(database, workspace, context, url, { includeHistory });
      const current = items.filter((run) => run.is_current && run.lifecycle_status === 'active');
      return sendJson(response, 200, {
        items,
        hierarchy: academicHierarchy(current)
      });
    }

    if (path === '/api/academic-performance/analyze' && method === 'POST') {
      requireManager(context);
      const body = await readJson(request);
      if (!body.documentId) {
        throw new AppError('academic_document_required', 'Выберите ведомость.', 400);
      }
      assertObjectAccess(database, workspace, context, 'document', body.documentId, 'read');
      return sendJson(
        response,
        200,
        await analyzeAcademicPerformance(database, workspace, body.documentId)
      );
    }

    if (path === '/api/academic-performance' && method === 'POST') {
      requireManager(context);
      const body = await readJson(request);
      if (!body.documentId) {
        throw new AppError('academic_document_required', 'Выберите ведомость.', 400);
      }
      assertObjectAccess(database, workspace, context, 'document', body.documentId, 'read');
      const result = await importAcademicPerformance(database, workspace, body, actorPersonId);
      return sendJson(
        response,
        result.processing_status === 'completed_with_review' ? 207 : 201,
        result,
        { location: `/api/academic-performance/${result.id}` }
      );
    }

    if (path === '/api/academic-performance/totals' && method === 'GET') {
      const runs = selectedAccessibleRuns(database, workspace, context, url);
      return sendJson(response, 200, academicPeriodTotals(database, workspace, {
        importIds: runs.map((run) => run.id)
      }));
    }

    if (path === '/api/academic-performance/export' && method === 'GET') {
      const runs = selectedAccessibleRuns(database, workspace, context, url);
      const format = url.searchParams.get('format') || 'csv';
      const output = academicReportExport(database, workspace, runs.map((run) => run.id), format);
      sendExport(response, output, exportFilename(runs, output.extension));
      return true;
    }

    const disciplineMatch = path.match(/^\/api\/academic-performance\/([^/]+)\/disciplines\/([^/]+)$/u);
    if (disciplineMatch && method === 'GET') {
      const importId = decodeURIComponent(disciplineMatch[1]);
      requireReadableRun(database, workspace, context, importId);
      return sendJson(
        response,
        200,
        academicDisciplineDetails(
          database,
          workspace,
          importId,
          decodeURIComponent(disciplineMatch[2])
        )
      );
    }

    const archiveMatch = path.match(/^\/api\/academic-performance\/([^/]+)\/archive$/u);
    if (archiveMatch && method === 'POST') {
      requireManager(context);
      const importId = decodeURIComponent(archiveMatch[1]);
      requireReadableRun(database, workspace, context, importId);
      const body = await readJson(request);
      return sendJson(
        response,
        200,
        archiveAcademicImport(database, workspace, importId, actorPersonId, body.reason || null)
      );
    }

    const restoreMatch = path.match(/^\/api\/academic-performance\/([^/]+)\/restore$/u);
    if (restoreMatch && method === 'POST') {
      requireManager(context);
      const importId = decodeURIComponent(restoreMatch[1]);
      requireReadableRun(database, workspace, context, importId);
      return sendJson(
        response,
        200,
        restoreAcademicImport(database, workspace, importId, actorPersonId)
      );
    }

    const detailMatch = path.match(/^\/api\/academic-performance\/([^/]+)$/u);
    if (detailMatch && method === 'GET') {
      return sendJson(
        response,
        200,
        requireReadableRun(database, workspace, context, decodeURIComponent(detailMatch[1]))
      );
    }

    return false;
  };
}
