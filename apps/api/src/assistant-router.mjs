import { AppError } from '../../../packages/core/src/errors.mjs';
import { newId } from '../../../packages/core/src/ids.mjs';
import { createAssistantEngine } from '../../../packages/ai/src/assistant-tasks.mjs';
import { loadLlmSettings, saveLlmSettings, testLlmConnection } from '../../../packages/ai/src/llm-config-store.mjs';
import { searchFaceted } from '../../../packages/storage/src/faceted-search.mjs';
import { ensureSearchIndexUpToDate } from '../../../packages/storage/src/search.mjs';
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
  const activeTasks = new Map();

  function pruneTasks() {
    const cutoff = Date.now() - 3600000;
    for (const [id, t] of activeTasks.entries()) {
      if (t.startedAt < cutoff) activeTasks.delete(id);
    }
  }

  async function resolveCandidates(task, query, text, request) {
    if (!['archive-query', 'report-synthesis', 'protocol-analysis'].includes(task)) return [];
    try {
      const workspace = workspaceOf(database, request);
      ensureSearchIndexUpToDate(database, workspace.id);
      const searchQuery = query || text;
      const ftsResults = searchFaceted(database, workspace.id, {
        q: searchQuery,
        sourceKind: 'meeting'
      }, 15);

      const allowedItems = (ftsResults?.items || []).filter((item) =>
        canReadResult(database, workspace.id, request.auth || {}, item)
      );

      return allowedItems.map((item) => ({
        id: item.source_id,
        title: item.title,
        snippet: item.snippet,
        date: item.event_date,
        number: item.number
      }));
    } catch (err) {
      if (logger) logger.warn(`${task} candidates failed`, { error: err.message });
      return [];
    }
  }

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

      const availableModels = connTest.models || [];
      const currentModel = activeConf.llmModel || 'local-model';
      const suggestedModel = availableModels.includes(currentModel)
        ? currentModel
        : (availableModels[0] || currentModel);

      sendJson(response, 200, {
        ok: true,
        enabled: engine.enabled,
        configured: Boolean(activeConf.llmEndpoint),
        endpoint: activeConf.llmEndpoint || '',
        model: currentModel,
        suggestedModel,
        status: connTest.status,
        latencyMs: connTest.latencyMs,
        models: availableModels,
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

      if (!model && result.models?.length > 0) {
        result.selectedModel = result.models[0];
      }

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

      const candidates = await resolveCandidates(task, query, text, request);

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

    // Async task submission for long-running generation
    if (url.pathname === '/api/assistant/tasks' && request.method === 'POST') {
      pruneTasks();
      const body = await readJson(request);
      const task = String(body.task || 'table-extract').trim();
      const text = String(body.text || '');
      const query = String(body.query || '');

      const taskId = newId('astask');
      const abortController = new AbortController();
      const entry = {
        id: taskId,
        task,
        status: 'running',
        startedAt: Date.now(),
        result: null,
        error: null,
        abortController
      };
      activeTasks.set(taskId, entry);

      // Start asynchronous execution without blocking response
      (async () => {
        try {
          const candidates = await resolveCandidates(task, query, text, request);
          const res = await engine.process({
            task,
            text,
            query,
            candidates,
            signal: abortController.signal
          });
          entry.result = res.result || null;
          entry.status = res.status === 'completed' ? 'completed' : res.status;
          entry.error = res.error || null;
          entry.durationMs = res.durationMs || (Date.now() - entry.startedAt);
        } catch (err) {
          entry.status = 'failed';
          entry.error = err.message || 'processing_failed';
          entry.durationMs = Date.now() - entry.startedAt;
        }
      })();

      sendJson(response, 202, {
        ok: true,
        taskId,
        status: 'running',
        startedAt: entry.startedAt
      });
      return true;
    }

    // Intelligent search refinement
    if (url.pathname === '/api/assistant/search-refine' && request.method === 'POST') {
      const body = await readJson(request);
      const query = String(body.query || body.text || '').trim();

      if (!query) {
        sendJson(response, 200, {
          ok: true,
          intent: 'general',
          keywords: [],
          synonyms: [],
          ftsQuery: '',
          timeframe: '',
          explanation: 'Пустой запрос'
        });
        return true;
      }

      if (engine.enabled) {
        const aiRes = await engine.process({
          task: 'search-refine',
          text: query,
          query
        });
        if (aiRes.status === 'completed' && aiRes.result) {
          sendJson(response, 200, {
            ok: true,
            status: 'completed',
            ...aiRes.result
          });
          return true;
        }
      }

      // Fast deterministic fallback if LLM is offline/disabled
      const cleanWords = query
        .replace(/[^\p{L}\p{N}_]/gu, ' ')
        .split(/\s+/gu)
        .map((w) => w.trim().toLocaleLowerCase('ru-RU'))
        .filter((w) => w.length > 2);

      const ftsQuery = cleanWords.slice(0, 6).join(' OR ');
      sendJson(response, 200, {
        ok: true,
        status: 'fallback',
        intent: 'general',
        keywords: cleanWords.slice(0, 8),
        synonyms: [],
        ftsQuery,
        timeframe: '',
        explanation: 'Детерминированное извлечение ключевых слов (LLM офлайн)'
      });
      return true;
    }

    // Task status poll endpoint
    const taskMatch = /^\/api\/assistant\/tasks\/([^/]+)$/.exec(url.pathname);
    if (taskMatch && request.method === 'GET') {
      const taskId = decodeURIComponent(taskMatch[1]);
      const taskEntry = activeTasks.get(taskId);
      if (!taskEntry) {
        throw new AppError('task_not_found', 'Фоновая задача ассистента не найдена.', 404);
      }

      sendJson(response, 200, {
        ok: true,
        taskId: taskEntry.id,
        task: taskEntry.task,
        status: taskEntry.status,
        durationMs: taskEntry.durationMs || (Date.now() - taskEntry.startedAt),
        result: taskEntry.result,
        error: taskEntry.error
      });
      return true;
    }

    if (taskMatch && request.method === 'DELETE') {
      const taskId = decodeURIComponent(taskMatch[1]);
      const taskEntry = activeTasks.get(taskId);
      if (taskEntry) {
        try { taskEntry.abortController?.abort(); } catch {}
        activeTasks.delete(taskId);
      }
      sendJson(response, 200, { ok: true, cancelled: true });
      return true;
    }

    // AI-assisted review repair
    if (url.pathname === '/api/assistant/review-repair' && request.method === 'POST') {
      const body = await readJson(request);
      const reviewId = String(body.reviewItemId || '').trim();
      const workspace = workspaceOf(database, request);
      const review = database.get('SELECT * FROM review_items WHERE workspace_id = ? AND id = ?', workspace.id, reviewId);
      if (!review) {
        throw new AppError('review_not_found', 'Вопрос проверки не найден.', 404);
      }

      let sourceText = '';
      if (review.source_kind === 'document_version') {
        const dv = database.get('SELECT extracted_text FROM document_versions WHERE id = ?', review.source_id);
        sourceText = dv?.extracted_text || '';
      } else if (review.source_kind === 'meeting') {
        const m = database.get('SELECT source_document_version_id FROM meetings WHERE id = ?', review.source_id);
        if (m?.source_document_version_id) {
          const dv = database.get('SELECT extracted_text FROM document_versions WHERE id = ?', m.source_document_version_id);
          sourceText = dv?.extracted_text || '';
        }
      }

      if (!sourceText && body.text) {
        sourceText = String(body.text);
      }

      const issueCode = String(review.issue_code || '');
      let targetField = 'дата заседания';
      if (issueCode.includes('date')) targetField = 'дата заседания (в формате YYYY-MM-DD)';
      else if (issueCode.includes('number') || issueCode.includes('protocol')) targetField = 'номер протокола';
      else if (issueCode.includes('agenda')) targetField = 'пункты повестки';

      const aiRes = await engine.process({
        task: 'field-extract',
        text: sourceText,
        query: targetField
      });

      sendJson(response, 200, {
        ok: true,
        reviewId,
        issueCode,
        field: targetField,
        extracted: aiRes.result || null,
        status: aiRes.status,
        durationMs: aiRes.durationMs
      });
      return true;
    }

    return false;
  };
}
