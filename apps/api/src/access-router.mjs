import { basename } from 'node:path';
import { AppError } from '../../../packages/core/src/errors.mjs';
import { detectFormat } from '../../../packages/document-intake/src/formats.mjs';
import { storeIncomingStream } from '../../../packages/document-intake/src/blob-store.mjs';
import { registerDocument, listDocuments, getDocument } from '../../../packages/storage/src/documents.mjs';
import { getDocumentFile } from '../../../packages/storage/src/document-files.mjs';
import { getDocumentStructure, setExtractionValueOverride } from '../../../packages/storage/src/document-structure.mjs';
import { search } from '../../../packages/storage/src/search.mjs';
import { listTemplates, getTemplateSource, previewTemplate, createTemplate } from '../../../packages/templates/src/service.mjs';
import { getTemplateDraft, saveTemplateDraft, deleteTemplateDraft } from '../../../packages/templates/src/drafts.mjs';
import { listReviewItems, resolveReviewItem } from '../../../packages/storage/src/reviews.mjs';
import { listCalendarItems, getCalendarItem, listTasks, listNotifications } from '../../../packages/calendar/src/service.mjs';
import {
  listDirectives, getDirective, listAssignments, addAssignmentProgress,
  attachAssignmentReport, searchWork
} from '../../../packages/work-management/src/service.mjs';
import {
  listReportMatches, acceptReportMatch, rejectReportMatch, reviewAssignmentReport
} from '../../../packages/reports/src/service.mjs';
import { listScientificItems, getScientificItem, createScientificItem } from '../../../packages/science/src/service.mjs';
import { auditAction } from '../../../packages/auth/src/service.mjs';
import { assertPersonScope, requireRole } from '../../../packages/auth/src/policy.mjs';
import {
  accessAuditDetails,
  assignmentAccess,
  assertAssignmentAccess,
  assertObjectAccess,
  canReadCalendarItem,
  canReadSearchResult,
  documentIdForExtraction,
  documentIdForVersion,
  ensureObjectPolicy,
  explainObjectAccess,
  resolveObjectAccess,
  setObjectAccess
} from '../../../packages/access-control/src/service.mjs';
import { readJson, requireHeader, sendFile, sendJson } from './http-utils.mjs';

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

function workFilters(url) {
  return {
    q: url.searchParams.get('q') || '',
    kind: url.searchParams.get('kind') || '',
    from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '',
    direction: url.searchParams.get('direction') || '',
    executor: url.searchParams.get('executor') || '',
    status: url.searchParams.get('status') || '',
    limit: integerParam(url.searchParams.get('limit'), 500, 2000)
  };
}

function scienceFilters(url) {
  return {
    q: url.searchParams.get('q') || '', kind: url.searchParams.get('kind') || '',
    status: url.searchParams.get('status') || '', from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '', year: url.searchParams.get('year') || '',
    author: url.searchParams.get('author') || '',
    classification: url.searchParams.get('classification') || '',
    limit: Math.min(1000, integerParam(url.searchParams.get('limit'), 300, 1000) * 4)
  };
}

function documentAccess(database, workspaceId, context, documentId, action = 'read') {
  return assertObjectAccess(database, workspaceId, context, 'document', documentId, action);
}

function sourceDocumentForCalendar(database, workspaceId, item) {
  if (!item) return null;
  if (item.source_kind === 'document' || item.source_kind === 'document_version') {
    return item.source_kind === 'document'
      ? item.source_id
      : documentIdForVersion(database, workspaceId, item.source_id);
  }
  return null;
}

function assertCalendarMutation(database, workspaceId, context, item) {
  if (!item) throw new AppError('calendar_item_not_found', 'Событие или задача не найдены.', 404);
  if (item.source_kind === 'assignment') {
    return assertAssignmentAccess(database, workspaceId, context, item.source_id, 'edit');
  }
  if (item.source_kind === 'directive') {
    return assertObjectAccess(database, workspaceId, context, 'directive', item.source_id, 'edit');
  }
  const documentId = sourceDocumentForCalendar(database, workspaceId, item);
  if (documentId) return documentAccess(database, workspaceId, context, documentId, 'edit');
  if (item.source_kind === 'periodic_task') {
    const task = database.get(`
      SELECT owner_person_id, manager_person_id FROM periodic_tasks
      WHERE workspace_id = ? AND id = ?
    `, workspaceId, item.source_id);
    if (!task) throw new AppError('calendar_item_not_found', 'Событие или задача не найдены.', 404);
    if (!context.enabled || context.role === 'admin') return true;
    if ([task.owner_person_id, task.manager_person_id].includes(context.personId)) return true;
    throw new AppError('calendar_access_forbidden', 'Нет доступа к этой задаче.', 403);
  }
  return true;
}

function matchReadable(database, workspaceId, context, item) {
  return assignmentAccess(database, workspaceId, context, item.assignment_id).allowed
    && resolveObjectAccess(database, workspaceId, context, 'document', item.document_id).allowed;
}

function filterWork(database, workspaceId, context, payload, limit) {
  const items = (payload.items || [])
    .filter((item) => canReadSearchResult(database, workspaceId, context, item))
    .slice(0, limit);
  return {
    items,
    facets: {
      directions: [...new Set(items.map((item) => item.direction).filter(Boolean))].sort(),
      statuses: [...new Set(items.map((item) => item.status).filter(Boolean))].sort(),
      kinds: [...new Set(items.map((item) => item.subtype).filter(Boolean))].sort()
    }
  };
}

function templateError(error) {
  const code = String(error?.message || error);
  if (code === 'template_name_required') return new AppError(code, 'Назовите шаблон.', 400);
  if (code === 'template_fields_required') return new AppError(code, 'Добавьте хотя бы одно поле извлечения.', 400);
  if (code === 'template_source_not_found') return new AppError(code, 'Исходный документ для шаблона не найден.', 404);
  return error;
}

export function createAccessRouter({ database, config, logger }) {
  return async function routeAccess(request, response, url, requestId) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const workspace = workspaceOf(database, request);
    const context = request.auth;

    const adminAccessMatch = path.match(/^\/api\/admin\/access\/(document|directive|scientific_item)\/([^/]+)$/);
    if (adminAccessMatch) {
      requireRole(context, 'admin');
      const objectKind = adminAccessMatch[1];
      const objectId = decodeURIComponent(adminAccessMatch[2]);
      if (method === 'GET') {
        return sendJson(response, 200, explainObjectAccess(database, workspace.id, objectKind, objectId));
      }
      if (method === 'PUT') {
        const explanation = setObjectAccess(
          database, workspace.id, objectKind, objectId, await readJson(request), context.personId
        );
        auditAction(database, {
          workspaceId: workspace.id,
          accountId: context.accountId,
          personId: context.personId,
          action: 'acl.object_updated',
          targetKind: objectKind,
          targetId: objectId,
          details: accessAuditDetails(explanation)
        });
        return sendJson(response, 200, explanation);
      }
      return false;
    }

    if (method === 'GET' && path === '/api/documents') {
      const limit = integerParam(url.searchParams.get('limit'), 100, 1000);
      const items = listDocuments(database, workspace.id, Math.min(5000, Math.max(500, limit * 8)))
        .filter((item) => resolveObjectAccess(database, workspace.id, context, 'document', item.id).allowed)
        .slice(0, limit);
      return sendJson(response, 200, { items });
    }
    if (method === 'POST' && path === '/api/documents') {
      const encodedName = requireHeader(request, 'x-file-name', 'Передайте исходное имя файла в заголовке X-File-Name.');
      let decodedName;
      try { decodedName = decodeURIComponent(encodedName); } catch { decodedName = encodedName; }
      const originalName = basename(decodedName);
      const mediaType = String(request.headers['content-type'] || 'application/octet-stream').split(';', 1)[0];
      const requestedType = String(request.headers['x-document-type'] || 'auto').trim() || 'auto';
      const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key'].trim() : null;
      const blob = await storeIncomingStream(request, {
        blobDir: config.blobDir, tempDir: config.tempDir,
        maxBytes: config.maxUploadBytes, mediaType
      });
      const result = registerDocument(database, {
        workspaceId: workspace.id,
        title: originalName.replace(/\.[^.]+$/, '') || originalName,
        originalName, mediaType, detectedFormat: detectFormat(originalName, mediaType),
        blob, requestedType, idempotencyKey
      });
      const requestedScope = String(request.headers['x-access-scope'] || 'restricted');
      const accessScope = context.role === 'admin' && requestedScope === 'workspace'
        ? 'workspace' : 'restricted';
      ensureObjectPolicy(database, {
        workspaceId: workspace.id, objectKind: 'document', objectId: result.documentId,
        ownerPersonId: context.personId || null, accessScope
      });
      logger.info('document accepted with ACL', {
        requestId, workspaceId: workspace.id, personId: context.personId || null,
        accessScope, ...result
      });
      return sendJson(response, 202, result, { location: `/api/documents/${result.documentId}` });
    }

    const documentContentMatch = path.match(/^\/api\/documents\/([^/]+)\/content$/);
    if (['GET', 'HEAD'].includes(method) && documentContentMatch) {
      const documentId = decodeURIComponent(documentContentMatch[1]);
      documentAccess(database, workspace.id, context, documentId, 'read');
      const variant = url.searchParams.get('variant') || 'original';
      if (!['original', 'preview'].includes(variant)) {
        throw new AppError('document_variant_invalid', 'Допустимы варианты original и preview.', 400);
      }
      const file = getDocumentFile(database, workspace.id, documentId, variant);
      if (!file) throw new AppError('document_not_found', 'Документ не найден.', 404);
      if (!file.available) {
        throw new AppError('document_preview_unavailable',
          file.status === 'pending' ? 'Предпросмотр ещё формируется.' : 'Предпросмотр для этого документа недоступен.',
          409, { status: file.status, error: file.error });
      }
      return sendFile(request, response, file.path, {
        mediaType: file.mediaType, fileName: file.fileName, sizeBytes: file.sizeBytes,
        etag: file.sha256,
        disposition: variant === 'preview' || file.mediaType === 'application/pdf'
          || String(file.mediaType || '').startsWith('image/') ? 'inline' : 'attachment'
      });
    }
    const documentStructureMatch = path.match(/^\/api\/documents\/([^/]+)\/structure$/);
    if (method === 'GET' && documentStructureMatch) {
      const documentId = decodeURIComponent(documentStructureMatch[1]);
      documentAccess(database, workspace.id, context, documentId, 'read');
      const structure = getDocumentStructure(database, workspace.id, documentId, {
        limit: integerParam(url.searchParams.get('limit'), 2000, 5000),
        offset: Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0),
        page: url.searchParams.get('page'), sheet: url.searchParams.get('sheet')
      });
      if (!structure) throw new AppError('document_not_found', 'Документ не найден.', 404);
      return sendJson(response, 200, structure);
    }
    const documentMatch = path.match(/^\/api\/documents\/([^/]+)$/);
    if (method === 'GET' && documentMatch) {
      const documentId = decodeURIComponent(documentMatch[1]);
      documentAccess(database, workspace.id, context, documentId, 'read');
      const document = getDocument(database, workspace.id, documentId);
      if (!document) throw new AppError('document_not_found', 'Документ не найден.', 404);
      return sendJson(response, 200, document);
    }

    if (method === 'GET' && path === '/api/templates') {
      const items = listTemplates(database, workspace.id).map((item) => {
        const documentId = item.source_document_version_id
          ? documentIdForVersion(database, workspace.id, item.source_document_version_id) : null;
        if (!documentId || resolveObjectAccess(database, workspace.id, context, 'document', documentId).allowed) return item;
        const clone = { ...item };
        clone.source_document_version_id = null;
        clone.source_document_title = null;
        return clone;
      });
      return sendJson(response, 200, { items });
    }
    if (method === 'GET' && path === '/api/templates/source') {
      const documentId = url.searchParams.get('documentId');
      if (!documentId) throw new AppError('document_id_required', 'Выберите документ.', 400);
      documentAccess(database, workspace.id, context, documentId, 'read');
      const source = getTemplateSource(database, workspace.id, documentId);
      if (!source) throw new AppError('document_not_found', 'Документ не найден.', 404);
      if (!source.extracted_text) throw new AppError('document_text_not_ready', 'Текст документа ещё не готов. Дождитесь завершения обработки.', 409);
      return sendJson(response, 200, source);
    }
    if (method === 'POST' && path === '/api/templates/preview') {
      const body = await readJson(request);
      const documentId = documentIdForVersion(database, workspace.id, body.documentVersionId);
      if (!documentId) throw new AppError('template_source_not_found', 'Исходный документ для проверки не найден.', 404);
      documentAccess(database, workspace.id, context, documentId, 'read');
      const preview = previewTemplate(database, workspace.id, body);
      if (!preview) throw new AppError('template_source_not_found', 'Исходный документ для проверки не найден.', 404);
      return sendJson(response, 200, preview);
    }
    if (method === 'POST' && path === '/api/templates') {
      const body = await readJson(request);
      const documentId = documentIdForVersion(database, workspace.id, body.documentVersionId);
      if (!documentId) throw new AppError('template_source_not_found', 'Исходный документ для шаблона не найден.', 404);
      documentAccess(database, workspace.id, context, documentId, 'edit');
      try {
        const template = database.transaction(() => createTemplate(database, workspace.id, body));
        return sendJson(response, 201, template);
      } catch (error) { throw templateError(error); }
    }
    if (['GET', 'PUT', 'DELETE'].includes(method) && path === '/api/templates/draft') {
      const body = method === 'PUT' ? await readJson(request) : null;
      const versionId = body?.documentVersionId || url.searchParams.get('documentVersionId');
      if (!versionId) throw new AppError('document_version_required', 'Выберите документ для черновика.', 400);
      const documentId = documentIdForVersion(database, workspace.id, versionId);
      if (!documentId) throw new AppError('template_source_not_found', 'Исходный документ для черновика не найден.', 404);
      documentAccess(database, workspace.id, context, documentId, method === 'GET' ? 'read' : 'edit');
      if (method === 'GET') return sendJson(response, 200, { draft: getTemplateDraft(database, workspace.id, versionId) });
      if (method === 'PUT') {
        const draft = saveTemplateDraft(database, workspace.id, body);
        if (!draft) throw new AppError('template_source_not_found', 'Исходный документ для черновика не найден.', 404);
        return sendJson(response, 200, { draft });
      }
      deleteTemplateDraft(database, workspace.id, versionId);
      return sendJson(response, 200, { status: 'deleted' });
    }
    const overrideMatch = path.match(/^\/api\/template-extractions\/([^/]+)\/fields\/([^/]+)$/);
    if (method === 'PATCH' && overrideMatch) {
      const extractionId = decodeURIComponent(overrideMatch[1]);
      const documentId = documentIdForExtraction(database, workspace.id, extractionId);
      if (!documentId) throw new AppError('template_extraction_not_found', 'Результат извлечения или поле не найдены.', 404);
      documentAccess(database, workspace.id, context, documentId, 'edit');
      const body = await readJson(request);
      if (!Object.prototype.hasOwnProperty.call(body, 'value')) throw new AppError('override_value_required', 'Укажите исправленное значение.', 400);
      const result = setExtractionValueOverride(database, workspace.id, extractionId, decodeURIComponent(overrideMatch[2]), {
        ...body, actorPersonId: context.personId || null
      });
      if (!result) throw new AppError('template_extraction_not_found', 'Результат извлечения или поле не найдены.', 404);
      return sendJson(response, 200, result);
    }

    if (method === 'GET' && path === '/api/directives') {
      const limit = integerParam(url.searchParams.get('limit'), 200, 1000);
      const items = listDirectives(database, workspace.id, { ...workFilters(url), limit: Math.min(1000, limit * 5) })
        .filter((item) => resolveObjectAccess(database, workspace.id, context, 'directive', item.id).allowed)
        .slice(0, limit);
      return sendJson(response, 200, { items });
    }
    const directiveMatch = path.match(/^\/api\/directives\/([^/]+)$/);
    if (method === 'GET' && directiveMatch) {
      const directiveId = decodeURIComponent(directiveMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'directive', directiveId, 'read');
      const item = getDirective(database, workspace.id, directiveId);
      if (!item) throw new AppError('directive_not_found', 'Распорядительный документ не найден.', 404);
      item.assignments = (item.assignments || []).filter((assignment) =>
        assignmentAccess(database, workspace.id, context, assignment.id).allowed
      );
      return sendJson(response, 200, item);
    }
    if (method === 'GET' && path === '/api/assignments') {
      const limit = integerParam(url.searchParams.get('limit'), 500, 2000);
      const items = listAssignments(database, workspace.id, { ...workFilters(url), limit: Math.min(2000, limit * 4) })
        .filter((item) => assignmentAccess(database, workspace.id, context, item.id).allowed)
        .slice(0, limit);
      return sendJson(response, 200, { items });
    }
    const assignmentProgressMatch = path.match(/^\/api\/assignments\/([^/]+)\/progress$/);
    if (method === 'POST' && assignmentProgressMatch) {
      const assignmentId = decodeURIComponent(assignmentProgressMatch[1]);
      assertAssignmentAccess(database, workspace.id, context, assignmentId, 'edit');
      const body = await readJson(request);
      const item = addAssignmentProgress(database, workspace.id, assignmentId, {
        ...body, actorPersonId: context.personId || null
      });
      if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      return sendJson(response, 200, item);
    }
    const assignmentReportMatch = path.match(/^\/api\/assignments\/([^/]+)\/report$/);
    if (method === 'POST' && assignmentReportMatch) {
      const assignmentId = decodeURIComponent(assignmentReportMatch[1]);
      assertAssignmentAccess(database, workspace.id, context, assignmentId, 'edit');
      const body = await readJson(request);
      if (!body.documentId) throw new AppError('report_document_required', 'Выберите отчётный документ.', 400);
      documentAccess(database, workspace.id, context, body.documentId, 'read');
      const item = attachAssignmentReport(database, workspace.id, assignmentId, {
        ...body, actorPersonId: context.personId || null
      });
      if (!item) throw new AppError('assignment_or_report_not_found', 'Поручение или отчётный документ не найдены.', 404);
      return sendJson(response, 200, item);
    }
    const assignmentReviewMatch = path.match(/^\/api\/assignments\/([^/]+)\/review$/);
    if (method === 'POST' && assignmentReviewMatch) {
      const assignmentId = decodeURIComponent(assignmentReviewMatch[1]);
      assertAssignmentAccess(database, workspace.id, context, assignmentId, 'control');
      const body = await readJson(request);
      try {
        const item = reviewAssignmentReport(database, workspace.id, assignmentId, {
          ...body, personId: context.personId || null
        });
        if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
        return sendJson(response, 200, item);
      } catch (error) {
        if (String(error?.message || error) === 'report_review_action_invalid') throw new AppError('report_review_action_invalid', 'Допустимы действия approve и return.', 400);
        if (String(error?.message || error) === 'report_evidence_missing') throw new AppError('report_evidence_missing', 'У поручения нет отчёта, ожидающего проверки.', 409);
        throw error;
      }
    }
    if (method === 'GET' && path === '/api/work/search') {
      const limit = integerParam(url.searchParams.get('limit'), 500, 1000);
      return sendJson(response, 200,
        filterWork(database, workspace.id, context, searchWork(database, workspace.id, { ...workFilters(url), limit: Math.min(1000, limit * 4) }), limit));
    }

    if (method === 'GET' && path === '/api/report-matches') {
      const limit = integerParam(url.searchParams.get('limit'), 100, 500);
      const items = listReportMatches(database, workspace.id, {
        documentId: url.searchParams.get('documentId') || '',
        documentVersionId: url.searchParams.get('documentVersionId') || '',
        assignmentId: url.searchParams.get('assignmentId') || '',
        status: url.searchParams.get('status') || '', limit: Math.min(500, limit * 4)
      }).filter((item) => matchReadable(database, workspace.id, context, item)).slice(0, limit);
      return sendJson(response, 200, { items });
    }
    const reportMatchAction = path.match(/^\/api\/report-matches\/([^/]+)\/(accept|reject)$/);
    if (method === 'POST' && reportMatchAction) {
      const matchId = decodeURIComponent(reportMatchAction[1]);
      const candidate = database.get(`
        SELECT rm.assignment_id, dv.document_id FROM report_match_candidates rm
        JOIN document_versions dv ON dv.id = rm.document_version_id
        WHERE rm.workspace_id = ? AND rm.id = ?
      `, workspace.id, matchId);
      if (!candidate) throw new AppError('report_match_not_found', 'Предложенная связь отчёта не найдена.', 404);
      assertAssignmentAccess(database, workspace.id, context, candidate.assignment_id, 'edit');
      documentAccess(database, workspace.id, context, candidate.document_id, 'read');
      const body = await readJson(request);
      const input = { ...body, personId: context.personId || null };
      const item = reportMatchAction[2] === 'accept'
        ? acceptReportMatch(database, workspace.id, matchId, input)
        : rejectReportMatch(database, workspace.id, matchId, input);
      if (!item) throw new AppError('report_match_not_found', 'Предложенная связь отчёта не найдена.', 404);
      return sendJson(response, 200, item);
    }

    if (method === 'GET' && path === '/api/science') {
      const limit = integerParam(url.searchParams.get('limit'), 300, 1000);
      const items = listScientificItems(database, workspace.id, scienceFilters(url))
        .filter((item) => resolveObjectAccess(database, workspace.id, context, 'scientific_item', item.id).allowed)
        .slice(0, limit);
      return sendJson(response, 200, { items });
    }
    if (method === 'POST' && path === '/api/science') {
      const body = await readJson(request);
      if (body.documentVersionId) {
        const documentId = documentIdForVersion(database, workspace.id, body.documentVersionId);
        if (!documentId) throw new AppError('document_not_found', 'Документ не найден.', 404);
        documentAccess(database, workspace.id, context, documentId, 'read');
      }
      try {
        const item = createScientificItem(database, workspace.id, body);
        ensureObjectPolicy(database, {
          workspaceId: workspace.id, objectKind: 'scientific_item', objectId: item.id,
          ownerPersonId: context.personId || null, accessScope: 'restricted'
        });
        return sendJson(response, 201, item);
      } catch (error) {
        if (String(error?.message || error) === 'scientific_title_required') throw new AppError('scientific_title_required', 'Укажите название научного материала.', 400);
        throw error;
      }
    }
    const scienceMatch = path.match(/^\/api\/science\/([^/]+)$/);
    if (method === 'GET' && scienceMatch) {
      const itemId = decodeURIComponent(scienceMatch[1]);
      assertObjectAccess(database, workspace.id, context, 'scientific_item', itemId, 'read');
      const item = getScientificItem(database, workspace.id, itemId);
      if (!item) throw new AppError('scientific_item_not_found', 'Научный материал не найден.', 404);
      return sendJson(response, 200, item);
    }

    if (method === 'GET' && path === '/api/search') {
      const query = url.searchParams.get('q') || '';
      const limit = integerParam(url.searchParams.get('limit'), 50, 200);
      const items = search(database, workspace.id, query, Math.min(1000, limit * 8))
        .filter((item) => canReadSearchResult(database, workspace.id, context, item))
        .slice(0, limit);
      return sendJson(response, 200, { query, items });
    }

    if (method === 'GET' && path === '/api/calendar') {
      const limit = integerParam(url.searchParams.get('limit'), 500, 2000);
      const items = listCalendarItems(database, workspace.id, {
        from: url.searchParams.get('from'), to: url.searchParams.get('to'),
        kind: url.searchParams.get('kind'), status: url.searchParams.get('status'),
        categories: categoriesParam(url), limit: Math.min(5000, limit * 4)
      }).filter((item) => canReadCalendarItem(database, workspace.id, context, item)).slice(0, limit);
      return sendJson(response, 200, { items });
    }
    const calendarUndoMatch = path.match(/^\/api\/calendar\/([^/]+)\/undo$/);
    if (method === 'POST' && calendarUndoMatch) {
      const item = getCalendarItem(database, workspace.id, decodeURIComponent(calendarUndoMatch[1]));
      assertCalendarMutation(database, workspace.id, context, item);
      return false;
    }
    const calendarMatch = path.match(/^\/api\/calendar\/([^/]+)$/);
    if (['GET', 'PATCH'].includes(method) && calendarMatch) {
      const item = getCalendarItem(database, workspace.id, decodeURIComponent(calendarMatch[1]));
      if (!item) throw new AppError('calendar_item_not_found', 'Событие или задача не найдены.', 404);
      if (method === 'GET') {
        if (!canReadCalendarItem(database, workspace.id, context, item)) throw new AppError('calendar_access_forbidden', 'Нет доступа к этой записи.', 403);
        return sendJson(response, 200, item);
      }
      assertCalendarMutation(database, workspace.id, context, item);
      return false;
    }
    if (method === 'GET' && path === '/api/tasks') {
      const limit = integerParam(url.searchParams.get('limit'), 500, 2000);
      const items = listTasks(database, workspace.id, {
        categories: categoriesParam(url), limit: Math.min(5000, limit * 4)
      }).filter((item) => canReadCalendarItem(database, workspace.id, context, item)).slice(0, limit);
      return sendJson(response, 200, { items });
    }
    if (method === 'GET' && path === '/api/notifications') {
      const personId = url.searchParams.get('personId') || context.personId;
      assertPersonScope(database, workspace.id, context, personId);
      const items = listNotifications(database, workspace.id, {
        limit: integerParam(url.searchParams.get('limit'), 50, 200), personId
      });
      return sendJson(response, 200, { items, unread: items.filter((item) => !item.read).length });
    }

    if (method === 'GET' && path === '/api/review') {
      requireRole(context, ['manager', 'admin']);
      const items = listReviewItems(database, workspace.id, url.searchParams.get('status') || 'open')
        .filter((item) => canReadSearchResult(database, workspace.id, context, item));
      return sendJson(response, 200, { items });
    }
    const reviewMatch = path.match(/^\/api\/review\/([^/]+)\/resolve$/);
    if (method === 'POST' && reviewMatch) {
      requireRole(context, ['manager', 'admin']);
      const review = database.get('SELECT * FROM review_items WHERE workspace_id = ? AND id = ?', workspace.id, decodeURIComponent(reviewMatch[1]));
      if (!review) throw new AppError('review_item_not_found', 'Пункт проверки не найден или уже закрыт.', 404);
      if (!canReadSearchResult(database, workspace.id, context, review)) throw new AppError('object_access_forbidden', 'Нет доступа к этому объекту.', 403);
      const body = await readJson(request);
      const resolved = resolveReviewItem(database, workspace.id, review.id, body);
      if (!resolved) throw new AppError('review_item_not_found', 'Пункт проверки не найден или уже закрыт.', 404);
      return sendJson(response, 200, { status: 'resolved' });
    }

    return false;
  };
}
