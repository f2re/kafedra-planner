import { AppError } from '../../../packages/core/src/errors.mjs';
import { managesPerson } from '../../../packages/auth/src/policy.mjs';
import { getPeriodicTaskV2 } from '../../../packages/work-management/src/periodic-tasks.mjs';
import {
  attachPeriodicTaskReport,
  reviewPeriodicTaskReport
} from '../../../packages/work-management/src/periodic-task-reports-optional.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function visible(database, workspace, context, task) {
  if (!context?.enabled || context.role === 'admin') return true;
  if ([task.owner_person_id, task.manager_person_id].includes(context.personId)) return true;
  return context.role === 'manager' && task.owner_person_id
    && managesPerson(database, workspace, context.personId, task.owner_person_id);
}

function canReview(database, workspace, context, task) {
  if (!context?.enabled || context.role === 'admin') return true;
  if (task.manager_person_id === context.personId) return true;
  return context.role === 'manager' && task.owner_person_id
    && managesPerson(database, workspace, context.personId, task.owner_person_id);
}

function mapped(error) {
  const code = String(error?.message || error);
  if (code === 'periodic_report_document_required') return new AppError(code, 'Выберите отчётный документ.', 400);
  if (code === 'periodic_report_document_not_found') return new AppError(code, 'Отчётный документ не найден.', 404);
  if (code === 'periodic_report_document_not_ready') return new AppError(code, 'Отчётный документ ещё обрабатывается. Дождитесь завершения.', 409);
  if (code === 'periodic_report_review_action_invalid') return new AppError(code, 'Допустимы подтверждение или пометка материала на доработку.', 400);
  if (code === 'periodic_report_evidence_missing') return new AppError(code, 'Нет материала, ожидающего проверки.', 409);
  if (code === 'periodic_report_already_reviewed') return new AppError(code, 'Этот материал уже проверен.', 409);
  return error;
}

export function createPeriodicTaskEvidenceRouter({ database }) {
  return async function routePeriodicTaskEvidence(request, response, url) {
    if ((request.method || 'GET') !== 'POST') return false;
    const match = url.pathname.match(/^\/api\/periodic-tasks\/([^/]+)\/(report|review)$/u);
    if (!match) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const taskId = decodeURIComponent(match[1]);
    const task = getPeriodicTaskV2(database, workspace, taskId);
    if (!task) throw new AppError('periodic_task_not_found', 'Периодическая задача не найдена.', 404);
    const context = request.auth || { enabled: false };
    if (!visible(database, workspace, context, task)) {
      throw new AppError('periodic_task_scope_forbidden', 'Нет доступа к этой задаче.', 403);
    }
    if (match[2] === 'review' && !canReview(database, workspace, context, task)) {
      throw new AppError('periodic_report_review_forbidden', 'Проверить материал может только руководитель.', 403);
    }
    try {
      const body = await readJson(request);
      const result = match[2] === 'report'
        ? attachPeriodicTaskReport(database, workspace, taskId, body, { actorPersonId: context.personId || null })
        : reviewPeriodicTaskReport(database, workspace, taskId, body, { actorPersonId: context.personId || null });
      return sendJson(response, 200, result);
    } catch (error) {
      throw mapped(error);
    }
  };
}
