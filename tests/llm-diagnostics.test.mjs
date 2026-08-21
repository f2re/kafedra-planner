import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { diagnoseLlm } from '../packages/ai/src/diagnostics.mjs';

async function server(handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  return instance;
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('диагностика проверяет /health, /v1/models и alias', async () => {
  const api = await server((request, response) => {
    if (request.url === '/health') return json(response, 200, { status: 'ok' });
    if (request.url === '/v1/models') return json(response, 200, { data: [{ id: 'qwen' }, { id: 'small' }] });
    return json(response, 404, {});
  });
  try {
    const port = api.address().port;
    const ready = await diagnoseLlm({
      llmEnabled: true, llmManaged: true, llmEndpoint: `http://127.0.0.1:${port}/v1`,
      llmModel: 'qwen', llmTimeoutMs: 2000
    });
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.models, ['qwen', 'small']);
    const missing = await diagnoseLlm({
      llmEnabled: true, llmManaged: true, llmEndpoint: `http://127.0.0.1:${port}`,
      llmModel: 'other', llmTimeoutMs: 2000
    });
    assert.equal(missing.status, 'model_missing');
  } finally {
    api.close();
    await once(api, 'close');
  }
});

test('выключенный LLM не выполняет сетевой запрос', async () => {
  let called = false;
  const result = await diagnoseLlm({ llmEnabled: false, llmManaged: false }, {
    fetchImpl: async () => { called = true; throw new Error('must not call'); }
  });
  assert.equal(result.status, 'disabled');
  assert.equal(called, false);
});

test('невалидный models endpoint диагностируется как несовместимый', async () => {
  const api = await server((request, response) => {
    if (request.url === '/health') return json(response, 200, { status: 'ok' });
    return json(response, 200, { models: ['qwen'] });
  });
  try {
    const result = await diagnoseLlm({
      llmEnabled: true, llmManaged: false, llmEndpoint: `http://127.0.0.1:${api.address().port}`,
      llmModel: 'qwen', llmTimeoutMs: 2000
    });
    assert.equal(result.status, 'incompatible');
  } finally {
    api.close();
    await once(api, 'close');
  }
});
