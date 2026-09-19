import { createHash } from 'node:crypto';
import { prepareSearchTask, validateSearchExpansion } from './search-tasks.mjs';

export const SEARCH_ASSISTANT_VERSION = 'search-evidence-v1';
const MAX_CANDIDATES = 12;
const MAX_SUGGESTIONS = 5;
const MAX_RESPONSE_BYTES = 32_768;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = (value) => String(value || '').replace(/<\/?mark>/gu, '').replace(/\s+/gu, ' ').trim();
const ownKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

// The caller supplies only CURRENT, authorized search results. Never retrieve by model-generated IDs.
export function searchAssistantCandidates(items) {
  const candidates = [];
  const seen = new Set();
  for (const item of items || []) {
    if (!item?.source_kind || !item?.source_id || !item.route) continue;
    const id = `${item.source_kind}:${item.source_id}`;
    const text = plain(item.snippet).slice(0, 600);
    if (seen.has(id) || text.length < 16) continue;
    seen.add(id);
    candidates.push({
      id, title: plain(item.title).slice(0, 160), text,
      status: plain(item.status).slice(0, 40), date: plain(item.event_date).slice(0, 32),
      number: plain(item.number).slice(0, 64), version: plain(item.document_version_id).slice(0, 80),
      locator: String(item.locator_json || '').slice(0, 200)
    });
    if (candidates.length === MAX_CANDIDATES) break;
  }
  return candidates;
}

export function validateSearchSuggestions(content, candidates) {
  if (typeof content !== 'string' || content.length > MAX_RESPONSE_BYTES) throw new Error('invalid_response');
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  let output;
  try { output = JSON.parse(fenced ? fenced[1] : trimmed); } catch { throw new Error('invalid_response'); }
  if (!ownKeys(output, ['suggestions']) || !Array.isArray(output.suggestions)
    || output.suggestions.length > MAX_SUGGESTIONS) throw new Error('invalid_response');
  const allowed = new Map(candidates.map((item) => [item.id, item]));
  const seen = new Set();
  return output.suggestions.map((item) => {
    if (!ownKeys(item, ['id', 'quote']) || typeof item.id !== 'string' || typeof item.quote !== 'string'
      || seen.has(item.id) || item.quote.length < 16 || item.quote.length > 240
      || !allowed.get(item.id)?.text.includes(item.quote)) throw new Error('unverified_source');
    seen.add(item.id);
    return { id: item.id, quote: item.quote };
  });
}

async function limitedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('response_too_large');
  }
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('response_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}

function endpointFor(config) {
  try {
    const url = new URL(config.llmEndpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    url.pathname = `${url.pathname.replace(/\/$/u, '').replace(/\/v1$/u, '')}/v1/chat/completions`;
    return url.href;
  } catch { return null; }
}

/** Ephemeral, read-only assistance. A restart discards suggestions, never business records. */
export function createSearchAssistant({ config = {}, fetchImpl = fetch, now = Date.now,
  timeoutMs = Math.min(config.llmTimeoutMs || 45_000, 30_000), ttlMs = 120_000,
  cooldownMs = 60_000, maxEntries = 64, maxQueued = 8 } = {}) {
  const entries = new Map();
  const latest = new Map();
  const generations = new Map();
  const queue = [];
  const endpoint = endpointFor(config);
  let active = null;
  let cooldownUntil = 0;
  let structured = true;

  function prune() {
    for (const [scope, state] of generations) if (state.expiresAt <= now()) generations.delete(scope);
    for (const [key, entry] of entries) {
      if (entry !== active && (entry.expiresAt <= now() || entry.status === 'cancelled')) entries.delete(key);
    }
    for (const [scope, key] of latest) if (!entries.has(key)) latest.delete(scope);
    for (let index = queue.length - 1; index >= 0; index--) {
      if (!entries.has(queue[index].key) || queue[index].status !== 'queued') queue.splice(index, 1);
    }
  }

  function snapshot(entry, retrieve) {
    let material = entry.material;
    if (material && ['ready', 'partial'].includes(entry.status) && retrieve) {
      material = retrieve(entry.queries);
      if (digest(searchAssistantCandidates(material.items)) !== entry.materialHash) {
        entries.delete(entry.key);
        return { status: 'idle', suggestions: [] };
      }
    }
    return { status: entry.status, task: SEARCH_ASSISTANT_VERSION,
      suggestions: ['ready', 'partial'].includes(entry.status) ? entry.suggestions.map((item) => ({ ...item })) : [],
      retryAfterMs: ['queued', 'running'].includes(entry.status) ? 1500 : 0,
      ...(material && ['ready', 'partial'].includes(entry.status)
        ? { items: material.items, relatedQueries: material.relatedQueries, tasks: entry.tasks } : {}) };
  }

  async function completeTask(id, input, signal, entry) {
    const task = prepareSearchTask(id, input, config);
    const body = task.body;
    if (structured) body.response_format = { type: 'json_object', schema: task.schema };
    const send = () => fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    let response = await send();
    if ([400, 422].includes(response.status) && body.response_format) {
      await response.body?.cancel();
      structured = false;
      delete body.response_format;
      response = await send();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('unavailable');
    }
    const payload = await limitedJson(response);
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === 'length' || choice?.message?.tool_calls?.length) throw new Error('invalid_response');
    entry.tasks.push(task.metadata);
    return { content: choice?.message?.content, candidates: task.candidates };
  }

  async function generate(entry, signal) {
    if (entry.retrieve) {
      const expanded = await completeTask('search-expand', { query: entry.query, filters: entry.filters }, signal, entry);
      entry.queries = validateSearchExpansion(expanded.content, { query: entry.query, filters: entry.filters });
      if (signal.aborted) throw new Error('cancelled');
      // Refresh source state and permissions AFTER expansion, before sending any document text.
      entry.material = entry.retrieve(entry.queries);
      entry.candidates = searchAssistantCandidates(entry.material.items);
      entry.materialHash = digest(entry.candidates);
      if (!entry.candidates.length) return [];
    }
    try {
      const result = await completeTask('search-evidence', {
        query: entry.query, filters: entry.filters, candidates: entry.candidates
      }, signal, entry);
      return validateSearchSuggestions(result.content, result.candidates);
    } catch (error) {
      if (entry.material?.items.length && !signal.aborted) {
        // Useful retrieved materials survive a rejected quotation; nothing is applied as a fact.
        entry.partial = true;
        cooldownUntil = now() + cooldownMs;
        return [];
      }
      throw error;
    }
  }

  async function pump() {
    prune();
    if (active) return;
    if (cooldownUntil > now()) {
      for (const entry of queue.splice(0)) {
        entry.status = 'unavailable';
        entry.expiresAt = cooldownUntil;
      }
      return;
    }
    const entry = queue.shift();
    if (!entry) return;
    active = entry;
    entry.status = 'running';
    entry.controller = new AbortController();
    const signal = entry.controller.signal;
    let deadline;
    const aborted = new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error(entry.status === 'cancelled' ? 'cancelled' : 'timeout')), { once: true });
      deadline = setTimeout(() => entry.controller.abort(), timeoutMs);
      deadline.unref?.();
    });
    try {
      const suggestions = await Promise.race([generate(entry, signal), aborted]);
      if (!signal.aborted && latest.get(entry.scope) === entry.key) {
        entry.suggestions = suggestions;
        entry.status = entry.partial ? 'partial' : 'ready';
      }
    } catch (error) {
      if (entry.status !== 'cancelled') {
        entry.status = entry.material?.items.length ? 'partial'
          : ['invalid_response', 'unverified_source', 'response_too_large'].includes(error?.message)
            ? 'rejected' : 'unavailable';
        cooldownUntil = now() + cooldownMs;
      }
    } finally {
      clearTimeout(deadline);
      entry.controller = null;
      entry.retrieve = null;
      entry.expiresAt = now() + (['rejected', 'unavailable'].includes(entry.status) ? cooldownMs : ttlMs);
      active = null;
      queueMicrotask(pump);
    }
  }

  function cancelScope(scope, exceptKey, generation = null) {
    for (const entry of entries.values()) {
      if (entry.scope !== scope || entry.key === exceptKey || !['queued', 'running'].includes(entry.status)
        || (generation !== null && entry.generation !== generation)) continue;
      entry.status = 'cancelled';
      entry.controller?.abort();
    }
  }

  return {
    enabled: Boolean(config.llmEnabled && endpoint),
    request({ scope, query = '', filters = {}, items = [], retrieve = null }, { start = false, cancel = false, generation = '' } = {}) {
      if (!config.llmEnabled || !endpoint) return { status: 'disabled', suggestions: [] };
      prune();
      const scopeKey = digest(scope);
      const number = /^\d{1,12}$/u.test(generation) ? Number(generation) : null;
      const previous = generations.get(scopeKey);
      if (number !== null && previous && (number < previous.number || number === previous.number && previous.cancelled && !cancel)) {
        return { status: 'cancelled', suggestions: [] };
      }
      if ((start || cancel) && number !== null) {
        if (generations.size >= maxEntries * 2 && !generations.has(scopeKey)) generations.delete(generations.keys().next().value);
        generations.set(scopeKey, { number, cancelled: cancel, expiresAt: now() + ttlMs });
      }
      if (cancel) {
        cancelScope(scopeKey, undefined, generation);
        return { status: 'cancelled', suggestions: [] };
      }
      const candidates = searchAssistantCandidates(items);
      const safeQuery = String(query).slice(0, 500);
      const safeFilters = Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))
        .filter(([name]) => ['sourceKind', 'kind', 'number', 'from', 'to', 'direction', 'person', 'role', 'status', 'period', 'report'].includes(name))
        .map(([name, value]) => [name, String(value || '').slice(0, 120)]));
      const key = digest([scopeKey, SEARCH_ASSISTANT_VERSION, config.llmModel, safeQuery, safeFilters, candidates]);
      if (start) {
        cancelScope(scopeKey, key);
        latest.set(scopeKey, key);
      }
      if ((!candidates.length && !retrieve) || safeQuery.trim().length < 3) {
        latest.delete(scopeKey);
        return { status: 'empty', suggestions: [] };
      }
      const cached = entries.get(key);
      if (cached) {
        if (start) cached.generation = generation;
        return snapshot(cached, retrieve);
      }
      if (!start) return { status: 'idle', suggestions: [] };
      if (cooldownUntil > now()) return { status: 'unavailable', suggestions: [], retryAfterMs: cooldownUntil - now() };
      if (queue.filter((entry) => entry.status === 'queued').length >= maxQueued) return { status: 'busy', suggestions: [] };
      if (entries.size >= maxEntries) {
        const evict = [...entries.values()].find((entry) => !['queued', 'running'].includes(entry.status));
        if (!evict) return { status: 'busy', suggestions: [] };
        entries.delete(evict.key);
      }
      const entry = { key, scope: scopeKey, query: safeQuery, filters: safeFilters, candidates,
        status: 'queued', suggestions: [], expiresAt: now() + ttlMs, controller: null, generation,
        retrieve, queries: [], tasks: [], material: null, partial: false };
      entries.set(key, entry);
      latest.set(scopeKey, key);
      queue.push(entry);
      queueMicrotask(pump);
      return snapshot(entry);
    },
    close() {
      for (const entry of entries.values()) {
        entry.status = 'cancelled';
        entry.controller?.abort();
      }
      queue.length = 0;
      entries.clear();
      latest.clear();
      generations.clear();
    }
  };
}
