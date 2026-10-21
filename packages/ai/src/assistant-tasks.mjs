import { createHash } from 'node:crypto';

export const ASSISTANT_VERSION = 'assistant-tools-v1';
const MAX_RESPONSE_BYTES = 65_536;
const MAX_INPUT_CHARS = 12_000;

export function sanitizeInputText(rawText, maxChars = MAX_INPUT_CHARS) {
  if (typeof rawText !== 'string') return '';
  let text = rawText
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')
    // Remove repeated page markers like "Страница 1 из 5"
    .replace(/(?:^|\n)\s*(?:Страница|Стр\.?)\s+\d+(?:\s*(?:из|\/)\s*\d+)?\s*(?=\n|$)/giu, '\n')
    // Collapse multiple empty lines
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastBoundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
    text = (lastBoundary > maxChars * 0.7 ? cut.slice(0, lastBoundary) : cut).trim() + '…';
  }
  return text;
}

export const ASSISTANT_TASKS = Object.freeze({
  'table-extract': Object.freeze({
    id: 'table-extract',
    maxTokens: 2048,
    system: [
      'Ты — аналитический помощник кафедры.',
      'Проанализируй входной текст и структурируй упомянутые факты (протоколы, решения, поручения со сроками и исполнителями, статьи, публикации или списки персон) в виде таблицы.',
      'Верни строго один JSON-объект без форматирования Markdown и без вступительного текста вида:',
      '{"title":"Название таблицы","columns":[{"id":"col1","label":"Колонка 1","type":"text"}],"rows":[{"col1":"значение"}]}.',
      'Допустимые type для columns: "text", "date", "number".',
      'Не выдумывай факты, сохраняй исходные формулировки.',
      'Если данных для таблицы нет, верни {"title":"Данные не найдены","columns":[],"rows":[]}.'
    ].join(' ')
  }),

  'formula-calc': Object.freeze({
    id: 'formula-calc',
    maxTokens: 1024,
    system: [
      'Ты — эксперт по формулам и расчётам в LibreOffice Calc и Microsoft Excel.',
      'По запросу пользователя составь формулу или правило условного форматирования.',
      'Используй русские названия функций (ВПР, СУММЕСЛИМН, СЧЁТЕСЛИМН, ЕСЛИ, ИНДЕКС, ПОИСКПОЗ) и точку с запятой (;) как разделитель аргументов.',
      'Верни строго один JSON-объект без Markdown и вводных слов вида:',
      '{"formula":"=ФОРМУЛА(...)","description":"Краткое описание на русском","steps":["1. Куда вставить","2. Как настроить"],"example":"Пример со значениями"}.'
    ].join(' ')
  }),

  'archive-query': Object.freeze({
    id: 'archive-query',
    maxTokens: 1536,
    system: [
      'Ты — архивариус кафедры.',
      'Сопоставь вопрос пользователя со списком найденных фрагментов заседаний и протоколов.',
      'Определи, в каких заседаниях и пунктах повестки действительно обсуждалась запрашиваемая тема.',
      'Верни строго один JSON-объект без Markdown и вступительных слов вида:',
      '{"summary":"Краткий ответ по существу","matches":[{"meetingId":"...","protocolNumber":"...","meetingDate":"...","itemNumber":"...","itemTitle":"...","quote":"точная цитата из текста"}]}.',
      'quote обязана быть точной выдержкой длиной 16-240 символов из переданного текста фрагмента.',
      'Не выдумывай номера протоколов и цитаты. Если совпадений нет, верни {"summary":"В доступных протоколах тема не упоминается","matches":[]}.'
    ].join(' ')
  }),

  'gap-repair': Object.freeze({
    id: 'gap-repair',
    maxTokens: 2048,
    system: [
      'Ты — эксперт-аналитик документов и заседаний кафедры.',
      'Твоя задача — внимательно изучить предоставленный текст (фрагмент заседания, протокол, приказ, описание ошибки или неполные данные).',
      'Определи:',
      '1) Недостающие или неполные реквизиты (дата заседания, номер пункта повестки, докладчик, решение, срок исполнения, ответственный).',
      '2) Если передан текст с ошибкой — выяви причину и предложи точный способ её исправления.',
      'Для каждого найденного пропуска или исправления обязательно укажи точную цитату (sourceQuote) из переданного текста, которая подтверждает твоё предложение.',
      'Верни строго один JSON-объект без Markdown и лишнего текста вида:',
      '{"summary":"Краткий вывод о пропусках или ошибках","items":[{"field":"Название реквизита","status":"missing|invalid|fixed","currentValue":"...","suggestedValue":"...","sourceQuote":"точная цитата из текста","reason":"почему предлагается"}],"actionableAdvice":"Конкретные шаги оператора"}.',
      'Не выдумывай факты. Если пропусков нет, верни {"summary":"Пропусков и ошибок не обнаружено","items":[],"actionableAdvice":"Все обязательные реквизиты заполнены"}.'
    ].join(' ')
  })
});

export function extractJsonObject(rawContent) {
  if (typeof rawContent !== 'string') return null;
  const text = rawContent.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
  const target = fenced ? fenced[1].trim() : text;
  try {
    const parsed = JSON.parse(target);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // Attempt relaxed recovery of JSON if trailing commas exist
    try {
      const fixed = target.replace(/,\s*([}\]])/gu, '$1');
      const parsed = JSON.parse(fixed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function validateAssistantResult(taskType, payload, extra = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('assistant_invalid_json');
  }

  if (taskType === 'table-extract') {
    const title = String(payload.title || 'Таблица').trim().slice(0, 160);
    const rawCols = Array.isArray(payload.columns) ? payload.columns : [];
    const columns = rawCols
      .filter((c) => c && typeof c === 'object' && c.id && c.label)
      .map((c) => ({
        id: String(c.id).trim().replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 40),
        label: String(c.label).trim().slice(0, 80),
        type: ['date', 'number', 'text'].includes(c.type) ? c.type : 'text'
      }));

    const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
    const colIds = new Set(columns.map((c) => c.id));
    const rows = rawRows
      .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
      .slice(0, 500)
      .map((r) => {
        const row = {};
        for (const [k, v] of Object.entries(r)) {
          if (colIds.has(k) || columns.length === 0) {
            row[k] = v === null || v === undefined ? '' : String(v).trim().slice(0, 2000);
          }
        }
        return row;
      });

    return { type: 'table', title, columns, rows };
  }

  if (taskType === 'formula-calc') {
    const formula = String(payload.formula || '').trim().slice(0, 500);
    const description = String(payload.description || '').trim().slice(0, 1000);
    const rawSteps = Array.isArray(payload.steps) ? payload.steps : [];
    const steps = rawSteps.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 10);
    const example = String(payload.example || '').trim().slice(0, 500);
    return { type: 'formula', formula, description, steps, example };
  }

  if (taskType === 'archive-query') {
    const summary = String(payload.summary || '').trim().slice(0, 1000);
    const rawMatches = Array.isArray(payload.matches) ? payload.matches : [];
    const candidates = Array.isArray(extra.candidates) ? extra.candidates : [];
    const allowedTexts = candidates.map((c) => String(c.text || c.snippet || '').toLocaleLowerCase('ru-RU'));

    const matches = rawMatches
      .filter((m) => m && typeof m === 'object')
      .slice(0, 20)
      .map((m) => {
        const quote = String(m.quote || '').trim().slice(0, 300);
        const normQuote = quote.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
        const isVerified = normQuote.length >= 8 && allowedTexts.some((txt) => txt.includes(normQuote));
        return {
          meetingId: String(m.meetingId || '').slice(0, 80),
          protocolNumber: String(m.protocolNumber || '').slice(0, 40),
          meetingDate: String(m.meetingDate || '').slice(0, 32),
          itemNumber: String(m.itemNumber || '').slice(0, 32),
          itemTitle: String(m.itemTitle || '').slice(0, 200),
          quote,
          verified: isVerified
        };
      });

    return { type: 'archive-matches', summary, matches };
  }

  if (taskType === 'gap-repair') {
    const summary = String(payload.summary || 'Анализ завершён').trim().slice(0, 1000);
    const actionableAdvice = String(payload.actionableAdvice || '').trim().slice(0, 1000);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const sourceText = String(extra.sourceText || '').toLocaleLowerCase('ru-RU');

    const items = rawItems
      .filter((it) => it && typeof it === 'object')
      .slice(0, 30)
      .map((it) => {
        const quote = String(it.sourceQuote || '').trim().slice(0, 300);
        const normQuote = quote.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
        const quoteFound = !sourceText || !normQuote || normQuote.length < 6 || sourceText.includes(normQuote);
        return {
          field: String(it.field || 'Реквизит').trim().slice(0, 100),
          status: ['missing', 'invalid', 'fixed'].includes(it.status) ? it.status : 'missing',
          currentValue: it.currentValue ? String(it.currentValue).trim().slice(0, 500) : null,
          suggestedValue: String(it.suggestedValue || '').trim().slice(0, 500),
          sourceQuote: quote,
          quoteVerified: quoteFound,
          reason: String(it.reason || '').trim().slice(0, 1000)
        };
      });

    return { type: 'gap-repair', summary, items, actionableAdvice };
  }

  throw new Error(`unknown_task_type:${taskType}`);
}

function endpointFor(config) {
  try {
    const raw = String(config?.llmEndpoint || '').trim();
    if (!raw) return null;
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    url.pathname = `${url.pathname.replace(/\/$/u, '').replace(/\/v1$/u, '')}/v1/chat/completions`;
    return url.href;
  } catch {
    return null;
  }
}

export function createAssistantEngine({ config = {}, fetchImpl = fetch, maxCacheEntries = 64, ttlMs = 600_000 } = {}) {
  const cache = new Map();
  let currentConfig = { ...config };
  let endpoint = endpointFor(currentConfig);
  let enabled = Boolean(currentConfig?.llmEnabled && endpoint);

  function updateConfig(newConfig) {
    currentConfig = { ...currentConfig, ...newConfig };
    const newEndpoint = endpointFor(currentConfig);
    if (newEndpoint !== endpoint) {
      cache.clear();
    }
    endpoint = newEndpoint;
    enabled = Boolean(currentConfig?.llmEnabled && endpoint);
    return { enabled, endpoint };
  }

  function getCacheKey(taskType, input) {
    const str = `${taskType}:${JSON.stringify(input)}`;
    return createHash('sha256').update(str).digest('hex');
  }

  function pruneCache() {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > ttlMs) cache.delete(key);
    }
    while (cache.size > maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
      else break;
    }
  }

  async function process({ task, text, query, candidates, signal } = {}) {
    const started = Date.now();
    const taskConfig = ASSISTANT_TASKS[task];
    if (!taskConfig) {
      return { status: 'failed', error: 'unknown_task', durationMs: Date.now() - started };
    }

    if (!enabled) {
      return { status: 'disabled', durationMs: Date.now() - started };
    }

    const cleanText = sanitizeInputText(text);
    const inputPayload = {
      task,
      text: cleanText,
      query: sanitizeInputText(query, 500),
      candidates: Array.isArray(candidates) ? candidates.slice(0, 12) : []
    };

    const cacheKey = getCacheKey(task, inputPayload);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return {
        status: 'completed',
        result: cached.result,
        cached: true,
        durationMs: Date.now() - started
      };
    }

    // Construct prompt
    const userContent = JSON.stringify(inputPayload);
    const maxTokens = Math.min(currentConfig?.llmMaxTokens || 2048, taskConfig.maxTokens);
    const requestBody = {
      model: currentConfig?.llmModel || 'local-model',
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: 'system', content: taskConfig.system },
        { role: 'user', content: userContent }
      ]
    };

    const headers = {
      'content-type': 'application/json',
      'accept': 'application/json'
    };
    if (currentConfig?.llmApiKey) {
      headers.authorization = `Bearer ${currentConfig.llmApiKey}`;
    }

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal
      });

      if (!response.ok) {
        return {
          status: 'failed',
          error: `llm_http_${response.status}`,
          durationMs: Date.now() - started
        };
      }

      const bodyText = await response.text();
      if (Buffer.byteLength(bodyText) > MAX_RESPONSE_BYTES) {
        return { status: 'failed', error: 'response_too_large', durationMs: Date.now() - started };
      }

      let jsonBody;
      try {
        jsonBody = JSON.parse(bodyText);
      } catch {
        return { status: 'failed', error: 'invalid_server_json', durationMs: Date.now() - started };
      }

      const choice = jsonBody?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string') {
        return { status: 'failed', error: 'empty_response', durationMs: Date.now() - started };
      }

      const parsedObj = extractJsonObject(content);
      if (!parsedObj) {
        return {
          status: 'failed',
          error: 'invalid_json_format',
          rawResponse: content.slice(0, 5000),
          durationMs: Date.now() - started
        };
      }

      const validated = validateAssistantResult(task, parsedObj, { candidates, sourceText: cleanText });
      pruneCache();
      cache.set(cacheKey, { result: validated, timestamp: Date.now() });

      return {
        status: 'completed',
        result: validated,
        cached: false,
        durationMs: Date.now() - started
      };
    } catch (error) {
      const name = String(error?.name || '').toLowerCase();
      const isTimeout = name.includes('timeout') || name.includes('abort');
      return {
        status: isTimeout ? 'timeout' : 'unavailable',
        error: error?.message || 'request_failed',
        durationMs: Date.now() - started
      };
    }
  }

  return {
    get enabled() { return enabled; },
    get endpoint() { return endpoint; },
    get config() { return { ...currentConfig }; },
    updateConfig,
    process,
    clearCache: () => cache.clear()
  };
}
