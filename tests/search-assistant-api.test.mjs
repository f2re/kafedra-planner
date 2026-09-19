import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

async function waitFor(read, accepts, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accepts(value)) return value;
    } catch { /* The real API may still be starting. */ }
    await sleep(20);
  }
  throw new Error('Expected API state was not reached');
}

test('search assistant API is nonblocking, header-gated and invalidates changed source snapshots', { timeout: 20_000 }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kafedra-search-assistant-'));
  let calls = 0;
  let modelInput;
  let releaseModel;
  const modelGate = new Promise((resolveGate) => { releaseModel = resolveGate; });
  const model = createServer(async (request, response) => {
    calls++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const input = JSON.parse(body.messages[1].content);
    if (!input.candidates) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"queries":[]}' } }] }));
      return;
    }
    modelInput = input;
    await modelGate;
    const candidate = modelInput.candidates[0];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ suggestions: [{ id: candidate.id, quote: candidate.text.slice(0, 240) }] })
    } }] }));
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const api = spawn(process.execPath, ['apps/api/src/main.mjs'], {
    cwd: resolve('.'), stdio: 'ignore', env: {
      ...process.env, KAFEDRA_DATA_DIR: dataDir, KAFEDRA_DATABASE_PATH: join(dataDir, 'test.sqlite3'),
      KAFEDRA_PORT: String(port), KAFEDRA_HOST: '127.0.0.1', KAFEDRA_AUTH_ENABLED: 'false',
      KAFEDRA_LLM_ENABLED: 'true', KAFEDRA_LLM_ENDPOINT: `http://127.0.0.1:${model.address().port}`,
      KAFEDRA_LLM_MODEL: 'local-fixture', KAFEDRA_LOG_LEVEL: 'error'
    }
  });
  t.after(async () => {
    releaseModel();
    if (api.exitCode === null && api.signalCode === null) {
      const exited = once(api, 'exit');
      api.kill('SIGTERM');
      const kill = setTimeout(() => api.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(kill);
    }
    model.closeAllConnections();
    await new Promise((done) => model.close(done));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const get = async (path, headers = {}) => {
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    return response.json();
  };
  await waitFor(() => get('/api/system/health'), (value) => value.status === 'ok');
  async function post(path, data) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  }
  const person = await post('/api/people', { displayName: 'Тестовый исполнитель подбора' });
  const task = { ownerPersonId: person.id, title: 'Фоновый подбор научного отчёта кафедры',
    description: 'Фоновый подбор материалов для научного отчёта кафедры.',
    periodKind: 'semester', periodKey: '2026-1', startsAt: '2026-08-18', dueDate: '2026-09-15', direction: 'education' };
  await post('/api/periodic-tasks', task);
  const params = new URLSearchParams({ q: 'Фоновый подбор', sourceKind: 'periodic_task',
    assistContext: '0123456789abcdef0123456789abcdef', assistGeneration: '1', candidates: 'PRIVATE_CLIENT_INJECTION' });
  const path = `/api/search?${params}`;
  const ordinary = await get(path);
  assert.ok(ordinary.items.length > 0);
  assert.equal(ordinary.assistant.status, 'idle');
  assert.equal(calls, 0);
  assert.equal((await get(path + '&assist=start')).assistant.status, 'idle');
  assert.equal(calls, 0);
  const headers = { 'x-kafedra-assistant': 'search-evidence-v1' };
  const started = await get(path + '&assist=start', headers);
  assert.equal(started.assistant.status, 'queued');
  await waitFor(async () => calls, (count) => count === 2);
  const whileBlocked = await get(path);
  assert.deepEqual(whileBlocked.items, ordinary.items);
  assert.equal((await get(path + '&assist=poll', headers)).assistant.status, 'running');
  assert.doesNotMatch(JSON.stringify(modelInput), /PRIVATE_CLIENT_INJECTION/u);
  assert.ok(modelInput.candidates.every((candidate) => ordinary.items.some((item) => `${item.source_kind}:${item.source_id}` === candidate.id)));
  releaseModel();
  const ready = await waitFor(() => get(path + '&assist=poll', headers), (value) => value.assistant.status === 'ready');
  assert.equal(ready.assistant.suggestions.length, 1);
  assert.equal(calls, 2);
  await get(path + '&assist=start', headers);
  assert.equal(calls, 2);
  await post('/api/periodic-tasks', { ...task, title: task.title + ' — новый материал', periodKey: '2026-2' });
  const changed = await get(path + '&assist=poll', headers);
  assert.ok(changed.items.length > ready.items.length);
  assert.equal(changed.assistant.status, 'idle');
  assert.deepEqual(changed.assistant.suggestions, []);
});
