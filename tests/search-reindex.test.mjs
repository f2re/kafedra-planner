import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { ensureSearchIndexUpToDate, rebuildSearchIndex, search } from '../packages/storage/src/search.mjs';
import { createSearchRouter } from '../apps/api/src/search-router.mjs';

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
    on() {},
    emit() {},
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
    setHeader(name, value) {
      headers[name] = value;
    },
    end(data) {
      body = data ? JSON.parse(data) : null;
    },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body; }
  };
}

test('rebuildSearchIndex indexes meetings, documents, plans and returns complete breakdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-reindex-test-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const now = new Date().toISOString();

  // 1. Create meeting
  database.run(`
    INSERT INTO meetings(id, workspace_id, title, status, meeting_date, protocol_number, evidence_json, created_at, updated_at)
    VALUES('m-test-1', ?, 'Заседание кафедры № 2', 'completed', '2026-02-15', '2', '{}', ?, ?)
  `, workspace.id, now, now);

  // 2. Create document with version
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES('sha-dummy-1', 100, 'application/pdf', '/tmp/dummy.pdf', ?)
  `, now);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES('doc-test-1', ?, 'Положение о практике', 'unknown', 'processed', 'ver-test-1', ?, ?)
  `, workspace.id, now, now);
  database.run(`
    INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, extracted_text, uploaded_at)
    VALUES('ver-test-1', 'doc-test-1', 1, 'sha-dummy-1', 'polozhenie.pdf', 'application/pdf', 'pdf', 'processed',
      'Настоящее положение регулирует порядок проведения производственной и учебной практики студентов кафедры информатики.', ?)
  `, now);

  // 3. Create plan with item
  database.run(`
    INSERT INTO plans(id, workspace_id, source_document_version_id, plan_kind, period_kind, period_key, year_start, year_end, owner_raw, title, status, created_at, updated_at)
    VALUES('plan-test-1', ?, 'ver-test-1', 'department_plan', 'academic_year', '2026-2027', 2026, 2027, 'Иванов И.И.', 'План работы кафедры на 2026/2027 год', 'active', ?, ?)
  `, workspace.id, now, now);

  database.run(`
    INSERT INTO plan_items(id, plan_id, source_item_key, item_no, title, direction, responsible_raw, due_date, status, created_at, updated_at)
    VALUES('item-test-1', 'plan-test-1', 'row-1', '1.1', 'Подготовка рабочих программ дисциплин по искусственному интеллекту', 'education', 'Сидоров С.С.', '2026-08-30', 'planned', ?, ?)
  `, now, now);

  // Rebuild index
  const result = rebuildSearchIndex(database, workspace.id);

  assert.ok(result.indexedCount >= 4, 'Should index at least 4 items');
  assert.equal(result.meetingsCount, 1);
  assert.equal(result.documentsCount, 1);
  assert.equal(result.plansCount, 1);
  assert.equal(result.planItemsCount, 1);

  // Search by document text
  const docResults = search(database, workspace.id, 'производственной практики');
  assert.ok(docResults.length >= 1, 'Should find document by practice text');
  assert.equal(docResults[0].source_id, 'doc-test-1');

  // Search by plan item text
  const planResults = search(database, workspace.id, 'искусственному интеллекту');
  assert.ok(planResults.length >= 1, 'Should find plan item by AI text');
  assert.equal(planResults[0].source_id, 'item-test-1');

  // Test idempotency: running ensureSearchIndexUpToDate again indexes 0 new items
  const repeated = ensureSearchIndexUpToDate(database, workspace.id);
  assert.equal(repeated.indexedCount, 0, 'Repeated index run should find no unindexed items');

  database.close();
  await rm(root, { recursive: true, force: true });
});

test('POST /api/search/reindex HTTP endpoint rebuilds search index and returns counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-reindex-http-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const now = new Date().toISOString();

  database.run(`
    INSERT INTO meetings(id, workspace_id, title, status, meeting_date, protocol_number, evidence_json, created_at, updated_at)
    VALUES('m-http-1', ?, 'Заседание кафедры № 10', 'completed', '2026-05-20', '10', '{}', ?, ?)
  `, workspace.id, now, now);

  const router = createSearchRouter({ database, config: {} });
  const { stream, url } = mockRequest('POST', '/api/search/reindex', null, { 'x-workspace-id': workspace.id });
  const res = mockResponse();

  const handled = await router(stream, res, url);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.indexedCount >= 1);
  assert.equal(res.body.meetingsCount, 1);

  database.close();
  await rm(root, { recursive: true, force: true });
});
