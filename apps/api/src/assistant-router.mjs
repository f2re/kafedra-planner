import { AppError } from '../../../packages/core/src/errors.mjs';
import { createAssistantEngine } from '../../../packages/ai/src/assistant-tasks.mjs';
import { loadLlmSettings, saveLlmSettings, testLlmConnection } from '../../../packages/ai/src/llm-config-store.mjs';
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

export function createAssistantRouter({ database, config, logger, engine: customEngine, fetchImpl = fetch }) {
  const dynamicConfig = loadLlmSettings(config?.dataDir, config);
  const effectiveConfig = { ...config, ...dynamicConfig };
  const engine = customEngine || createAssistantEngine({ config: effectiveConfig, fetchImpl });

  return async function assistantRouter(request, response, url) {
    if (url.pathname === '/api/assistant/status' && request.method === 'GET') {
      const activeConf = engine.config || effectiveConfig;
      let connTest = {
        ok: false,
        status: !activeConf.llmEnabled ? 'disabled' : !activeConf.llmEndpoint ? 'misconfigured' : 'checking',
        latencyMs: null,
        models: []
      };

      if (activeConf.llmEnabled && activeConf.llmEndpoint) {
        connTest = await testLlmConnection({
          endpoint: activeConf.llmEndpoint,
          model: activeConf.llmModel,
          apiKey: activeConf.llmApiKey,
          timeoutMs: 3000,
          fetchImpl
        });
      }

      sendJson(response, 200, {
        ok: true,
        enabled: engine.enabled,
        configured: Boolean(activeConf.llmEndpoint),
        endpoint: activeConf.llmEndpoint || '',
        model: activeConf.llmModel || 'local-model',
        status: connTest.status,
        latencyMs: connTest.latencyMs,
        models: connTest.models || [],
        timeoutMs: activeConf.llmTimeoutMs || 45000,
        maxTokens: activeConf.llmMaxTokens || 4096
      });
      return true;
    }

    if (url.pathname === '/api/assistant/test-connection' && request.method === 'POST') {
      const body = await readJson(request);
      const endpoint = String(body.endpoint || '').trim();
      const model = String(body.model || '').trim();
      const apiKey = String(body.apiKey || '').trim();
      const timeoutMs = Math.min(Number(body.timeoutMs || 5000), 15000);

      const result = await testLlmConnection({
        endpoint,
        model,
        apiKey,
        timeoutMs,
        fetchImpl
      });

      sendJson(response, 200, result);
      return true;
    }

    if (url.pathname === '/api/assistant/config' && request.method === 'POST') {
      const body = await readJson(request);
      const saved = saveLlmSettings(config?.dataDir, {
        llmEnabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
        llmEndpoint: body.endpoint !== undefined ? String(body.endpoint).trim() : undefined,
        llmModel: body.model !== undefined ? String(body.model).trim() : undefined,
        llmApiKey: body.apiKey !== undefined ? String(body.apiKey).trim() : undefined,
        llmTimeoutMs: body.timeoutMs !== undefined ? Number(body.timeoutMs) : undefined,
        llmMaxTokens: body.maxTokens !== undefined ? Number(body.maxTokens) : undefined
      }, config);

      if (typeof engine.updateConfig === 'function') {
        engine.updateConfig(saved);
      }

      let connTest = { status: !saved.llmEnabled ? 'disabled' : 'ready', latencyMs: null, models: [] };
      if (saved.llmEnabled && saved.llmEndpoint) {
        connTest = await testLlmConnection({
          endpoint: saved.llmEndpoint,
          model: saved.llmModel,
          apiKey: saved.llmApiKey,
          timeoutMs: 4000,
          fetchImpl
        });
      }

      sendJson(response, 200, {
        ok: true,
        saved: {
          enabled: saved.llmEnabled,
          endpoint: saved.llmEndpoint,
          model: saved.llmModel,
          timeoutMs: saved.llmTimeoutMs,
          maxTokens: saved.llmMaxTokens
        },
        connection: connTest
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
