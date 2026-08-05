import { basename } from 'node:path';
import { AppError } from '../../../packages/core/src/errors.mjs';
import { detectFormat } from '../../../packages/document-intake/src/formats.mjs';
import { storeIncomingStream } from '../../../packages/document-intake/src/blob-store.mjs';
import { registerDocument, listDocuments, getDocument } from '../../../packages/storage/src/documents.mjs';
import { getDocumentFile } from '../../../packages/storage/src/document-files.mjs';
import {
  listCalendarItems,
  getCalendarItem,
  createCalendarItem,
  updateCalendarItem,
  undoCalendarItem,
  listTasks,
  listNotifications,
  setNotificationState
} from '../../../packages/calendar/src/service.mjs';
import {
  listTemplates,
  getTemplateSource,
  previewTemplate,
  createTemplate
} from '../../../packages/templates/src/service.mjs';
import {
  getTemplateDraft,
  saveTemplateDraft,
  deleteTemplateDraft
} from '../../../packages/templates/src/drafts.mjs';
import { listReviewItems, resolveReviewItem } from '../../../packages/storage/src/reviews.mjs';
import { getOverview } from '../../../packages/storage/src/overview.mjs';
import { systemHealth } from '../../../packages/storage/src/system.mjs';
import { search } from '../../../packages/storage/src/search.mjs';
import { getDocumentStructure, setExtractionValueOverride } from '../../../packages/storage/src/document-structure.mjs';
import { readJson, requireHeader, sendFile, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
    throw new AppError('workspace_not_found', 'Рабочее пространство не найдено.', 404);
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

function templateError(error) {
  const code = String(error?.message || error);
  if (code === 'template_name_required') return new AppError(code, 'Назовите шаблон.', 400);
  if (code === 'template_fields_required') return new AppError(code, 'Добавьте хотя бы одно поле извлечения.', 400);
  if (code === 'template_source_not_found') return new AppError(code, 'Исходный документ для шаблона не найден.', 404);
  return error;
}

export function createRouter({ database, config, logger }) {
  return async function route(request, response, url, requestId) {
    const method = request.method || 'GET';
    const path = url.pathname;

    if (method === 'GET' && path === '/api/system/health') {
      return sendJson(response, 200, systemHealth(database));
    }
    if (method === 'GET' && path === '/api/workspaces') {
      return sendJson(response, 200, { items: database.all('SELECT * FROM workspaces ORDER BY name') });
    }

    const workspace = workspaceOf(database, request);
    if (method === 'GET' && path === '/api/overview') {
      return sendJson(response, 200, getOverview(database, workspace.id));
    }
    if (method === 'GET' && path === '/api/documents') {
      return sendJson(response, 200, { items: listDocuments(database, workspace.id, integerParam(url.searchParams.get('limit'), 100)) });
    }
    if (method === 'POST' && path === '/api/documents') {
      const encodedName = requireHeader(request, 'x-file-name', 'Передайте исходное имя файла в заголовке X-File-Name.');
      let decodedName;
      try { decodedName = decodeURIComponent(encodedName); } catch { decodedName = encodedName; }
      const originalName = basename(decodedName);
      const mediaType = String(request.headers['content-type'] || 'application/octet-stream').split(';', 1)[0];
      const requestedType = String(request.headers['x-document-type'] || 'auto').trim() || 'auto';
      const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key'].trim()
        : null;
      const blob = await storeIncomingStream(request, {
        blobDir: config.blobDir,
        tempDir: config.tempDir,
        maxBytes: config.maxUploadBytes,
        mediaType
      });
      const result = registerDocument(database, {
        workspaceId: workspace.id,
        title: originalName.replace(/\.[^.]+$/, '') || originalName,
        originalName,
        mediaType,
        detectedFormat: detectFormat(originalName, mediaType),
        blob,
        requestedType,
        idempotencyKey
      });
      logger.info('document accepted', { requestId, workspaceId: workspace.id, ...result });
      return sendJson(response, 202, result, { location: `/api/documents/${result.documentId}` });
    }

    if (method === 'GET' && path === '/api/templates') {
      return sendJson(response, 200, { items: listTemplates(database, workspace.id) });
    }
    if (method === 'GET' && path === '/api/templates/source') {
      const documentId = url.searchParams.get('documentId');
      if (!documentId) throw new AppError('document_id_required', 'Выберите документ.', 400);
      const source = getTemplateSource(database, workspace.id, documentId);
      if (!source) throw new AppError('document_not_found', 'Документ не найден.', 404);
      if (!source.extracted_text) {
        throw new AppError('document_text_not_ready', 'Текст документа ещё не готов. Дождитесь завершения обработки.', 409);
      }
      return sendJson(response, 200, source);
    }
    if (method === 'POST' && path === '/api/templates/preview') {
      const body = await readJson(request);
      const preview = previewTemplate(database, workspace.id, body);
      if (!preview) throw new AppError('template_source_not_found', 'Исходный документ для проверки не найден.', 404);
      return sendJson(response, 200, preview);
    }
    if (method === 'POST' && path === '/api/templates') {
      const body = await readJson(request);
      try {
        const template = database.transaction(() => createTemplate(database, workspace.id, body));
        return sendJson(response, 201, template);
      } catch (error) {
        throw templateError(error);
      }
    }
    if (method === 'GET' && path === '/api/templates/draft') {
      const documentVersionId = url.searchParams.get('documentVersionId');
      if (!documentVersionId) throw new AppError('document_version_required', 'Выберите документ для черновика.', 400);
      return sendJson(response, 200, {
        draft: getTemplateDraft(database, workspace.id, documentVersionId)
      });
    }
    if (method === 'PUT' && path === '/api/templates/draft') {
      const body = await readJson(request);
      if (!body.documentVersionId) throw new AppError('document_version_required', 'Выберите документ для черновика.', 400);
      const draft = saveTemplateDraft(database, workspace.id, body);
      if (!draft) throw new AppError('template_source_not_found', 'Исходный документ для черновика не найден.', 404);
      return sendJson(response, 200, { draft });
    }
    if (method === 'DELETE' && path === '/api/templates/draft') {
      const documentVersionId = url.searchParams.get('documentVersionId');
      if (!documentVersionId) throw new AppError('document_version_required', 'Выберите документ для черновика.', 400);
      deleteTemplateDraft(database, workspace.id, documentVersionId);
      return sendJson(response, 200, { status: 'deleted' });
    }

    const documentContentMatch = path.match(/^\/api\/documents\/([^/]+)\/content$/);
    if (['GET', 'HEAD'].includes(method) && documentContentMatch) {
      const variant = url.searchParams.get('variant') || 'original';
      if (!['original', 'preview'].includes(variant)) {
        throw new AppError('document_variant_invalid', 'Допустимы варианты original и preview.', 400);
      }
      const file = getDocumentFile(database, workspace.id, decodeURIComponent(documentContentMatch[1]), variant);
      if (!file) throw new AppError('document_not_found', 'Документ не найден.', 404);
      if (!file.available) {
        throw new AppError(
          'document_preview_unavailable',
          file.status === 'pending'
            ? 'Предпросмотр ещё формируется.'
            : 'Предпросмотр для этого документа недоступен.',
          409,
          { status: file.status, error: file.error }
        );
      }
      return sendFile(request, response, file.path, {
        mediaType: file.mediaType,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        etag: file.sha256,
        disposition: variant === 'preview'
          || file.mediaType === 'application/pdf'
          || String(file.mediaType || '').startsWith('image/')
          ? 'inline'
          : 'attachment'
      });
    }

    const documentStructureMatch = path.match(/^\/api\/documents\/([^/]+)\/structure$/);
    if (method === 'GET' && documentStructureMatch) {
      const structure = getDocumentStructure(database, workspace.id, decodeURIComponent(documentStructureMatch[1]), {
        limit: integerParam(url.searchParams.get('limit'), 2000, 5000),
        offset: Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0),
        page: url.searchParams.get('page'),
        sheet: url.searchParams.get('sheet')
      });
      if (!structure) throw new AppError('document_not_found', 'Документ не найден.', 404);
      return sendJson(response, 200, structure);
    }

    const overrideMatch = path.match(/^\/api\/template-extractions\/([^/]+)\/fields\/([^/]+)$/);
    if (method === 'PATCH' && overrideMatch) {
      const body = await readJson(request);
      if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
        throw new AppError('override_value_required', 'Укажите исправленное значение.', 400);
      }
      const result = setExtractionValueOverride(
        database,
        workspace.id,
        decodeURIComponent(overrideMatch[1]),
        decodeURIComponent(overrideMatch[2]),
        body
      );
      if (!result) throw new AppError('template_extraction_not_found', 'Результат извлечения или поле не найдены.', 404);
      return sendJson(response, 200, result);
    }

    const documentMatch = path.match(/^\/api\/documents\/([^/]+)$/);
    if (method === 'GET' && documentMatch) {
      const document = getDocument(database, workspace.id, decodeURIComponent(documentMatch[1]));
      if (!document) throw new AppError('document_not_found', 'Документ не найден.', 404);
      return sendJson(response, 200, document);
    }

    if (method === 'GET' && path === '/api/calendar') {
      return sendJson(response, 200, {
        items: listCalendarItems(database, workspace.id, {
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          kind: url.searchParams.get('kind'),
          status: url.searchParams.get('status'),
          categories: categoriesParam(url),
          limit: integerParam(url.searchParams.get('limit'), 500, 2000)
        })
      });
    }
    if (method === 'POST' && path === '/api/calendar') {
      const body = await readJson(request);
      if (!body.title || !body.startsAt) throw new AppError('calendar_fields_required', 'Укажите название и дату.', 400);
      return sendJson(response, 201, createCalendarItem(database, workspace.id, body));
    }
    const calendarUndoMatch = path.match(/^\/api\/calendar\/([^/]+)\/undo$/);
    if (method === 'POST' && calendarUndoMatch) {
      const item = undoCalendarItem(database, workspace.id, decodeURIComponent(calendarUndoMatch[1]));
      if (!item) throw new AppError('calendar_undo_unavailable', 'Предыдущее изменение уже отменено или недоступно.', 409);
      return sendJson(response, 200, item);
    }
    const calendarMatch = path.match(/^\/api\/calendar\/([^/]+)$/);
    if (method === 'GET' && calendarMatch) {
      const item = getCalendarItem(database, workspace.id, decodeURIComponent(calendarMatch[1]));
      if (!item) throw new AppError('calendar_item_not_found', 'Событие или задача не найдены.', 404);
      return sendJson(response, 200, item);
    }
    if (method === 'PATCH' && calendarMatch) {
      const body = await readJson(request);
      const item = updateCalendarItem(database, workspace.id, decodeURIComponent(calendarMatch[1]), body);
      if (!item) throw new AppError('calendar_item_not_found', 'Событие или задача не найдены.', 404);
      return sendJson(response, 200, item);
    }
    if (method === 'GET' && path === '/api/tasks') {
      return sendJson(response, 200, {
        items: listTasks(database, workspace.id, {
          categories: categoriesParam(url),
          limit: integerParam(url.searchParams.get('limit'), 500, 2000)
        })
      });
    }
    if (method === 'GET' && path === '/api/notifications') {
      const items = listNotifications(database, workspace.id, { limit: integerParam(url.searchParams.get('limit'), 50, 200) });
      return sendJson(response, 200, { items, unread: items.filter((item) => !item.read).length });
    }
    if (method === 'POST' && path === '/api/notifications/state') {
      const body = await readJson(request);
      if (!body.key || !['read', 'dismiss'].includes(body.action)) {
        throw new AppError('notification_state_invalid', 'Укажите уведомление и действие.', 400);
      }
      setNotificationState(database, workspace.id, body.key, body.action);
      return sendJson(response, 200, { status: body.action === 'dismiss' ? 'dismissed' : 'read' });
    }

    if (method === 'GET' && path === '/api/review') {
      return sendJson(response, 200, {
        items: listReviewItems(database, workspace.id, url.searchParams.get('status') || 'open')
      });
    }
    const reviewMatch = path.match(/^\/api\/review\/([^/]+)\/resolve$/);
    if (method === 'POST' && reviewMatch) {
      const body = await readJson(request);
      const resolved = resolveReviewItem(database, workspace.id, decodeURIComponent(reviewMatch[1]), body);
      if (!resolved) throw new AppError('review_item_not_found', 'Пункт проверки не найден или уже закрыт.', 404);
      return sendJson(response, 200, { status: 'resolved' });
    }
    if (method === 'GET' && path === '/api/search') {
      const query = url.searchParams.get('q') || '';
      return sendJson(response, 200, { query, items: search(database, workspace.id, query, integerParam(url.searchParams.get('limit'), 50, 200)) });
    }
    throw new AppError('route_not_found', 'Маршрут не найден.', 404);
  };
}
