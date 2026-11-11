import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ASSISTANT_TASKS } from '../packages/ai/src/assistant-tasks.mjs';
import { PLAN_TASK, preparePlanTask } from '../packages/ai/src/plan-task.mjs';
import { SELECTION_TASK, prepareSelectionTask } from '../packages/ai/src/plan-selection-task.mjs';
import { buildAgentCatalogue, formatAgentCatalogue } from '../packages/ai/src/task-catalogue.mjs';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exporter = join(root, 'scripts/export-agent-prompts.mjs');
const committed = join(root, 'packages/ai/department-agents.json');

async function staging(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kafedra-agent-catalogue-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "quoted ' output");
  await execute(process.execPath, [exporter, '--output-dir', output], { cwd: directory });
  return { directory, output, probe: join(output, 'test-remote-agents.sh') };
}

async function server(t, handler) {
  const http = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); return new Promise((resolve) => http.close(resolve)); });
  return `http://127.0.0.1:${http.address().port}`;
}

async function bodyOf(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw);
}

function sampleResult(body) {
  const input = JSON.parse(body.messages[1].content);
  if (input.rows) return { items: [{ sourceRowKey: input.rows[0].sourceRowKey,
    title: 'Семинар кафедры метеорологии', sourceQuote: input.rows[0].text,
    dateRaw: '15 ноября 2026 года', deadlineRaw: null, responsibleRaw: 'Иванов', expectedResult: null, activityKind: 'science' }] };
  return { items: input.candidates.map((candidate, index) => ({ planItemId: candidate.planItemId,
    relevance: index ? 'other' : 'recommended', reason: index ? 'Указана служба тыла.' : 'Кафедра названа в мероприятии.',
    quote: candidate.segments[0].text, segmentId: candidate.segments[0].id,
    fields: index ? [] : [{ key: 'location', value: 'аудитория 215', quote: 'Место: аудитория 215', segmentId: candidate.segments[0].id },
      { key: 'custom_form', value: 'Доклад', quote: 'Форма участия: Доклад', segmentId: candidate.segments[0].id }]
  })) };
}

function envelope(result, changes = {}) {
  return JSON.stringify({ model: 'http-fixture-only', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) }, ...changes }] });
}

async function invoke(stage, id, endpoint, extraEnv = {}) {
  const options = { cwd: stage.directory, timeout: 5000, env: { ...process.env,
    LLM_ENDPOINT: endpoint, LLM_MODEL: 'probe-fixture', LLM_API_KEY: 'fixture-token', LLM_TIMEOUT: '2',
    AGENTS_FILE: join(stage.output, 'department-agents.json'), ...extraEnv } };
  try {
    return { code: 0, ...await execute('bash', [stage.probe, ...id ? [id] : []], options) };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('committed catalogue is deterministic and contains the current runtime prompts, schemas and request contracts', async () => {
  assert.equal(await readFile(committed, 'utf8'), formatAgentCatalogue(), 'Run node scripts/export-agent-prompts.mjs after changing a task');
  const catalogue = buildAgentCatalogue();
  assert.equal(catalogue.generatedAt, undefined);
  assert.equal(new Set(catalogue.agents.map((agent) => agent.id)).size, Object.keys(ASSISTANT_TASKS).length + 2);
  for (const [id, task] of Object.entries(ASSISTANT_TASKS)) assert.equal(catalogue.agents.find((agent) => agent.id === id).systemPrompt, task.system);
  for (const task of [PLAN_TASK, SELECTION_TASK]) {
    const agent = catalogue.agents.find((entry) => entry.id === task.version);
    assert.equal(agent.promptVersion, task.version);
    assert.equal(agent.systemPrompt, task.system);
    assert.deepEqual(agent.responseSchema, task.schema);
    assert.deepEqual(agent.request.options.response_format, { type: 'json_object', schema: task.schema });
    assert.equal(agent.request.options.stream, false);
    assert.deepEqual(agent.request.options.chat_template_kwargs, { enable_thinking: false });
    let prepared;
    if (task === PLAN_TASK) prepared = preparePlanTask(agent.sampleInput.rows, agent.sampleInput.period);
    else prepared = prepareSelectionTask(agent.sampleInput.candidates.map((candidate) => ({
      planItemId: candidate.planItemId, source: { title: candidate.title, plan_kind: candidate.planKind,
        starts_at: candidate.startsAt, due_date: candidate.dueDate, ...candidate.known }, segments: candidate.segments
    })), agent.sampleInput);
    const { model, messages, ...options } = prepared.body;
    assert.deepEqual(agent.request.options, options);
    assert.deepEqual(agent.sampleInput, JSON.parse(messages[1].content));
  }
});

test('explicit export works outside the repository and never rewrites the committed manifest', async (t) => {
  const before = await readFile(committed, 'utf8');
  const stage = await staging(t);
  assert.deepEqual((await readdir(stage.output)).sort(), ['AGENTS_GUIDE.md', 'department-agents.json', 'test-remote-agents.sh']);
  const first = await readFile(join(stage.output, 'department-agents.json'), 'utf8');
  await execute(process.execPath, [exporter, '--output-dir', stage.output], { cwd: stage.directory });
  assert.equal(await readFile(join(stage.output, 'department-agents.json'), 'utf8'), first);
  assert.equal(first, before);
  assert.equal(await readFile(committed, 'utf8'), before);
  const list = await invoke(stage, '--list', 'http://127.0.0.1:1');
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /^plan-extract-v1\t/mu);
  assert.match(list.stdout, /^plan-department-selection-v1\t/mu);
  assert.equal((await invoke(stage, '', 'http://127.0.0.1:1')).stdout, list.stdout);
  const unknown = await invoke(stage, 'unknown-task', 'http://127.0.0.1:1');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Неизвестная задача/u);
});

test('exported probe sends both actual plan contracts to HTTP and validates grounded responses', async (t) => {
  const stage = await staging(t);
  const calls = [];
  const endpoint = await server(t, async (request, response) => {
    const body = await bodyOf(request);
    calls.push({ path: request.url, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    response.end(envelope(sampleResult(body)));
  });
  for (const id of [PLAN_TASK.version, SELECTION_TASK.version]) {
    const result = await invoke(stage, id, endpoint + '/v1/');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /PASS — запрос и контракт ответа/u);
    const call = calls.at(-1);
    const agent = buildAgentCatalogue().agents.find((agent) => agent.id === id);
    assert.equal(call.path, '/v1/chat/completions');
    assert.equal(call.authorization, 'Bearer fixture-token');
    assert.equal(call.body.model, 'probe-fixture');
    assert.equal(call.body.messages[0].content, agent.systemPrompt);
    assert.deepEqual(JSON.parse(call.body.messages[1].content), agent.sampleInput);
    const { model, messages, ...options } = call.body;
    assert.deepEqual(options, agent.request.options);
  }
  assert.equal(calls.length, 2);
});

test('probe schema compatibility retry is bounded to one call and validates the fallback response', async (t) => {
  const stage = await staging(t);
  const calls = [];
  let rejectBoth = false;
  const endpoint = await server(t, async (request, response) => {
    const body = await bodyOf(request);
    calls.push(body);
    if (body.response_format || rejectBoth) { response.writeHead(422); response.end('{}'); return; }
    response.end(envelope(sampleResult(body)));
  });
  const success = await invoke(stage, PLAN_TASK.version, endpoint);
  assert.equal(success.code, 0, success.stderr);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].response_format);
  assert.equal(calls[1].response_format, undefined);
  assert.deepEqual(calls[1].chat_template_kwargs, { enable_thinking: false });
  rejectBoth = true;
  const failure = await invoke(stage, PLAN_TASK.version, endpoint);
  assert.equal(failure.code, 1);
  assert.equal(calls.length, 4);
});

test('HTTP 200 is rejected for malformed, truncated, ungrounded or schema-invalid output', async (t) => {
  const stage = await staging(t);
  let scenario = 'invalid-envelope';
  const endpoint = await server(t, async (request, response) => {
    const body = await bodyOf(request);
    const result = sampleResult(body);
    if (scenario === 'invalid-envelope') { response.end('{}'); return; }
    if (scenario === 'too-large') { response.end('x'.repeat(65537)); return; }
    if (scenario === 'unknown-id') result.items[0].planItemId = 'invented';
    if (scenario === 'forged-quote') result.items[0].quote = 'Выдуманное основание кафедры';
    if (scenario === 'forged-field') result.items[0].fields[0].value = 'кабинет 999';
    if (scenario === 'wrong-type') result.items[0].fields = 'не массив';
    if (scenario === 'empty') result.items = [];
    if (scenario === 'missing-property') delete result.items[0].relevance;
    if (scenario === 'extra-property') result.items[0].confirmed = true;
    response.end(envelope(result, scenario === 'truncated' ? { finish_reason: 'length' }
      : scenario === 'tool-call' ? { message: { content: JSON.stringify(result), tool_calls: [{ id: 'tool' }] } } : {}));
  });
  for (scenario of ['invalid-envelope', 'too-large', 'unknown-id', 'forged-quote', 'forged-field', 'wrong-type',
    'empty', 'missing-property', 'extra-property', 'truncated', 'tool-call']) {
    const failure = await invoke(stage, SELECTION_TASK.version, endpoint);
    assert.equal(failure.code, 1, scenario + ': ' + failure.stdout);
    assert.doesNotMatch(failure.stdout, /PASS/u);
  }
});

test('probe fails closed on unsupported schema and enforces an overall request deadline', async (t) => {
  const stage = await staging(t);
  let calls = 0;
  const endpoint = await server(t, async (request) => { await bodyOf(request); calls += 1; });
  const timeout = await invoke(stage, PLAN_TASK.version, endpoint, { LLM_TIMEOUT: '0.1' });
  assert.equal(timeout.code, 1);
  assert.match(timeout.stderr, /Истёк общий срок/u);
  assert.equal(calls, 1);
  const manifest = JSON.parse(formatAgentCatalogue());
  const agent = manifest.agents.find((entry) => entry.id === PLAN_TASK.version);
  agent.responseSchema.pattern = 'unsupported';
  await writeFile(join(stage.output, 'department-agents.json'), JSON.stringify(manifest));
  const unsupported = await invoke(stage, PLAN_TASK.version, endpoint);
  assert.equal(unsupported.code, 1);
  assert.match(unsupported.stderr, /Неподдерживаемое свойство schema/u);
  assert.equal(calls, 1, 'Unsupported schema must fail before HTTP');
});
