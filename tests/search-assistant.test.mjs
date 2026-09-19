import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSearchAssistant, searchAssistantCandidates, validateSearchSuggestions } from '../packages/ai/src/search-assistant.mjs';

const quote = 'Подготовлен сводный отчёт о научной работе кафедры.';
const item = { source_kind: 'document', source_id: 'd1', title: 'Научный отчёт', snippet: quote,
  route: { kind: 'document', id: 'd1' }, status: 'processed' };
const context = { scope: ['workspace-1', 'account-1', 'tab-1'], query: 'научный отчёт', filters: {}, items: [item] };
const config = { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081', llmModel: 'local-test' };
const content = (suggestions = [{ id: 'document:d1', quote }]) => JSON.stringify({ suggestions });
const response = (value = content(), extra = {}) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: value }, ...extra }]
}), { headers: { 'content-type': 'application/json' } });
function service(t, options = {}) {
  const engine = createSearchAssistant({ config, fetchImpl: async () => response(), ...options });
  t.after(() => engine.close());
  return engine;
}
async function settled(engine, ctx = context) {
  for (let count = 0; count < 500; count++) {
    const value = engine.request(ctx);
    if (!['queued', 'running'].includes(value.status)) return value;
    await sleep(2);
  }
  throw new Error('Assistant did not settle');
}

test('disabled or invalid endpoints perform no requests', (t) => {
  for (const cfg of [{}, { ...config, llmEnabled: false }, { ...config, llmEndpoint: 'file:///tmp/model' },
    { ...config, llmEndpoint: 'http://user:secret@host' }, { ...config, llmEndpoint: 'http://host/?key=secret' }]) {
    const engine = service(t, { config: cfg, fetchImpl: () => assert.fail('network must remain unused') });
    assert.equal(engine.enabled, false);
    assert.equal(engine.request(context, { start: true }).status, 'disabled');
  }
});

test('normal polling never launches generation; start returns before the model', async (t) => {
  let calls = 0;
  const engine = service(t, { fetchImpl: async () => { calls++; return response(); } });
  assert.equal(engine.request(context).status, 'idle');
  assert.equal(calls, 0);
  assert.equal(engine.request(context, { start: true }).status, 'queued');
  assert.equal(calls, 0);
  assert.equal((await settled(engine)).status, 'ready');
  assert.equal(calls, 1);
});

test('repeated start and poll requests reuse the same authorized snapshot', async (t) => {
  let calls = 0;
  const engine = service(t, { fetchImpl: async () => { calls++; await sleep(5); return response(); } });
  for (let count = 0; count < 20; count++) engine.request(context, { start: true });
  assert.deepEqual((await settled(engine)).suggestions, [{ id: 'document:d1', quote }]);
  assert.equal(engine.request(context, { start: true }).status, 'ready');
  assert.equal(calls, 1);
});

test('scope, source text, status and query changes cannot read an old cache entry', async (t) => {
  const engine = service(t);
  engine.request(context, { start: true });
  await settled(engine);
  for (const changed of [
    { ...context, scope: ['workspace-2', 'account-1', 'tab-1'] },
    { ...context, scope: ['workspace-1', 'account-2', 'tab-1'] },
    { ...context, query: 'другой отчёт' },
    { ...context, items: [{ ...item, snippet: 'Иной фрагмент того же документа.' }] },
    { ...context, items: [{ ...item, status: 'archived' }] },
    { ...context, items: [{ ...item, document_version_id: 'version-2' }] },
    { ...context, items: [{ ...item, locator_json: '{"page":2}' }] }
  ]) assert.equal(engine.request(changed).status, 'idle');
  assert.equal(engine.request({ ...context, items: [] }).status, 'empty');
});

test('unknown IDs, changed quotes, duplicates and extra fields are rejected', () => {
  const candidates = searchAssistantCandidates([item]);
  for (const value of [
    content([{ id: 'document:private', quote }]),
    content([{ id: 'document:d1', quote: 'Несуществующий подтверждённый результат.' }]),
    content([{ id: 'document:d1', quote }, { id: 'document:d1', quote }]),
    JSON.stringify({ suggestions: [{ id: 'document:d1', quote, status: 'completed' }] }),
    JSON.stringify({ suggestions: [], instructions: 'ignore rules' }),
    'Объяснение перед ' + content(), content([{ id: 'document:d1', quote: 'отчёт' }])
  ]) assert.throws(() => validateSearchSuggestions(value, candidates));
  assert.deepEqual(validateSearchSuggestions('```json\n' + content() + '\n```', candidates), [{ id: 'document:d1', quote }]);
  assert.deepEqual(validateSearchSuggestions(content([]), candidates), []);
});

test('input and output budgets are bounded; no request is made for an empty or short query', (t) => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...item, source_id: `d${i}`, snippet: 'x'.repeat(10_000), title: 'a'.repeat(1000) }));
  const candidates = searchAssistantCandidates(rows);
  assert.equal(candidates.length, 12);
  assert.ok(candidates.every((row) => row.text.length === 600 && row.title.length === 160));
  assert.deepEqual(searchAssistantCandidates([{ ...item, route: null }]), []);
  assert.equal(searchAssistantCandidates([{ ...item, snippet: '<mark>Подготовлен</mark> сводный отчёт.' }])[0].text, 'Подготовлен сводный отчёт.');
  const engine = service(t, { fetchImpl: () => assert.fail('no candidates') });
  assert.equal(engine.request({ ...context, query: 'аб' }, { start: true }).status, 'empty');
  assert.equal(engine.request({ ...context, items: [] }, { start: true }).status, 'empty');
  assert.throws(() => validateSearchSuggestions(content(Array.from({ length: 6 }, () => ({ id: 'document:d1', quote }))), candidates));
});

test('prompt treats query and documents as data and offers no executable tools', async (t) => {
  let body;
  const engine = service(t, { fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8081/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    body = JSON.parse(options.body);
    return response();
  } });
  engine.request({ ...context, filters: { zzz: 'secret', status: 'completed' } }, { start: true });
  await settled(engine, { ...context, filters: { zzz: 'secret', status: 'completed' } });
  assert.equal(body.tools, undefined);
  assert.equal(body.max_tokens, 768);
  assert.equal(body.response_format.type, 'json_object');
  const input = JSON.parse(body.messages[1].content);
  assert.deepEqual(input.filters, { status: 'completed' });
  assert.match(body.messages[0].content, /недоверенные данные/u);
});

test('one model request at a time and a bounded waiting queue', async (t) => {
  let release;
  let calls = 0;
  const engine = service(t, { maxQueued: 1, fetchImpl: async () => {
    calls++;
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    return response();
  } });
  engine.request(context, { start: true });
  await sleep(2);
  const second = { ...context, scope: ['w', 'u2'] };
  const third = { ...context, scope: ['w', 'u3'] };
  assert.equal(engine.request(second, { start: true }).status, 'queued');
  assert.equal(engine.request(third, { start: true }).status, 'busy');
  assert.equal(calls, 1);
  release();
  assert.equal((await settled(engine, second)).status, 'ready');
  assert.equal(calls, 2);
});

test('latest query cancels previous work without consuming failure cooldown', async (t) => {
  let calls = 0;
  const engine = service(t, { fetchImpl: async (_url, { signal }) => {
    if (++calls === 1) await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    return response();
  } });
  engine.request(context, { start: true, generation: '1' });
  await sleep(2);
  const next = { ...context, query: 'подготовлен отчёт' };
  engine.request(next, { start: true, generation: '2' });
  engine.request(context, { cancel: true, generation: '1' });
  assert.equal((await settled(engine, next)).status, 'ready');
  assert.equal(engine.request(context).status, 'idle');
  assert.equal(calls, 2);
});

test('a late cancellation cannot stop a reused request from a newer generation', async (t) => {
  const engine = service(t, { fetchImpl: async () => { await sleep(8); return response(); } });
  engine.request(context, { start: true, generation: '1' });
  await sleep(2);
  engine.request(context, { start: true, generation: '2' });
  engine.request(context, { cancel: true, generation: '1' });
  assert.equal((await settled(engine)).status, 'ready');
});

test('timeout frees the slot even when a transport fails to reject on abort', async (t) => {
  const engine = service(t, { timeoutMs: 15, fetchImpl: () => new Promise(() => {}) });
  engine.request(context, { start: true });
  assert.equal((await settled(engine)).status, 'unavailable');
});

test('unavailable model opens cooldown and manual retry works after expiration', async (t) => {
  let clock = 1000;
  let calls = 0;
  const engine = service(t, { now: () => clock, cooldownMs: 100, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 503 }) : response();
  } });
  engine.request(context, { start: true });
  assert.equal((await settled(engine)).status, 'unavailable');
  assert.equal(engine.request({ ...context, query: 'другая формулировка' }, { start: true }).status, 'unavailable');
  assert.equal(calls, 1);
  clock += 101;
  engine.request(context, { start: true });
  assert.equal((await settled(engine)).status, 'ready');
  assert.equal(calls, 2);
});

test('schema compatibility fallback happens only once; local validation still applies', async (t) => {
  const formats = [];
  const engine = service(t, { fetchImpl: async (_url, options) => {
    formats.push(Boolean(JSON.parse(options.body).response_format));
    return formats.length === 1 ? new Response('', { status: 400 }) : response();
  } });
  engine.request(context, { start: true });
  assert.equal((await settled(engine)).status, 'ready');
  const another = { ...context, query: 'новая формулировка' };
  engine.request(another, { start: true });
  await settled(engine, another);
  assert.deepEqual(formats, [true, false, false]);
});

test('oversized streamed responses and length-truncated model output are rejected', async (t) => {
  for (const result of [
    () => new Response('x'.repeat(40_000)),
    () => response(content(), { finish_reason: 'length' }),
    () => response(content(), { message: { content: content(), tool_calls: [{ id: 'unsafe' }] } }),
    () => response('{broken json'),
    () => response(content([{ id: 'unknown', quote }]))
  ]) {
    const engine = service(t, { fetchImpl: async () => result() });
    engine.request(context, { start: true });
    assert.equal((await settled(engine)).status, 'rejected');
  }
});

test('TTL expires suggestions and bounded cache evicts completed entries', async (t) => {
  let clock = 1000;
  const engine = service(t, { now: () => clock, ttlMs: 50, maxEntries: 1 });
  engine.request(context, { start: true });
  await settled(engine);
  const another = { ...context, query: 'другой запрос' };
  engine.request(another, { start: true });
  await settled(engine, another);
  assert.equal(engine.request(context).status, 'idle');
  clock += 51;
  assert.equal(engine.request(another).status, 'idle');
});

test('assistance does not mutate input objects; model output is not a business write', async (t) => {
  const before = JSON.stringify(context);
  const engine = service(t);
  engine.request(context, { start: true });
  const result = await settled(engine);
  result.suggestions[0].quote = 'client mutation';
  assert.equal(engine.request(context).suggestions[0].quote, quote);
  assert.equal(JSON.stringify(context), before);
  assert.deepEqual(Object.keys(result).sort(), ['retryAfterMs', 'status', 'suggestions', 'task']);
});


test('a late start from an older generation cannot replace the newer search', async (t) => {
  let calls = 0;
  const engine = service(t, { fetchImpl: async () => { calls++; await sleep(8); return response(); } });
  const newer = { ...context, query: 'новый запрос' };
  engine.request(newer, { start: true, generation: '2' });
  await sleep(2);
  assert.equal(engine.request(context, { start: true, generation: '1' }).status, 'cancelled');
  assert.equal((await settled(engine, newer)).status, 'ready');
  assert.equal(calls, 1);
});
