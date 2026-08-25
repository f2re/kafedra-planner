import { basename } from 'node:path';
import { AppError } from '../../../packages/core/src/errors.mjs';
import { detectFormat } from '../../../packages/document-intake/src/formats.mjs';
import { storeIncomingStream } from '../../../packages/document-intake/src/blob-store.mjs';
import { registerDocument } from '../../../packages/storage/src/documents.mjs';
import {
  assertObjectAccess,
  ensureObjectPolicy,
  resolveObjectAccess
} from '../../../packages/access-control/src/service.mjs';
import {
  attachDirectiveMaterial,
  createDirectiveArchiveEntry,
  detachDirectiveMaterial,
  getDirectiveArchiveEntry,
  getDirectiveMaterialFile,
  listDirectiveArchive,
  updateDirectiveArchiveEntry
} from '../../../packages/directive-archive/src/service.mjs';
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

function decodeHeaderValue(value) {
  if (typeof value !== 'string') return '';
  try { return decodeURIComponent(value); } catch { return value; }
}

function header(request, name) {
  return decodeHeaderValue(String(request.headers[name.toLowerCase()] || '')).trim();
}

function integerParam(value, fallback = 300, max = 1000) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function archiveFilters(url) {
  return {
    q: url.searchParams.get('q') || '',
    from: url.searchParams.get('from') || '',
    to: url.searchParams.get('to') || '',
    kind: url.searchParams.get('kind') || '',
    direction: url.searchParams.get('direction') || '',
    status: url.searchParams.get('status') || '',
    report: url.searchParams.get('report') || '',
    limit: integerParam(url.searchParams.get('limit'))
  };
}

function mappedError(error) {
  const code = String(error?.message || error);
  const known = {
    directive_date_invalid: ['Дата должна быть в формате ГГГГ-ММ-ДД.', 400],
    directive_source_not_found: ['Исходный документ распоряжения не найден.', 404],
    directive_title_required: ['Укажите название распоряжения.', 400],
    directive_material_document_not_found: ['Отчётный документ не найден.', 404],
    directive_material_assignment_invalid: ['Выбранное поручение не относится к этому распоряжению.', 400],
    directive_material_title_required: ['Укажите название отчётного материала.', 400]
  };
  if (!known[code]) return error;
  return new AppError(code, known[code][0], known[code][1]);
}

function assertDirectiveAccess(database, workspaceId, context, directiveId, action = 'read') {
  if (!context?.enabled) return true;
  return assertObjectAccess(database, workspaceId, context, 'directive', directiveId, action);
}

function visibleArchive(database, workspaceId, context, payload) {
  if (!context?.enabled) return payload;
  const items = (payload.items || []).filter((item) =>
    resolveObjectAccess(database, workspaceId, context, 'directive', item.id).allowed
  );
  return {
    ...payload,
    items,
    total: items.length,
    stats: {
      withMaterials: items.filter((item) => item.material_count > 0).length,
      withoutMaterials: items.filter((item) => item.material_count === 0).length,
      dated: items.filter((item) => item.issued_at).length
    },
    facets: {
      kinds: [...new Set(items.map((item) => item.directive_kind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
      directions: [...new Set(items.map((item) => item.direction).filter(Boolean))].sort(),
      years: [...new Set(items.map((item) => String(item.issued_at || '').slice(0, 4)).filter((value) => /^\d{4}$/u.test(value)))].sort().reverse()
    }
  };
}

async function acceptFile(request, config, requestedType, fallbackTitle = '') {
  const encodedName = requireHeader(request, 'x-file-name', 'Передайте имя файла в заголовке X-File-Name.');
  const originalName = basename(decodeHeaderValue(encodedName));
  const mediaType = String(request.headers['content-type'] || 'application/octet-stream').split(';', 1)[0];
  const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
    ? request.headers['idempotency-key'].trim()
    : null;
  const blob = await storeIncomingStream(request, {
    blobDir: config.blobDir,
    tempDir: config.tempDir,
    maxBytes: config.maxUploadBytes,
    mediaType
  });
  return { originalName, mediaType, idempotencyKey, blob, title: fallbackTitle || originalName.replace(/\.[^.]+$/, '') || originalName, requestedType };
}

export function createDirectiveArchiveRouter({ database, config, logger }) {
  return async function routeDirectiveArchive(request, response, url, requestId) {
    const method = request.method || 'GET';
    const path = url.pathname;
    if (!path.startsWith('/api/directive-archive')) return false;

    const workspace = workspaceOf(database, request);
    const context = request.auth;

    if (method === 'GET' && path === '/api/directive-archive') {
      const payload = listDirectiveArchive(database, workspace.id, archiveFilters(url));
      return sendJson(response, 200, visibleArchive(database, workspace.id, context, payload));
    }

    if (method === 'POST' && path === '/api/directive-archive') {
      const number = header(request, 'x-directive-number');
      const issuedAt = header(request, 'x-directive-date');
      const title = header(request, 'x-directive-title');
      if (!number) throw new AppError('directive_number_required', 'Укажите номер распоряжения.', 400);
      if (!issuedAt) throw new AppError('directive_date_required', 'Укажите дату распоряжения.', 400);
      if (!title) throw new AppError('directive_title_required', 'Укажите название распоряжения.', 400);

      const intake = await acceptFile(request, config, 'directive', title);
      const document = registerDocument(database, {
        workspaceId: workspace.id,
        title: intake.title,
        originalName: intake.originalName,
        mediaType: intake.mediaType,
        detectedFormat: detectFormat(intake.originalName, intake.mediaType),
        blob: intake.blob,
        requestedType: intake.requestedType,
        idempotencyKey: intake.idempotencyKey
      });
      if (context?.enabled) {
        ensureObjectPolicy(database, {
          workspaceId: workspace.id,
          objectKind: 'document',
          objectId: document.documentId,
          ownerPersonId: context.personId || null,
          accessScope: 'restricted'
        });
      }
      let item;
      try {
        item = createDirectiveArchiveEntry(database, {
          workspaceId: workspace.id,
          documentVersionId: document.versionId,
          documentNumber: number,
          issuedAt,
          title,
          directiveKind: header(request, 'x-directive-kind') || 'Распоряжение',
          direction: header(request, 'x-directive-direction') || 'organizational',
          summary: header(request, 'x-directive-summary') || null,
          issuerRaw: header(request, 'x-directive-issuer') || null
        });
      } catch (error) {
        throw mappedError(error);
      }
      if (context?.enabled) {
        ensureObjectPolicy(database, {
          workspaceId: workspace.id,
          objectKind: 'directive',
          objectId: item.id,
          ownerPersonId: context.personId || null,
          accessScope: 'restricted'
        });
      }
      logger.info('directive archive entry accepted', {
        requestId, workspaceId: workspace.id, directiveId: item.id,
        documentId: document.documentId, versionId: document.versionId
      });
      return sendJson(response, document.duplicateRequest ? 200 : 201, { item, document });
    }

    const materialContentMatch = path.match(/^\/api\/directive-archive\/([^/]+)\/materials\/([^/]+)\/content$/u);
    if (['GET', 'HEAD'].includes(method) && materialContentMatch) {
      const directiveId = decodeURIComponent(materialContentMatch[1]);
      const materialId = decodeURIComponent(materialContentMatch[2]);
      assertDirectiveAccess(database, workspace.id, context, directiveId, 'read');
      const file = getDirectiveMaterialFile(database, workspace.id, directiveId, materialId);
      if (!file) throw new AppError('directive_material_not_found', 'Отчётный материал не найден.', 404);
      return sendFile(request, response, file.path, {
        mediaType: file.media_type,
        fileName: file.file_name,
        sizeBytes: file.size_bytes,
        etag: file.sha256,
        disposition: file.media_type === 'application/pdf' || String(file.media_type || '').startsWith('image/')
          ? 'inline' : 'attachment'
      });
    }

    const materialMatch = path.match(/^\/api\/directive-archive\/([^/]+)\/materials\/([^/]+)$/u);
    if (method === 'DELETE' && materialMatch) {
      const directiveId = decodeURIComponent(materialMatch[1]);
      const materialId = decodeURIComponent(materialMatch[2]);
      assertDirectiveAccess(database, workspace.id, context, directiveId, 'edit');
      const item = detachDirectiveMaterial(database, workspace.id, directiveId, materialId);
      if (!item) throw new AppError('directive_material_not_found', 'Отчётный материал не найден.', 404);
      return sendJson(response, 200, { item });
    }

    const materialsMatch = path.match(/^\/api\/directive-archive\/([^/]+)\/materials$/u);
    if (method === 'POST' && materialsMatch) {
      const directiveId = decodeURIComponent(materialsMatch[1]);
      assertDirectiveAccess(database, workspace.id, context, directiveId, 'edit');
      const intake = await acceptFile(request, config, 'directive_report_material', header(request, 'x-material-title'));
      const document = registerDocument(database, {
        workspaceId: workspace.id,
        title: intake.title,
        originalName: intake.originalName,
        mediaType: intake.mediaType,
        detectedFormat: detectFormat(intake.originalName, intake.mediaType),
        blob: intake.blob,
        requestedType: intake.requestedType,
        idempotencyKey: intake.idempotencyKey
      });
      if (context?.enabled) {
        ensureObjectPolicy(database, {
          workspaceId: workspace.id,
          objectKind: 'document',
          objectId: document.documentId,
          ownerPersonId: context.personId || null,
          accessScope: 'restricted'
        });
      }
      let item;
      try {
        item = attachDirectiveMaterial(database, workspace.id, directiveId, {
          documentId: document.documentId,
          assignmentId: header(request, 'x-assignment-id') || null,
          kind: header(request, 'x-material-kind') || 'report',
          title: header(request, 'x-material-title') || intake.title,
          materialDate: header(request, 'x-material-date') || null,
          note: header(request, 'x-material-note') || null
        });
      } catch (error) {
        throw mappedError(error);
      }
      if (!item) throw new AppError('directive_not_found', 'Распоряжение не найдено.', 404);
      logger.info('directive report material attached', {
        requestId, workspaceId: workspace.id, directiveId, documentId: document.documentId
      });
      return sendJson(response, document.duplicateRequest ? 200 : 201, { item, document });
    }

    const directiveMatch = path.match(/^\/api\/directive-archive\/([^/]+)$/u);
    if (directiveMatch) {
      const directiveId = decodeURIComponent(directiveMatch[1]);
      if (method === 'GET') {
        assertDirectiveAccess(database, workspace.id, context, directiveId, 'read');
        const item = getDirectiveArchiveEntry(database, workspace.id, directiveId);
        if (!item) throw new AppError('directive_not_found', 'Распоряжение не найдено.', 404);
        return sendJson(response, 200, { item });
      }
      if (method === 'PATCH') {
        assertDirectiveAccess(database, workspace.id, context, directiveId, 'edit');
        let item;
        try { item = updateDirectiveArchiveEntry(database, workspace.id, directiveId, await readJson(request)); }
        catch (error) { throw mappedError(error); }
        if (!item) throw new AppError('directive_not_found', 'Распоряжение не найдено.', 404);
        return sendJson(response, 200, { item });
      }
    }

    return false;
  };
}
