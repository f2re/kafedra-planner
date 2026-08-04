import { basename } from 'node:path';
import { newId } from '../../../packages/core/src/ids.mjs';
import { AppError } from '../../../packages/core/src/errors.mjs';
import { detectFormat } from '../../../packages/document-intake/src/formats.mjs';
import { storeIncomingStream } from '../../../packages/document-intake/src/blob-store.mjs';
import { registerDocument, listDocuments, getDocument } from '../../../packages/storage/src/documents.mjs';
import { listCalendarItems } from '../../../packages/calendar/src/service.mjs';
import { listReviewItems, resolveReviewItem } from '../../../packages/storage/src/reviews.mjs';
import { getOverview } from '../../../packages/storage/src/overview.mjs';
import { systemHealth } from '../../../packages/storage/src/system.mjs';
import { search } from '../../../packages/storage/src/search.mjs';
import { readJson, requireHeader, sendJson } from './http-utils.mjs';

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
          limit: integerParam(url.searchParams.get('limit'), 500, 2000)
        })
      });
    }
    if (method === 'POST' && path === '/api/calendar') {
      const body = await readJson(request);
      if (!body.title || !body.startsAt) throw new AppError('calendar_fields_required', 'Укажите название и дату события.', 400);
      const now = new Date().toISOString();
      const id = newId('cal');
      database.run(`
        INSERT INTO calendar_items(
          id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
          all_day, category, importance, status, description, created_at, updated_at
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
      `, id, workspace.id, id, body.title, body.startsAt, body.endsAt ?? null,
      body.allDay === false ? 0 : 1, body.category || 'everyday', body.importance || 'normal',
      body.description || null, now, now);
      return sendJson(response, 201, { id });
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
