import { AppError } from '../../../packages/core/src/errors.mjs';
import { createAssistantEngine } from '../../../packages/ai/src/assistant-tasks.mjs';
import { searchFaceted } from '../../../packages/storage/src/faceted-search.mjs';
import { canReadSearchResult } from '../../../packages/access-control/src/service.mjs';
import { readJson, sendJson } from './http-utils.mjs';

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

function canReadResult(database, workspaceId, context, item) {
  if (['meeting', 'decision'].includes(item.source_kind)) {
    const meeting = item.source_kind === 'meeting'
      ? database.get('SELECT source_document_version_id, created_by_person_id FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, item.source_id)
      : database.get(`SELECT m.source_document_version_id, m.created_by_person_id
          FROM decisions d JOIN agenda_items ai ON ai.id = d.agenda_item_id
          JOIN meetings m ON m.id = ai.meeting_id WHERE m.workspace_id = ? AND d.id = ?`, workspaceId, item.source_id);
    if (!meeting) return false;
    if (!meeting.source_document_version_id) {
      return Boolean(context.authenticated && (!context.enabled || context.role === 'admin'
        || (context.personId && meeting.created_by_person_id === context.personId)));
    }
  }
  return canReadSearchResult(database, workspaceId, context, item);
}

export function createAssistantRouter({ database, config, logger, engine: customEngine }) {
  const engine = customEngine || createAssistantEngine({ config });

  return async function assistantRouter(request, response, url) {
    if (url.pathname === '/api/assistant/status' && request.method === 'GET') {
      sendJson(response, 200, {
        enabled: engine.enabled,
        configured: Boolean(config?.llmEndpoint),
        model: config?.llmModel || 'local-model'
      });
      return true;
    }

    if (url.pathname === '/api/assistant/process' && request.method === 'POST') {
      const body = await readJson(request);
      const task = String(body.task || 'table-extract').trim();
      const text = String(body.text || '');
      const query = String(body.query || '');

      let candidates = [];
      if (task === 'archive-query') {
        const workspace = workspaceOf(database, request);
        const searchQuery = query || text;
        const ftsResults = searchFaceted(database, workspace.id, {
          q: searchQuery,
          sourceKind: 'meeting'
        }, 12);

        const allowedItems = (ftsResults?.items || []).filter((item) =>
          canReadResult(database, workspace.id, request.auth || {}, item)
        );

        candidates = allowedItems.map((item) => ({
          id: item.source_id,
          title: item.title,
          snippet: item.snippet,
          date: item.event_date,
          number: item.number
        }));
      }

      const result = await engine.process({
        task,
        text,
        query,
        candidates
      });

      if (logger && result.status !== 'completed' && result.status !== 'disabled') {
        logger.warn('assistant process task status', { task, status: result.status, error: result.error });
      }

      sendJson(response, 200, result);
      return true;
    }

    return false;
  };
}
