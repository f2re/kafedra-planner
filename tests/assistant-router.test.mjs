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

test('assistant-router handles async background tasks (submit, poll, cancel)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-assistant-task-test-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);

  const mockEngine = {
    enabled: true,
    process: async ({ task, text }) => {
      // Simulate slight async work
      await new Promise((r) => setTimeout(r, 20));
      return {
        status: 'completed',
        result: { type: 'table', title: 'Результат', columns: [{ id: 'col1', label: 'Данные', type: 'text' }], rows: [{ col1: 'ок' }] },
        durationMs: 25
      };
    }
  };

  const router = createAssistantRouter({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    database,
    logger: null,
    engine: mockEngine
  });

  // 1. Submit async task
  const { stream: subStream, url: subUrl } = mockRequest('POST', '/api/assistant/tasks', {
    task: 'table-extract',
    text: 'Тестовый текст'
  }, { 'x-workspace-id': workspace.id });
  const subRes = mockResponse();
  const subHandled = await router(subStream, subRes, subUrl);

  assert.equal(subHandled, true);
  assert.equal(subRes.statusCode, 202);
  assert.equal(subRes.body.ok, true);
  assert.equal(subRes.body.status, 'running');
  const taskId = subRes.body.taskId;
  assert.ok(taskId);

  // 2. Wait for completion
  await new Promise((r) => setTimeout(r, 50));

  // 3. Poll task status
  const { stream: pollStream, url: pollUrl } = mockRequest('GET', `/api/assistant/tasks/${taskId}`);
  const pollRes = mockResponse();
  const pollHandled = await router(pollStream, pollRes, pollUrl);

  assert.equal(pollHandled, true);
  assert.equal(pollRes.statusCode, 200);
  assert.equal(pollRes.body.status, 'completed');
  assert.equal(pollRes.body.result.type, 'table');

  // 4. Cancel/delete task
  const { stream: delStream, url: delUrl } = mockRequest('DELETE', `/api/assistant/tasks/${taskId}`);
  const delRes = mockResponse();
  const delHandled = await router(delStream, delRes, delUrl);
  assert.equal(delHandled, true);
  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.body.cancelled, true);

  database.close();
  await rm(root, { recursive: true, force: true });
});

test('assistant-router review-repair extracts missing fields using AI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-assistant-repair-test-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const now = new Date().toISOString();

  // Create file blob, document, version with text
  database.run(`INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES('dummy-hash-1', 100, 'application/docx', '/tmp/dummy', ?)`, now);
  database.run(`INSERT INTO documents(id, workspace_id, title, document_type, status, created_at, updated_at)
    VALUES('doc-1', ?, 'Протокол заседания кафедры', 'protocol', 'processed', ?, ?)`, workspace.id, now, now);
  database.run(`INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at)
    VALUES('dv-1', 'doc-1', 1, 'dummy-hash-1', 'protocol.docx', 'application/docx', 'docx', 'processed', 'ПРОТОКОЛ № 5 заседания кафедры от 15 октября 2026 года. Присутствовали: Иванов, Петров.', ?)`, now);

  // Create review item
  database.run(`INSERT INTO review_items(id, workspace_id, source_kind, source_id, issue_code, title, explanation, proposed_action, context_json, status, created_at)
    VALUES('rev-1', ?, 'document_version', 'dv-1', 'meeting_date_missing', 'Не найдена дата', 'Автоматика не нашла дату', 'Укажите дату', '{}', 'open', ?)`, workspace.id, now);

  const mockEngine = {
    enabled: true,
    process: async ({ task, text, query }) => {
      assert.equal(task, 'field-extract');
      assert.ok(text.includes('15 октября 2026 года'));
      return {
        status: 'completed',
        result: {
          type: 'field-extract',
          field: 'дата заседания',
          value: '2026-10-15',
          sourceQuote: 'от 15 октября 2026 года',
          confidence: 0.98
        },
        durationMs: 30
      };
    }
  };

  const router = createAssistantRouter({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    database,
    logger: null,
    engine: mockEngine
  });

  const { stream, url } = mockRequest('POST', '/api/assistant/review-repair', {
    reviewItemId: 'rev-1'
  }, { 'x-workspace-id': workspace.id });
  const res = mockResponse();
  const handled = await router(stream, res, url);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.extracted.value, '2026-10-15');
  assert.equal(res.body.extracted.sourceQuote, 'от 15 октября 2026 года');

  database.close();
  await rm(root, { recursive: true, force: true });
});

test('assistant-router search-refine handles AI refinement and offline fallback', async () => {
  const mockEngine = {
    enabled: true,
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    async process({ task }) {
      if (task === 'search-refine') {
        return {
          status: 'completed',
          result: {
            type: 'search-refine',
            intent: 'meeting_search',
            keywords: ['влажность', 'статья'],
            synonyms: ['почва', 'вестник'],
            ftsQuery: 'влажность OR статья',
            timeframe: '2026',
            explanation: 'Поиск статей по влажности'
          }
        };
      }
      return { status: 'failed' };
    }
  };

  const router = createAssistantRouter({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    database: null,
    logger: null,
    engine: mockEngine
  });

  // 1. AI refinement
  {
    const { stream, url } = mockRequest('POST', '/api/assistant/search-refine', {
      query: 'На каком заседании кафедры обсуждалась статья о влажности?'
    });
    const res = mockResponse();
    const handled = await router(stream, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'completed');
    assert.deepEqual(res.body.keywords, ['влажность', 'статья']);
    assert.equal(res.body.ftsQuery, 'влажность OR статья');
  }

  // 2. Offline fallback when engine disabled
  {
    mockEngine.enabled = false;
    const { stream, url } = mockRequest('POST', '/api/assistant/search-refine', {
      query: 'обсуждение грантов РНФ и аспирантов'
    });
    const res = mockResponse();
    const handled = await router(stream, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'fallback');
    assert.ok(res.body.ftsQuery.includes('грантов'));
    assert.ok(res.body.ftsQuery.includes('аспирантов'));
  }
});
