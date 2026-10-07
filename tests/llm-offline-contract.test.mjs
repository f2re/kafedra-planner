import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { proposeDirectiveWithLlama, extractJsonObject } from '../packages/ai/src/llama-client.mjs';
import { prepareDirectiveTask, DIRECTIVE_TASK } from '../packages/ai/src/directive-task.mjs';
import { prepareSearchTask } from '../packages/ai/src/search-tasks.mjs';
import { runLlmAcceptance } from '../scripts/llm-acceptance.mjs';

const source = 'ПРИКАЗ № 7. Подготовить отчёт до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.';
const proposal = { kind: 'order', documentNumber: '7', issuedAt: null, issuerRaw: null, title: null, direction: null,
  assignments: [{ itemNo: '1', title: 'Подготовить отчёт', instructionText: 'Подготовить отчёт до 20 августа 2026 года.',
    dueDate: '2026-08-20', executors: ['Иванов Иван Иванович'], controller: null, expectedResult: null,
    sourceQuote: 'Подготовить отчёт до 20 августа 2026 года.' }] };
const config = { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081', llmModel: 'department-assistant',
  llmContextSize: 8192, llmMaxTokens: 2048, llmTimeoutMs: 1000 };
const response = (value = proposal, choice = {}) => new Response(JSON.stringify({ model: 'department-assistant',
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) }, ...choice }] }));
const invoke = (extra = {}) => proposeDirectiveWithLlama({ config, text: source, deterministic: {}, ...extra });

async function server(t, handler) {
  const http = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); return new Promise((resolve) => http.close(resolve)); });
  return `http://127.0.0.1:${http.address().port}`;
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}
function fixtureResponse(body, mode) {
  const data = JSON.parse(body.messages[1].content);
  if ('text' in data) return proposal;
  if (!data.candidates) return { queries: ['полярные циклоны'] };
  if (mode === 'empty') return { suggestions: [] };
  const item = data.candidates[mode === 'wrong-source' ? 1 : 0];
  return { suggestions: [{ id: item.id, quote: mode === 'forged' ? 'Выдуманная цитата из отчёта.' : item.text }] };
}

test('all active task bodies explicitly disable thinking; directive fallback has a complete field description', () => {
  const task = prepareDirectiveTask(source, {}, config);
  assert.equal(task.metadata.task, 'directive-v3');
  assert.match(task.metadata.systemSha256, /^[0-9a-f]{64}$/u);
  assert.match(task.metadata.inputSha256, /^[0-9a-f]{64}$/u);
  assert.equal(task.body.max_tokens, 2048);
  assert.equal(task.body.response_format.schema, DIRECTIVE_TASK.schema);
  assert.match(task.body.messages[0].content, /sourceQuote/u);
  assert.match(task.body.messages[0].content, /недоверенные данные/u);
  assert.deepEqual(JSON.parse(task.body.messages[1].content), { text: source, deterministic: {} });
  for (const value of [task, prepareSearchTask('search-expand', { query: 'циклоны', filters: {} }, config),
    prepareSearchTask('search-evidence', { query: 'циклоны', candidates: [] }, config)]) {
    assert.deepEqual(value.body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(value.body.stream, false);
    assert.equal(value.body.tools, undefined);
  }
});

test('root and /v1 addresses reach the same real HTTP route; source fields are not applied', async (t) => {
  const calls = [];
  const endpoint = await server(t, async (req, res) => {
    calls.push({ path: req.url, body: await readBody(req) });
    res.setHeader('content-type', 'application/json');
    res.end(await response().text());
  });
  const before = JSON.stringify(proposal);
  for (const suffix of ['', '/', '/v1', '/v1/']) {
    const result = await invoke({ config: { ...config, llmEndpoint: endpoint + suffix } });
    assert.equal(result.status, 'completed');
    assert.equal(result.endpoint, endpoint);
  }
  assert.ok(calls.every((item) => item.path === '/v1/chat/completions'));
  assert.equal(JSON.stringify(proposal), before);
});

test('one 400/422 schema fallback uses the same deadline; repeated rejection and 503 do not loop', async () => {
  for (const status of [400, 422]) {
    const calls = [];
    const result = await invoke({ fetchImpl: async (_url, options) => {
      calls.push({ body: JSON.parse(options.body), signal: options.signal });
      return calls.length === 1 ? new Response('', { status }) : response();
    } });
    assert.equal(result.status, 'completed');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, calls[1].signal);
    assert.ok(calls[0].body.response_format);
    assert.equal(calls[1].body.response_format, undefined);
    assert.deepEqual(calls[1].body.chat_template_kwargs, { enable_thinking: false });
  }
  for (const status of [400, 503]) {
    let calls = 0;
    const result = await invoke({ fetchImpl: async () => { calls++; return new Response('', { status }); } });
    assert.equal(result.error, `llm_http_${status}`);
    assert.equal(calls, status === 400 ? 2 : 1);
  }
});

test('whole JSON only: prose, reasoning wrappers, trailing text and multiple objects are rejected', () => {
  for (const value of ['Комментарий {"assignments":[]}', '<think>...</think>{"assignments":[]}',
    '{"assignments":[]} готово', '{"assignments":[]}{"kind":"order"}', '[]', 'null']) {
    assert.equal(extractJsonObject(value), null);
  }
  assert.deepEqual(extractJsonObject('```json\n{"assignments":[]}\n```'), { assignments: [] });
});

test('over-budget source or deterministic context is rejected before HTTP, without silent truncation', async () => {
  for (const extra of [{ text: 'я'.repeat(120000) }, { deterministic: { data: 'я'.repeat(20000) } },
    { config: { ...config, llmContextSize: 512 } }]) {
    const result = await invoke({ ...extra, fetchImpl: () => assert.fail('must not send a partial source') });
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'llm_context_too_small');
    assert.equal(result.inputSha256.length, 64);
  }
});

test('truncation, tool calls, oversized streamed payload and malformed envelopes cannot complete', async () => {
  for (const fetchImpl of [
    async () => response(proposal, { finish_reason: 'length' }),
    async () => response(proposal, { message: { content: JSON.stringify(proposal), tool_calls: [{ id: 'bad' }] } }),
    async () => response(proposal, { finish_reason: 'function_call' }),
    async () => new Response('x'.repeat(40000)),
    async () => new Response('{broken'),
    async () => response({ ...proposal, assignments: [{ ...proposal.assignments[0], sourceQuote: 'Выдуманный результат работы.' }] })
  ]) {
    const result = await invoke({ fetchImpl });
    assert.equal(result.status, 'failed');
  }
});

test('invalid endpoint cannot send secrets and HTTP redirects are not followed', async (t) => {
  for (const llmEndpoint of ['http://user:secret@127.0.0.1:8081', 'http://127.0.0.1:8081?token=secret', 'file:///tmp/secret']) {
    const result = await invoke({ config: { ...config, llmEndpoint }, fetchImpl: () => assert.fail('invalid endpoint') });
    assert.equal(result.error, 'llm_invalid_endpoint');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  let redirected = 0;
  const destination = await server(t, (_req, res) => { redirected++; res.end('{}'); });
  const endpoint = await server(t, (_req, res) => { res.writeHead(302, { location: destination }); res.end(); });
  assert.equal((await invoke({ config: { ...config, llmEndpoint: endpoint } })).status, 'failed');
  assert.equal(redirected, 0);
});

test('HTTP deadline aborts a stalled response body, not just response headers', async (t) => {
  const endpoint = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('{');
  });
  const result = await invoke({ config: { ...config, llmEndpoint: endpoint, llmTimeoutMs: 40 } });
  assert.equal(result.error, 'llm_timeout');
});

test('actual application acceptance succeeds on a local contract fixture, not a real model benchmark', async (t) => {
  const bodies = [];
  const endpoint = await server(t, async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end('{"status":"ok"}');
    if (req.url === '/v1/models') return res.end('{"data":[{"id":"department-assistant"}]}');
    assert.equal(req.url, '/v1/chat/completions');
    const body = await readBody(req); bodies.push(body);
    res.end(await response(fixtureResponse(body)).text());
  });
  const report = await runLlmAcceptance({ ...config, llmEndpoint: endpoint });
  assert.equal(report.status, 'passed');
  assert.equal(report.checks.length, 4);
  assert.equal(bodies.length, 7);
  assert.equal(report.sourceHashes['search-assistant.mjs'].length, 64);
  assert.match(report.coverage, /no business database/u);
  assert.ok(report.checks.slice(0, 3).every((item) => item.tasks.length === 2));
});

test('acceptance cannot report success on empty, wrong-source or unverified suggestions', async (t) => {
  for (const mode of ['empty', 'wrong-source', 'forged']) {
    const endpoint = await server(t, async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') return res.end('{"status":"ok"}');
      if (req.url === '/v1/models') return res.end('{"data":[{"id":"department-assistant"}]}');
      res.end(await response(fixtureResponse(await readBody(req), mode)).text());
    });
    const report = await runLlmAcceptance({ ...config, llmEndpoint: endpoint });
    assert.equal(report.status, 'failed');
    assert.ok(report.checks.slice(0, 3).every((item) => item.status === 'failed'));
    assert.equal(report.checks[3].status, 'passed');
  }
});

test('disabled integration is not a successful model acceptance and performs no network IO', async () => {
  const result = await runLlmAcceptance({ ...config, llmEnabled: false }, {
    fetchImpl: () => assert.fail('disabled')
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostics.status, 'disabled');
  await sleep(1);
});
