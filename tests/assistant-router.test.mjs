import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { addSearchFragment } from '../packages/storage/src/search.mjs';
import { createAssistantRouter } from '../apps/api/src/assistant-router.mjs';

function mockRequest(method, urlString, body = null, headers = {}) {
  const url = new URL(urlString, 'http://127.0.0.1');
  const buffer = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  let read = false;
  const stream = {
    method,
    url: urlString,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    auth: { authenticated: true, enabled: false, role: 'admin' },
    async *[Symbol.asyncIterator]() {
      if (!read && buffer.length) {
        read = true;
        yield buffer;
      }
    }
  };
  return { stream, url };
}

function mockResponse() {
  let statusCode = 200;
  let headers = {};
  let body = '';
  return {
    writeHead(code, hdrs) {
      statusCode = code;
      headers = { ...headers, ...hdrs };
    },
    setHeader(name, val) {
      headers[name] = val;
    },
    end(data) {
      if (data) body += data;
    },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body ? JSON.parse(body) : null; }
  };
}

test('assistant-router returns status correctly', async () => {
  const router = createAssistantRouter({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081', llmModel: 'qwen' },
    database: null,
    logger: null
  });

  const { stream, url } = mockRequest('GET', '/api/assistant/status');
  const response = mockResponse();
  const handled = await router(stream, response, url);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.model, 'qwen');
});

test('assistant-router processes table-extract and formula-calc', async () => {
  const mockEngine = {
    enabled: true,
    process: async ({ task, text }) => {
      if (task === 'table-extract') {
        return {
          status: 'completed',
          result: {
            type: 'table',
            title: 'Извлечённые поручения',
            columns: [{ id: 'task', label: 'Задача', type: 'text' }],
            rows: [{ task: 'Подготовить отчёт' }]
          }
        };
      }
      if (task === 'formula-calc') {
        return {
          status: 'completed',
          result: {
            type: 'formula',
            formula: '=СУММ(A1:A10)',
            description: 'Суммирует диапазон',
            steps: ['Вставьте формулу в ячейку']
          }
        };
      }
      return { status: 'failed', error: 'unexpected' };
    }
  };

  const router = createAssistantRouter({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    database: null,
    logger: null,
    engine: mockEngine
  });

  // Test table-extract
  {
    const { stream, url } = mockRequest('POST', '/api/assistant/process', {
      task: 'table-extract',
      text: 'Поручить подготовить отчёт'
    });
    const res = mockResponse();
    const handled = await router(stream, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.result.type, 'table');
    assert.equal(res.body.result.rows[0].task, 'Подготовить отчёт');
  }

  // Test formula-calc
  {
    const { stream, url } = mockRequest('POST', '/api/assistant/process', {
      task: 'formula-calc',
      text: 'Как просуммировать ячейки от A1 до A10'
    });
    const res = mockResponse();
    const handled = await router(stream, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.result.type, 'formula');
    assert.equal(res.body.result.formula, '=СУММ(A1:A10)');
  }
});

test('assistant-router performs archive-query against FTS5 database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-assistant-test-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const now = new Date().toISOString();

  // Create meeting
  database.run(`
    INSERT INTO meetings(id, workspace_id, title, status, meeting_date, protocol_number, evidence_json, created_at, updated_at)
    VALUES('m-1', ?, 'Заседание кафедры № 4', 'completed', '2026-03-12', '4', '{}', ?, ?)
  `, workspace.id, now, now);

  // Add FTS fragment
  addSearchFragment(database, {
    workspaceId: workspace.id,
    sourceKind: 'meeting',
    sourceId: 'm-1',
    title: 'Заседание кафедры № 4',
    content: 'Вопрос 2: Обсуждалась статья доцента Петрова Оценка влажности почв и датчики.',
    eventDate: '2026-03-12',
    number: '4',
    status: 'completed'
  });

  let receivedCandidates = null;
  const mockEngine = {
    enabled: true,
    process: async ({ task, query, candidates }) => {
      receivedCandidates = candidates;
      return {
        status: 'completed',
        result: {
          type: 'archive-matches',
          summary: 'Тема обсуждалась в протоколе № 4',
          matches: [{
            meetingId: candidates[0]?.id || '',
            protocolNumber: '4',
            meetingDate: '2026-03-12',
            itemNumber: '2',
            itemTitle: 'Обсуждение статьи',
            quote: 'Оценка влажности почв и датчики',
            verified: true
          }]
        }
      };
    }
  };

  const router = createAssistantRouter({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    database,
    logger: null,
    engine: mockEngine
  });

  const { stream, url } = mockRequest('POST', '/api/assistant/process', {
    task: 'archive-query',
    query: 'статья о влажности'
  }, { 'x-workspace-id': workspace.id });
  const res = mockResponse();
  const handled = await router(stream, res, url);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'completed');
  assert.equal(res.body.result.type, 'archive-matches');
  assert.ok(Array.isArray(receivedCandidates));
  assert.equal(receivedCandidates.length, 1);
  assert.equal(receivedCandidates[0].id, 'm-1');
  assert.equal(res.body.result.matches[0].protocolNumber, '4');

  database.close();
  await rm(root, { recursive: true, force: true });
});

test('assistant-router tests connection and saves configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-assistant-config-'));
  const mockFetch = async (url) => {
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({
        data: [{ id: 'llama-3.1' }, { id: 'qwen2.5' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('Not Found', { status: 404 });
  };

  const router = createAssistantRouter({
    config: { dataDir: root, llmEnabled: false },
    database: null,
    logger: null,
    fetchImpl: mockFetch
  });

  // 1. test-connection
  {
    const { stream, url } = mockRequest('POST', '/api/assistant/test-connection', {
      endpoint: 'http://127.0.0.1:8000',
      model: 'llama-3.1'
    });
    const res = mockResponse();
    await router(stream, res, url);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'ready');
    assert.deepEqual(res.body.models, ['llama-3.1', 'qwen2.5']);
  }

  // 2. save config
  {
    const { stream, url } = mockRequest('POST', '/api/assistant/config', {
      enabled: true,
      endpoint: 'http://127.0.0.1:8000',
      model: 'llama-3.1',
      timeoutMs: 30000
    });
    const res = mockResponse();
    await router(stream, res, url);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.saved.enabled, true);
    assert.equal(res.body.saved.endpoint, 'http://127.0.0.1:8000');
    assert.equal(res.body.saved.model, 'llama-3.1');
  }

  // 3. check status reflects newly saved settings
  {
    const { stream, url } = mockRequest('GET', '/api/assistant/status');
    const res = mockResponse();
    await router(stream, res, url);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.endpoint, 'http://127.0.0.1:8000');
    assert.equal(res.body.model, 'llama-3.1');
    assert.equal(res.body.status, 'ready');
  }

  await rm(root, { recursive: true, force: true });
});
