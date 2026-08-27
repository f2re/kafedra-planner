import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  assertAssignmentAccess,
  assertObjectAccess
} from '../../../packages/access-control/src/service.mjs';
import {
  getAssignmentResponsibility,
  updateAssignmentResponsibility
} from '../../../packages/work-management/src/responsibility.mjs';
import { attachOptionalAssignmentEvidence } from '../../../packages/work-management/src/optional-evidence.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function responsibilityError(error) {
  const code = String(error?.message || error);
  if (code === 'responsibility_reason_required') {
    return new AppError(code, 'Кратко укажите причину изменения ответственности.', 400);
  }
  if (code === 'responsibility_person_invalid') {
    return new AppError(code, 'Один из выбранных сотрудников не найден или недоступен.', 400);
  }
  return error;
}

export function createAssignmentResponsibilityRouter({ database }) {
  return async function routeAssignmentResponsibility(request, response, url) {
    const method = request.method || 'GET';
    const responsibilityMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/responsibility$/);
    const evidenceMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/report$/);
    const removedReviewMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/review$/);
    if (!responsibilityMatch && !evidenceMatch && !removedReviewMatch) return false;

    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);

    if (responsibilityMatch) {
      if (!['GET', 'PUT'].includes(method)) return false;
      const assignmentId = decodeURIComponent(responsibilityMatch[1]);
      if (request.auth?.enabled) {
        assertAssignmentAccess(
          database,
          workspace,
          request.auth,
          assignmentId,
          method === 'GET' ? 'read' : 'control'
        );
      }
      if (method === 'GET') {
        const item = getAssignmentResponsibility(database, workspace, assignmentId);
        if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
        return sendJson(response, 200, item);
      }
      const body = await readJson(request);
      try {
        const item = updateAssignmentResponsibility(database, workspace, assignmentId, body, {
          actorPersonId: request.auth?.personId || null
        });
        if (!item) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
        return sendJson(response, 200, item);
      } catch (error) {
        throw responsibilityError(error);
      }
    }

    const assignmentId = decodeURIComponent((evidenceMatch || removedReviewMatch)[1]);
    if (request.auth?.enabled) {
      assertAssignmentAccess(
        database,
        workspace,
        request.auth,
        assignmentId,
        evidenceMatch ? 'edit' : 'read'
      );
    }

    if (removedReviewMatch) {
      if (method !== 'POST') return false;
      const exists = database.get(
        'SELECT id FROM assignments WHERE workspace_id = ? AND id = ?',
        workspace,
        assignmentId
      );
      if (!exists) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
      throw new AppError(
        'assignment_review_removed',
        'Подтверждение руководителем не требуется. Отметьте задачу выполненной в её карточке.',
        410
      );
    }

    if (method !== 'POST') return false;
    const body = await readJson(request);
    if (!body.documentId) {
      throw new AppError('evidence_document_required', 'Выберите подтверждающий документ или загрузите новый файл.', 400);
    }
    if (request.auth?.enabled) {
      assertObjectAccess(database, workspace, request.auth, 'document', body.documentId, 'read');
    }
    const item = attachOptionalAssignmentEvidence(database, workspace, assignmentId, {
      ...body,
      actorPersonId: request.auth?.personId || null
    });
    if (!item) {
      throw new AppError(
        'assignment_or_evidence_not_found',
        'Поручение или подтверждающий документ не найдены.',
        404
      );
    }
    return sendJson(response, 200, item);
  };
}
