import { AppError } from '../../../packages/core/src/errors.mjs';
import { newId } from '../../../packages/core/src/ids.mjs';
import { createAssistantEngine } from '../../../packages/ai/src/assistant-tasks.mjs';
import {
  assistantCandidateSources, saveAssistantRun, listAssistantRuns, getAssistantRun, deleteAssistantRuns
} from '../../../packages/ai/src/assistant-history.mjs';
import {
  loadLlmSettings,
  saveLlmSettings,
  testLlmConnection,
  loadCustomPrompts,
  saveSingleCustomPrompt,
  deleteCustomPrompt,
  toggleFavoritePrompt,
  installPromptPack,
  DEFAULT_PROMPTS_PACK
} from '../../../packages/ai/src/llm-config-store.mjs';
import { buildDocumentSemanticGraph, searchAllDocumentEntities } from '../../../packages/storage/src/document-graph.mjs';
import { searchFaceted, sourceMeta } from '../../../packages/storage/src/faceted-search.mjs';
import { ensureSearchIndexUpToDate, sanitizeSearchQuery, extractSubstantiveQuery, rebuildSearchIndex } from '../../../packages/storage/src/search.mjs';
import { canReadSearchResult } from '../../../packages/access-control/src/service.mjs';
import { resolveReviewItem } from '../../../packages/storage/src/reviews.mjs';
import { STANDARD_AGENDA_TOPICS } from '../../../packages/protocols/src/meeting-agenda.mjs';
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
      return Boolean(!context?.enabled || (context?.authenticated && (context.role === 'admin'
        || (context.personId && meeting.created_by_person_id === context.personId))));
    }
  }
  return canReadSearchResult(database, workspaceId, context, item);
}

async function resolveSingleReviewSuggestion(database, engine, workspaceId, reviewId, customText = '') {
  const review = database.get('SELECT * FROM review_items WHERE workspace_id = ? AND id = ?', workspaceId, reviewId);
  if (!review) return null;

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

  if (!sourceText && customText) {
    sourceText = String(customText);
  }

  const issueCode = String(review.issue_code || '');
  let targetField = 'дата заседания (в формате YYYY-MM-DD)';
  if (issueCode.includes('date') || issueCode.includes('year')) {
    targetField = 'дата заседания (в формате YYYY-MM-DD)';
  } else if (issueCode.includes('number') || issueCode.includes('protocol')) {
    targetField = 'номер протокола';
  } else if (issueCode.includes('agenda')) {
    targetField = 'пункты повестки дня';
  } else if (issueCode.includes('chairperson') || issueCode.includes('chairman')) {
    targetField = 'председатель заседания (ФИО)';
  } else if (issueCode.includes('secretary')) {
    targetField = 'секретарь заседания (ФИО)';
  } else if (issueCode.includes('owner') || issueCode.includes('responsible') || issueCode.includes('executor')) {
    targetField = 'ответственный исполнитель (ФИО)';
  } else if (issueCode.includes('period')) {
    targetField = 'учебный период или год';
  } else if (issueCode.includes('ocr') || issueCode.includes('empty') || issueCode.includes('unreadable')) {
    targetField = 'номер и дата протокола';
  }

  const aiRes = await engine.process({
    task: 'field-extract',
    text: sourceText,
    query: targetField
  });

  let val = aiRes.result?.value || '';
  if ((targetField.includes('дата') || issueCode.includes('date') || issueCode.includes('year')) && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const dMatch = val.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (dMatch) {
      val = `${dMatch[3]}-${dMatch[2].padStart(2, '0')}-${dMatch[1].padStart(2, '0')}`;
    } else {
      const ruMonthMatch = val.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
      if (ruMonthMatch) {
        const months = { 'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04', 'мая': '05', 'май': '05', 'июн': '06', 'июл': '07', 'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12' };
        const mKey = ruMonthMatch[2].toLowerCase().slice(0, 3);
        if (months[mKey]) {
          val = `${ruMonthMatch[3]}-${months[mKey]}-${ruMonthMatch[1].padStart(2, '0')}`;
        }
      }
    }
  }

  return {
    reviewId,
    issueCode,
    field: targetField,
    extracted: aiRes.result ? { ...aiRes.result, value: val } : null,
    status: aiRes.status,
    durationMs: aiRes.durationMs
  };
}

function parseHeaderFieldsDeterministic(text) {
  const fields = { protocolNumber: '', meetingDate: '', chairperson: '', secretary: '', attendees: '' };
  if (!text) return fields;

  const numMatch = text.match(/(?:протокол[а-яё]*|заседан[а-яё]*)[^\n\r0-9]{0,50}?(?:№|N|номер|\b)\s*([0-9]+)/iu);
  if (numMatch) fields.protocolNumber = numMatch[1];

  const dateIsoMatch = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/u);
  if (dateIsoMatch) {
    fields.meetingDate = `${dateIsoMatch[1]}-${dateIsoMatch[2].padStart(2, '0')}-${dateIsoMatch[3].padStart(2, '0')}`;
  } else {
    const dateRuMatch = text.match(/(\d{1,2})\s+([а-яё]+)\s+(20\d{2})/iu);
    if (dateRuMatch) {
      const months = { 'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04', 'мая': '05', 'май': '05', 'июн': '06', 'июл': '07', 'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12' };
      const mKey = dateRuMatch[2].toLowerCase().slice(0, 3);
      if (months[mKey]) {
        fields.meetingDate = `${dateRuMatch[3]}-${months[mKey]}-${dateRuMatch[1].padStart(2, '0')}`;
      }
    }
  }

  const chairMatch = text.match(/(?:председатель|председательствующий)[:\s]+([^\n\r,;]{3,80})/iu);
  if (chairMatch) fields.chairperson = chairMatch[1].trim();

  const secMatch = text.match(/(?:секретарь)[:\s]+([^\n\r,;]{3,80})/iu);
  if (secMatch) fields.secretary = secMatch[1].trim();

  const attMatch = text.match(/(?:присутствовали|состав кафедры)[:\s]+([^.\n]{3,300})/iu);
  if (attMatch) fields.attendees = attMatch[1].trim();

  return fields;
}

export function createAssistantRouter({ database, config, logger, engine: customEngine, fetchImpl = fetch }) {
  const dynamicConfig = loadLlmSettings(config?.dataDir, config);
  const effectiveConfig = { ...config, ...dynamicConfig };
  const engine = customEngine || createAssistantEngine({ config: effectiveConfig, fetchImpl });
  const activeTasks = new Map();
  let cachedStatusData = null;
  let cachedStatusTime = 0;
  const STATUS_CACHE_MS = 15000;

  function pruneTasks() {
    const cutoff = Date.now() - 3600000;
    for (const [id, t] of activeTasks.entries()) {
      if (t.startedAt < cutoff) activeTasks.delete(id);
    }
  }

  async function resolveCandidates(task, query, text, request) {
    if (!['archive-query', 'report-synthesis', 'protocol-analysis', 'suggest-agenda', 'compliance-check'].includes(task)) return [];
    try {
      const workspace = workspaceOf(database, request);
      ensureSearchIndexUpToDate(database, workspace.id);
      const rawQuery = String(query || text || '').trim();

      let allowedItems = [];

      // 1. Try substantive domain terms (stripping conversational filler / preamble)
      const { substantiveTerms, cleanedQuery } = extractSubstantiveQuery(rawQuery);
      if (substantiveTerms.length > 0 && cleanedQuery !== rawQuery) {
        const ftsSubstantive = searchFaceted(database, workspace.id, { q: cleanedQuery }, 20);
        allowedItems = (ftsSubstantive?.items || []).filter((item) =>
          canReadResult(database, workspace.id, request.auth || {}, item)
        );
      }

      // 2. If substantive search produced nothing, try raw query search
      if (allowedItems.length === 0 && rawQuery) {
        const ftsRaw = searchFaceted(database, workspace.id, { q: rawQuery }, 20);
        allowedItems = (ftsRaw?.items || []).filter((item) =>
          canReadResult(database, workspace.id, request.auth || {}, item)
        );
      }

      // 3. If strict search didn't find anything, try an OR query across substantive or non-stop words
      if (allowedItems.length === 0 && rawQuery) {
        const termsToUse = substantiveTerms.length > 0
          ? substantiveTerms
          : sanitizeSearchQuery(rawQuery).terms;

        if (termsToUse && termsToUse.length > 0) {
          const orQuery = termsToUse.map((token) => `${token}*`).join(' OR ');
          try {
            const orFragments = database.all(`
              SELECT
                sf.id, sf.source_kind, sf.source_id, sf.document_version_id,
                sf.title, sf.content, snippet(search_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
                sf.locator_json, bm25(search_fts) AS rank
              FROM search_fts
              JOIN search_fragments sf ON sf.id = search_fts.fragment_id
              WHERE search_fts MATCH ? AND sf.workspace_id = ?
              ORDER BY rank
              LIMIT 15
            `, orQuery, workspace.id);

            allowedItems = orFragments.filter((item) =>
              canReadResult(database, workspace.id, request.auth || {}, item)
            );
          } catch {}
        }
      }

      // 4. If still no items found from search, provide recent documents / meetings as fallback context
      if (allowedItems.length === 0) {
        const fallbackRows = database.all(`
          SELECT sf.id, sf.source_kind, sf.source_id, sf.document_version_id,
            sf.title, sf.content, substr(sf.content, 1, 300) AS snippet, sf.locator_json, 0 AS rank
          FROM search_fragments sf
          WHERE sf.workspace_id = ?
          ORDER BY sf.created_at DESC
          LIMIT 10
        `, workspace.id);
        allowedItems = fallbackRows.filter((item) =>
          canReadResult(database, workspace.id, request.auth || {}, item)
        );
      }

      return allowedItems.map((item) => {
        const fullContent = item.content || database.get(
          'SELECT content FROM search_fragments WHERE id = ?',
          item.id
        )?.content || '';
        const meta = item.meta || (item.source_kind && item.source_id ? sourceMeta(database, workspace.id, item.source_kind, item.source_id) : null);
        return {
          id: item.source_id,
          kind: item.source_kind,
          title: item.title,
          snippet: item.snippet,
          text: fullContent ? fullContent.slice(0, 2500) : item.snippet,
          date: item.event_date || meta?.date || null,
          number: item.number || meta?.number || null,
          documentVersionId: item.document_version_id || null,
          locator: item.locator_json || null
        };
      });
    } catch (err) {
      if (logger) logger.warn(`${task} candidates failed`, { error: err.message });
      return [];
    }
  }

  function historyContext(request) {
    return { workspaceId: workspaceOf(database, request).id, context: request.auth };
  }

  function persistAssistantResult(request, task, promptText, candidates, payload, id = newId('airun')) {
    if (!database) return { runId: null, historySaved: false };
    try {
      const workspace = workspaceOf(database, request);
      saveAssistantRun(database, {
        workspaceId: workspace.id, context: request.auth, id, task, promptText,
        status: payload.status, result: payload.result, rawResponse: payload.rawResponse,
        sources: candidates,
        error: payload.error || payload.message || null, durationMs: payload.durationMs
      });
      return { runId: id, historySaved: true };
    } catch (error) {
      logger?.warn?.('assistant history persistence failed', { error: error.message });
      return { runId: null, historySaved: false };
    }
  }

  return async function assistantRouter(request, response, url) {
    if (database && url.pathname === '/api/assistant/history' && request.method === 'GET') {
      sendJson(response, 200, { ok: true, ...listAssistantRuns(database, {
        ...historyContext(request), limit: url.searchParams.get('limit') || 30,
        cursor: url.searchParams.get('cursor') || ''
      }) });
      return true;
    }
    if (database && url.pathname === '/api/assistant/history' && request.method === 'DELETE') {
      sendJson(response, 200, { ok: true, deleted: deleteAssistantRuns(database, historyContext(request)) });
      return true;
    }
    const historyMatch = url.pathname.match(/^\/api\/assistant\/history\/([^/]+)$/);
    if (database && historyMatch && request.method === 'GET') {
      const entry = getAssistantRun(database, {
        ...historyContext(request), id: decodeURIComponent(historyMatch[1])
      });
      if (!entry) throw new AppError('assistant_run_not_found', 'Запись истории не найдена.', 404);
      sendJson(response, 200, { ok: true, entry });
      return true;
    }
    if (database && historyMatch && request.method === 'DELETE') {
      const deleted = deleteAssistantRuns(database, {
        ...historyContext(request), id: decodeURIComponent(historyMatch[1])
      });
      if (!deleted) throw new AppError('assistant_run_not_found', 'Запись истории не найдена.', 404);
      sendJson(response, 200, { ok: true, deleted });
      return true;
    }

    if (url.pathname === '/api/assistant/status' && request.method === 'GET') {
      const activeConf = engine.config || effectiveConfig;
      const now = Date.now();
      if (cachedStatusData && (now - cachedStatusTime) < STATUS_CACHE_MS) {
        sendJson(response, 200, cachedStatusData);
        return true;
      }
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
          timeoutMs: 8000,
          fetchImpl
        });
      }

      let reportedStatus = connTest.status;
      if (reportedStatus === 'timeout' && cachedStatusData?.status === 'ready' && (now - cachedStatusTime) < 45000) {
        reportedStatus = 'ready';
      }

      const availableModels = connTest.models || cachedStatusData?.models || [];
      const currentModel = activeConf.llmModel || 'local-model';
      const suggestedModel = availableModels.includes(currentModel)
        ? currentModel
        : (availableModels[0] || currentModel);

      cachedStatusData = {
        ok: true,
        enabled: engine.enabled,
        configured: Boolean(activeConf.llmEndpoint),
        endpoint: activeConf.llmEndpoint || '',
        model: currentModel,
        suggestedModel,
        status: reportedStatus,
        latencyMs: connTest.latencyMs || cachedStatusData?.latencyMs || null,
        models: availableModels,
        timeoutMs: activeConf.llmTimeoutMs || 45000,
        maxTokens: activeConf.llmMaxTokens || 4096
      };
      cachedStatusTime = now;

      sendJson(response, 200, cachedStatusData);
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
      const customSystemPrompt = body.customSystemPrompt ? String(body.customSystemPrompt).slice(0, 4000) : undefined;
      const customUserPrompt = body.customUserPrompt ? String(body.customUserPrompt).slice(0, 12000) : undefined;

      const candidates = await resolveCandidates(task, query, text, request);

      const result = await engine.process({
        task,
        text,
        query,
        candidates,
        customSystemPrompt,
        customUserPrompt
      });

      if (logger && result.status !== 'completed' && result.status !== 'disabled') {
        logger.warn('assistant process task status', { task, status: result.status, error: result.error });
      }

      const saved = persistAssistantResult(request, task, text || query, candidates, result);
      const sources = database
        ? assistantCandidateSources(database, workspaceOf(database, request).id, request.auth, candidates)
        : [];
      sendJson(response, 200, { ...result, ...saved, sources });
      return true;
    }

    // Real-time SSE streaming with reasoning and token telemetry
    if (url.pathname === '/api/assistant/stream' && request.method === 'POST') {
      const body = await readJson(request);
      const task = String(body.task || 'table-extract').trim();
      const text = String(body.text || '');
      const query = String(body.query || '');
      const customSystemPrompt = body.customSystemPrompt ? String(body.customSystemPrompt).slice(0, 4000) : undefined;
      const customUserPrompt = body.customUserPrompt ? String(body.customUserPrompt).slice(0, 12000) : undefined;

      const candidates = await resolveCandidates(task, query, text, request);
      const sources = database
        ? assistantCandidateSources(database, workspaceOf(database, request).id, request.auth, candidates)
        : [];
      const promptText = text || query;
      const runId = newId('airun');
      const persist = (payload) => persistAssistantResult(
        request, task, promptText, candidates, payload, runId
      );

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const sendEvent = (event, data) => {
        if (response.writableEnded) return;
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const abortController = new AbortController();
      request.on('aborted', () => abortController.abort());
      response.on?.('close', () => {
        if (!response.writableEnded) abortController.abort();
      });

      if (typeof engine.streamProcess === 'function') {
        await engine.streamProcess({
          task,
          text,
          query,
          candidates,
          customSystemPrompt,
          customUserPrompt,
          signal: abortController.signal,
          onStage: (stage, message) => {
            sendEvent('stage', { stage, message });
          },
          onThinking: (delta, fullText, meta) => {
            sendEvent('thinking', { delta, fullText, meta });
          },
          onToken: (delta, fullText, meta) => {
            sendEvent('token', { delta, fullText, meta });
          },
          onTelemetry: (telemetry) => {
            sendEvent('telemetry', telemetry);
          },
          onDone: (payload) => {
            sendEvent('done', { ...payload, ...persist(payload), sources });
            if (!response.writableEnded) response.end();
          },
          onError: (err) => {
            sendEvent('error', { ...err, ...persist(err) });
            if (!response.writableEnded) response.end();
          }
        });
      } else {
        // Fallback for custom engines without native streamProcess
        sendEvent('stage', { stage: 'generating', message: 'Обработка запроса...' });
        const res = await engine.process({
          task,
          text,
          query,
          candidates,
          customSystemPrompt,
          customUserPrompt,
          signal: abortController.signal
        });
        const raw = res.rawResponse || JSON.stringify(res.result || {});
        sendEvent('token', { delta: raw, fullText: raw, meta: { tokenIndex: 1, tokensPerSec: '20.0' } });
        sendEvent('telemetry', { completionTokens: 20, tokensPerSec: '20.0', elapsedMs: res.durationMs || 100 });
        sendEvent('done', { ...res, ...persist(res), sources });
        if (!response.writableEnded) response.end();
      }

      return true;
    }

    // Async task submission for long-running generation
    if (url.pathname === '/api/assistant/tasks' && request.method === 'POST') {
      pruneTasks();
      const body = await readJson(request);
      const task = String(body.task || 'table-extract').trim();
      const text = String(body.text || '');
      const query = String(body.query || '');
      const customSystemPrompt = body.customSystemPrompt ? String(body.customSystemPrompt).slice(0, 4000) : undefined;
      const customUserPrompt = body.customUserPrompt ? String(body.customUserPrompt).slice(0, 12000) : undefined;

      const taskId = newId('astask');
      const abortController = new AbortController();
      const entry = {
        id: taskId,
        task,
        status: 'running',
        startedAt: Date.now(),
        result: null,
        prompt: null,
        rawResponse: null,
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
            customSystemPrompt,
            customUserPrompt,
            signal: abortController.signal
          });
          entry.result = res.result || null;
          entry.prompt = res.prompt || null;
          entry.rawResponse = res.rawResponse || null;
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
      const res = await resolveSingleReviewSuggestion(database, engine, workspace.id, reviewId, body.text);
      if (!res) {
        throw new AppError('review_not_found', 'Вопрос проверки не найден.', 404);
      }
      sendJson(response, 200, { ok: true, ...res });
      return true;
    }

    // AI-assisted batch review repair (runs in background for multiple review items)
    if (url.pathname === '/api/assistant/review-repair-batch' && request.method === 'POST') {
      const body = await readJson(request);
      const workspace = workspaceOf(database, request);
      let ids = Array.isArray(body.reviewItemIds) ? body.reviewItemIds.map(String) : [];
      if (!ids.length) {
        const openReviews = database.all('SELECT id FROM review_items WHERE workspace_id = ? AND status = \'open\' LIMIT 20', workspace.id);
        ids = openReviews.map((r) => r.id);
      }

      const results = [];
      for (const rId of ids.slice(0, 15)) {
        try {
          const itemRes = await resolveSingleReviewSuggestion(database, engine, workspace.id, rId);
          if (itemRes) results.push(itemRes);
        } catch {}
      }

      sendJson(response, 200, { ok: true, count: results.length, results });
      return true;
    }

    // AI-assisted protocol header extraction for batch edit
    if (url.pathname === '/api/assistant/extract-header' && request.method === 'POST') {
      const body = await readJson(request);
      const documentId = String(body.documentId || '').trim();
      let text = String(body.text || '');

      if (!text && documentId) {
        const doc = database.get(`
          SELECT dv.extracted_text, dv.original_name, d.title
          FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
          WHERE d.id = ?
        `, documentId);
        text = doc?.extracted_text || '';
      }

      const sample = text.slice(0, 3000);
      const deterministic = parseHeaderFieldsDeterministic(sample);

      if (engine.enabled && sample) {
        try {
          const aiRes = await engine.process({
            task: 'field-extract',
            text: sample,
            query: 'шапка протокола: номер, дата (YYYY-MM-DD), председатель, секретарь, присутствовали'
          });
          const val = aiRes.result?.value || '';
          const quote = aiRes.result?.sourceQuote || '';
          const parsed = parseHeaderFieldsDeterministic(`${quote}\n${val}\n${sample}`);
          sendJson(response, 200, {
            ok: true,
            status: 'completed',
            fields: {
              protocolNumber: parsed.protocolNumber || deterministic.protocolNumber,
              meetingDate: parsed.meetingDate || deterministic.meetingDate,
              chairperson: parsed.chairperson || deterministic.chairperson,
              secretary: parsed.secretary || deterministic.secretary,
              attendees: parsed.attendees || deterministic.attendees
            }
          });
          return true;
        } catch {}
      }

      sendJson(response, 200, {
        ok: true,
        status: 'deterministic',
        fields: deterministic
      });
      return true;
    }

    // AI-formulated agenda questions based on monthly schedule, plans and standard topics
    if (url.pathname === '/api/assistant/suggest-agenda' && request.method === 'POST') {
      const body = await readJson(request);
      const workspace = workspaceOf(database, request);
      const meetingId = body.meetingId ? String(body.meetingId).trim() : null;
      let month = body.month ? Number(body.month) : null;
      let year = body.year ? Number(body.year) : null;
      let meeting = null;
      if (meetingId) {
        meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspace.id, meetingId);
        if (meeting?.meeting_date) {
          const parts = meeting.meeting_date.split('-');
          year = Number(parts[0]) || year;
          month = Number(parts[1]) || month;
        }
      }
      if (!year) year = new Date().getFullYear();
      if (!month) month = new Date().getMonth() + 1;

      const planItems = database.all(`
        SELECT pi.id, pi.title, pi.item_no, pi.responsible_raw, p.title AS plan_title
        FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
        WHERE p.workspace_id = ?
        LIMIT 15
      `, workspace.id);

      const recentDecisions = database.all(`
        SELECT d.id, d.text, d.responsible_raw, d.due_date, ai.title AS agenda_title
        FROM decisions d JOIN agenda_items ai ON ai.id = d.agenda_item_id
        JOIN meetings m ON m.id = ai.meeting_id
        WHERE m.workspace_id = ?
        ORDER BY d.created_at DESC LIMIT 10
      `, workspace.id);

      const contextLines = [
        `Заседание кафедры: месяц ${month}, год ${year}.`,
        meeting ? `Название заседания: ${meeting.title || 'Заседание кафедры'}. Протокол № ${meeting.protocol_number || '—'}.` : '',
        'Пункты плана кафедры на учебный год:',
        ...planItems.map((pi, idx) => `${idx + 1}. [${pi.id}] ${pi.title}`),
        recentDecisions.length ? '\nНедавние решения и поручения кафедры:' : '',
        ...recentDecisions.map((rd) => `- По вопросу «${rd.agenda_title}»: ${rd.text} (ответственный: ${rd.responsible_raw || '—'}, срок: ${rd.due_date || '—'})`),
        '\nТиповые вопросы кафедры:',
        ...STANDARD_AGENDA_TOPICS.map((std) => `- [${std.id}] ${std.title} (${std.category})`)
      ].filter(Boolean).join('\n');

      if (engine.enabled) {
        try {
          const aiRes = await engine.process({
            task: 'suggest-agenda',
            text: contextLines,
            query: body.prompt || `Сформируй повестку заседания кафедры на ${month} месяц ${year} года`
          });
          if (aiRes.status === 'completed' && aiRes.result?.topics?.length) {
            sendJson(response, 200, {
              ok: true,
              status: 'completed',
              topics: aiRes.result.topics,
              explanation: aiRes.result.explanation,
              prompt: aiRes.prompt,
              rawResponse: aiRes.rawResponse,
              durationMs: aiRes.durationMs
            });
            return true;
          }
        } catch (err) {
          if (logger) logger.warn('suggest-agenda ai failed, using fallback', { error: err.message });
        }
      }

      // Deterministic fallback based on month and active plan items
      const selectedTopics = [];
      if ([9, 10].includes(month)) {
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_load_plans'));
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_vkr_topics'));
      } else if ([12, 1].includes(month)) {
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_session_results'));
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_nir_articles'));
      } else if ([5, 6].includes(month)) {
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_vkr_topics'));
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_postgraduates'));
      } else {
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_nir_articles'));
        selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_academic_titles'));
      }
      selectedTopics.push(STANDARD_AGENDA_TOPICS.find((t) => t.id === 'std_misc'));

      const fallbackTopics = [];
      let itemNo = 1;
      for (const t of selectedTopics.filter(Boolean)) {
        fallbackTopics.push({
          itemNo: itemNo++,
          title: t.title,
          heardText: t.heardText,
          discussedText: t.discussedText,
          decisionText: t.decisionText,
          speaker: 'Заведующий кафедрой',
          sourceKind: 'standard_template',
          sourceId: t.id
        });
      }
      for (const pi of planItems.slice(0, 2)) {
        fallbackTopics.push({
          itemNo: itemNo++,
          title: `О выполнении пункта плана «${pi.title}»`,
          heardText: `Заслушано сообщение ответственного о ходе выполнения пункта плана кафедры «${pi.title}».`,
          discussedText: 'Вопросов и замечаний не поступило.',
          decisionText: `Принять к сведению информацию о выполнении пункта плана «${pi.title}».`,
          speaker: 'Ответственный по направлению',
          sourceKind: 'plan_item',
          sourceId: pi.id
        });
      }

      sendJson(response, 200, {
        ok: true,
        status: 'fallback',
        topics: fallbackTopics,
        explanation: `Повестка заседания сформирована на ${month}.${year} на основе плана кафедры и календарного цикла.`
      });
      return true;
    }

    // Apply all prepared AI review resolutions in one click
    if (url.pathname === '/api/assistant/review-repair-apply-all' && request.method === 'POST') {
      const body = await readJson(request);
      const workspace = workspaceOf(database, request);
      const resolutions = Array.isArray(body.resolutions)
        ? body.resolutions
        : (Array.isArray(body.items) ? body.items : []);
      let resolvedCount = 0;
      for (const res of resolutions) {
        if (!res.reviewId || typeof res.appliedValue !== 'string') continue;
        const ok = resolveReviewItem(database, workspace.id, res.reviewId, {
          appliedValue: res.appliedValue,
          resolvedVia: 'ai_assistant_bulk'
        });
        if (ok) resolvedCount++;
      }
      sendJson(response, 200, { ok: true, resolvedCount });
      return true;
    }

    // --- PROMPTS SYSTEM & SYNC ---
    if (url.pathname === '/api/assistant/prompts' && request.method === 'GET') {
      const prompts = loadCustomPrompts(config?.dataDir);
      sendJson(response, 200, { ok: true, prompts, defaultCount: DEFAULT_PROMPTS_PACK.length });
      return true;
    }

    if (url.pathname === '/api/assistant/prompts' && request.method === 'POST') {
      const body = await readJson(request);
      const saved = saveSingleCustomPrompt(config?.dataDir, body);
      sendJson(response, 200, { ok: true, prompt: saved });
      return true;
    }

    if (url.pathname === '/api/assistant/prompts/toggle-favorite' && request.method === 'POST') {
      const body = await readJson(request);
      const updated = toggleFavoritePrompt(config?.dataDir, body?.id);
      sendJson(response, 200, { ok: Boolean(updated), prompt: updated });
      return true;
    }

    if (url.pathname.startsWith('/api/assistant/prompts/') && request.method === 'DELETE') {
      const id = url.pathname.slice('/api/assistant/prompts/'.length);
      deleteCustomPrompt(config?.dataDir, id);
      sendJson(response, 200, { ok: true, id });
      return true;
    }

    if (url.pathname === '/api/assistant/prompts/install' && request.method === 'POST') {
      const body = await readJson(request);
      const res = installPromptPack(config?.dataDir, body);
      sendJson(response, 200, { ok: true, ...res });
      return true;
    }

    // --- DOCUMENT SEMANTIC GRAPH & GLOBAL ENTITY SEARCH ---
    if ((url.pathname === '/api/documents/graph' || url.pathname === '/api/assistant/document-graph') && request.method === 'GET') {
      const workspace = workspaceOf(database, request);
      const graph = buildDocumentSemanticGraph(database, workspace.id, {
        query: url.searchParams.get('query') || url.searchParams.get('q') || '',
        type: url.searchParams.get('type') || '',
        focusId: url.searchParams.get('focusId') || '',
        limit: Number(url.searchParams.get('limit') || 150)
      });
      sendJson(response, 200, graph);
      return true;
    }

    if ((url.pathname === '/api/documents/search-all' || url.pathname === '/api/assistant/search-all') && request.method === 'GET') {
      const workspace = workspaceOf(database, request);
      const q = url.searchParams.get('query') || url.searchParams.get('q') || '';
      const results = searchAllDocumentEntities(database, workspace.id, q, Number(url.searchParams.get('limit') || 30));
      sendJson(response, 200, { ok: true, results });
      return true;
    }

    // --- TEMPLATE PARSING & VARIABLE EXTRACTION VIA LLM ---
    if (url.pathname === '/api/assistant/template-analyze' && request.method === 'POST') {
      const body = await readJson(request);
      const workspace = workspaceOf(database, request);
      let documentText = String(body.text || '').trim();

      if (!documentText && body.meetingId) {
        const meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspace.id, body.meetingId);
        if (meeting) {
          const agenda = database.all('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no', meeting.id);
          const lines = [
            `ПРОТОКОЛ № ${meeting.protocol_number || '1'} заседания кафедры от ${meeting.meeting_date || '2026-10-15'}.`,
            `Председатель: ${meeting.chairperson_raw || 'Зав. кафедрой'}.`,
            `Секретарь: ${meeting.secretary_raw || 'Секретарь кафедры'}.`,
            meeting.quorum_required ? `Кворум: ${meeting.quorum_required}.` : '',
            'Повестка дня:'
          ];
          agenda.forEach((a, idx) => {
            lines.push(`${idx + 1}. ${a.title}`);
            if (a.heard_text) lines.push(`СЛУШАЛИ: ${a.heard_text}`);
            if (a.discussed_text) lines.push(`ОБСУДИЛИ: ${a.discussed_text}`);
            if (a.decision_text) lines.push(`ПОСТАНОВИЛИ: ${a.decision_text}`);
          });
          documentText = lines.filter(Boolean).join('\n');
        }
      } else if (!documentText && body.documentId) {
        const doc = database.get('SELECT current_version_id, title FROM documents WHERE workspace_id = ? AND id = ?', workspace.id, body.documentId);
        if (doc?.current_version_id) {
          const ver = database.get('SELECT extracted_text FROM document_versions WHERE id = ?', doc.current_version_id);
          documentText = ver?.extracted_text || doc.title || '';
        }
      }

      if (!documentText) {
        documentText = 'ПРОТОКОЛ № 1 заседания кафедры от 15.10.2026.\nПредседатель: проф. Иванов И.И.\nСекретарь: доц. Петрова А.С.\nКворум: 18 из 20 членов кафедры.\nПовестка дня:\n1. О распределении учебной нагрузки на весенний семестр.\nСЛУШАЛИ: зав. кафедрой о плане часов.\nПОСТАНОВИЛИ: нагрузку утвердить.';
      }

      if (engine.enabled) {
        try {
          const aiRes = await engine.process({
            task: 'template-analyze',
            text: documentText,
            customSystemPrompt: body.customSystemPrompt
          });
          if (aiRes.status === 'completed' && aiRes.result?.fields?.length) {
            sendJson(response, 200, {
              ok: true,
              status: 'completed',
              summary: aiRes.result.summary,
              fields: aiRes.result.fields,
              templateRecommendation: aiRes.result.templateRecommendation,
              prompt: aiRes.prompt,
              rawResponse: aiRes.rawResponse,
              durationMs: aiRes.durationMs
            });
            return true;
          }
        } catch (err) {
          if (logger) logger.warn('template-analyze ai failed, using fallback', { error: err.message });
        }
      }

      // Offline deterministic heuristic fallback
      const fallbackFields = [];
      const numMatch = /(?:протокол\s*№|№)\s*([\p{L}\p{N}./-]+)/iu.exec(documentText);
      if (numMatch) {
        fallbackFields.push({
          key: 'protocol_number',
          label: 'Номер протокола',
          sampleValue: numMatch[1],
          suggestedMarker: '{{PROTOCOL_NUMBER}}',
          scope: 'document',
          isRepeating: false,
          confidence: 0.95,
          reason: 'Номер в заголовке протокола'
        });
      }

      const dateMatch = /(?:дата|от)\s*:?\s*([0-3]?\d(?:[.\s-]+)[^\n]{3,30})/iu.exec(documentText);
      if (dateMatch) {
        fallbackFields.push({
          key: 'meeting_date',
          label: 'Дата заседания',
          sampleValue: dateMatch[1].trim(),
          suggestedMarker: '{{MEETING_DATE}}',
          scope: 'document',
          isRepeating: false,
          confidence: 0.92,
          reason: 'Дата проведения заседания'
        });
      }

      const chairMatch = /председатель\s*:?\s*([^\n,.]+)/iu.exec(documentText);
      if (chairMatch) {
        fallbackFields.push({
          key: 'chairperson',
          label: 'Председатель',
          sampleValue: chairMatch[1].trim(),
          suggestedMarker: '{{CHAIRPERSON}}',
          scope: 'document',
          isRepeating: false,
          confidence: 0.94,
          reason: 'ФИО председателя заседания'
        });
      }

      const secMatch = /секретар[ьия]\s*:?\s*([^\n,.]+)/iu.exec(documentText);
      if (secMatch) {
        fallbackFields.push({
          key: 'secretary',
          label: 'Секретарь',
          sampleValue: secMatch[1].trim(),
          suggestedMarker: '{{SECRETARY}}',
          scope: 'document',
          isRepeating: false,
          confidence: 0.94,
          reason: 'ФИО секретаря заседания'
        });
      }

      const quorumMatch = /кворум\s*:?\s*([^\n.]+)/iu.exec(documentText);
      if (quorumMatch) {
        fallbackFields.push({
          key: 'quorum',
          label: 'Кворум',
          sampleValue: quorumMatch[1].trim(),
          suggestedMarker: '{{QUORUM}}',
          scope: 'document',
          isRepeating: false,
          confidence: 0.90,
          reason: 'Данные о явке и кворуме'
        });
      }

      // Agenda repeating fields
      fallbackFields.push({
        key: 'item_no',
        label: 'Номер вопроса повестки',
        sampleValue: '1',
        suggestedMarker: '{{ITEM_NO}}',
        scope: 'agenda',
        isRepeating: true,
        confidence: 0.95,
        reason: 'Порядковый номер вопроса'
      });
      fallbackFields.push({
        key: 'title',
        label: 'Наименование вопроса',
        sampleValue: 'О распределении учебной нагрузки',
        suggestedMarker: '{{AGENDA_TITLE}}',
        scope: 'agenda',
        isRepeating: true,
        confidence: 0.95,
        reason: 'Заголовок вопроса повестки'
      });
      fallbackFields.push({
        key: 'heard',
        label: 'Слушали (докладчик и тезисы)',
        sampleValue: 'Заслушано сообщение о плане часов',
        suggestedMarker: '{{HEARD}}',
        scope: 'agenda',
        isRepeating: true,
        confidence: 0.93,
        reason: 'Текст раздела «СЛУШАЛИ»'
      });
      fallbackFields.push({
        key: 'decision',
        label: 'Постановили / Решили',
        sampleValue: 'Нагрузку утвердить и передать в деканат',
        suggestedMarker: '{{DECISION}}',
        scope: 'agenda',
        isRepeating: true,
        confidence: 0.95,
        reason: 'Текст принятого постановления кафедры'
      });

      sendJson(response, 200, {
        ok: true,
        status: 'fallback',
        summary: 'Выявлены 9 стандартных полей документа (общие реквизиты и повторяющийся блок повестки)',
        fields: fallbackFields,
        templateRecommendation: 'Рекомендуется использовать полужирные заголовки {{ITEM_NO}}. {{AGENDA_TITLE}} и блоки СЛУШАЛИ / ПОСТАНОВИЛИ по ГОСТ Р 7.0.97-2016.'
      });
      return true;
    }

    return false;
  };
}
