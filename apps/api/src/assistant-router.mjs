import { AppError } from '../../../packages/core/src/errors.mjs';
import { newId } from '../../../packages/core/src/ids.mjs';
import { createAssistantEngine } from '../../../packages/ai/src/assistant-tasks.mjs';
import { loadLlmSettings, saveLlmSettings, testLlmConnection } from '../../../packages/ai/src/llm-config-store.mjs';
import { searchFaceted } from '../../../packages/storage/src/faceted-search.mjs';
import { ensureSearchIndexUpToDate } from '../../../packages/storage/src/search.mjs';
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
      return Boolean(context.authenticated && (!context.enabled || context.role === 'admin'
        || (context.personId && meeting.created_by_person_id === context.personId)));
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
    if (!['archive-query', 'report-synthesis', 'protocol-analysis', 'suggest-agenda'].includes(task)) return [];
    try {
      const workspace = workspaceOf(database, request);
      ensureSearchIndexUpToDate(database, workspace.id);
      const searchQuery = query || text;
      const ftsResults = searchFaceted(database, workspace.id, {
        q: searchQuery
      }, 20);

      const allowedItems = (ftsResults?.items || []).filter((item) =>
        canReadResult(database, workspace.id, request.auth || {}, item)
      );

      return allowedItems.map((item) => ({
        id: item.source_id,
        kind: item.source_kind,
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

    return false;
  };
}
