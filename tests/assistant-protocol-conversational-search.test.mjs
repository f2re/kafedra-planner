import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { addSearchFragment, extractSubstantiveQuery } from '../packages/storage/src/search.mjs';
import { createAssistantRouter } from '../apps/api/src/assistant-router.mjs';
import { validateAssistantResult } from '../packages/ai/src/assistant-tasks.mjs';

function mockRequest(method, urlStr, body = null, headers = {}) {
  const stream = new Readable({
    read() {
      if (body) {
        this.push(typeof body === 'string' ? body : JSON.stringify(body));
      }
      this.push(null);
    }
  });
  stream.method = method;
  stream.url = urlStr;
  stream.headers = {
    'content-type': 'application/json',
    ...headers
  };
  return { stream, url: new URL(urlStr, 'http://localhost:3000') };
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
    },
    write(chunk) { this.body += chunk; },
    end(chunk) {
      if (chunk) this.body += chunk;
      if (typeof this.body === 'string' && this.body.startsWith('{')) {
        try { this.body = JSON.parse(this.body); } catch {}
      }
    }
  };
  return res;
}

test('extractSubstantiveQuery extracts key domain terms from conversational questions', () => {
  const res1 = extractSubstantiveQuery('На каком заседании кафедры обсуждалась статья о влажности и какие решения были приняты?');
  assert.deepEqual(res1.substantiveTerms, ['статья', 'влажности']);
  assert.equal(res1.cleanedQuery, 'статья влажности');

  const res2 = extractSubstantiveQuery('В каких протоколах рассматривалась аттестация аспирантов кафедры?');
  assert.deepEqual(res2.substantiveTerms, ['аттестация', 'аспирантов']);

  const res3 = extractSubstantiveQuery('Найти заседания, где утверждались темы выпускных квалификационных работ');
  assert.deepEqual(res3.substantiveTerms, ['темы', 'выпускных', 'квалификационных', 'работ']);

  const res4 = extractSubstantiveQuery('заседание кафедры протокол');
  assert.deepEqual(res4.substantiveTerms, []);
  assert.equal(res4.cleanedQuery, '');
});

test('assistant router successfully retrieves protocol candidates for conversational questions and hydrates full text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-conversational-search-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const now = new Date().toISOString();

  // Create meeting
  database.run(`
    INSERT INTO meetings(id, workspace_id, title, status, meeting_date, protocol_number, evidence_json, created_at, updated_at)
    VALUES('m-42', ?, 'Заседание кафедры № 42', 'completed', '2026-04-16', '42', '{}', ?, ?)
  `, workspace.id, now, now);

  const fullProtocolContent = [
    'Заседание кафедры № 42 от 2026-04-16',
    'Председатель: профессор Иванов И.И.',
    'Секретарь: доцент Сидоров С.С.',
    'Присутствовали: 14 сотрудников кафедры.',
    'Кворум: 100% явки.',
    'Вопрос 1: О распределении педагогической нагрузки на осенний семестр.',
    'Вопрос 2: Доклад доцента Петрова П.П. по теме исследования: Оценка влажности почв и датчики мониторинга.',
    'СЛУШАЛИ: Докладчика Петрова П.П. о результатах полевых испытаний нового датчика влажности.',
    'ВЫСТУПИЛИ: профессор Иванов И.И., профессор Смирнов А.А.',
    'ПОСТАНОВИЛИ: Одобрить результаты испытаний датчика влажности почв и рекомендовать статью к публикации в Вестнике.'
  ].join('\n');

  addSearchFragment(database, {
    workspaceId: workspace.id,
    sourceKind: 'meeting',
    sourceId: 'm-42',
    title: 'Заседание кафедры № 42 (2026-04-16)',
    content: fullProtocolContent,
    eventDate: '2026-04-16',
    number: '42',
    status: 'completed'
  });

  let capturedCandidates = null;
  const mockEngine = {
    enabled: true,
    process: async ({ task, query, candidates }) => {
      capturedCandidates = candidates;
      return {
        status: 'completed',
        result: validateAssistantResult(task, {
          summary: 'Статья о влажности обсуждалась на заседании кафедры № 42 от 16 апреля 2026 года.',
          matches: [
            {
              meetingId: 'm-42',
              protocolNumber: '42',
              meetingDate: '2026-04-16',
              itemNumber: '2',
              itemTitle: 'Доклад доцента Петрова П.П. по теме исследования: Оценка влажности почв',
              quote: 'Одобрить результаты испытаний датчика влажности почв и рекомендовать статью к публикации'
            }
          ]
        }, { candidates })
      };
    }
  };

  const router = createAssistantRouter({
    database,
    config: { llmEnabled: true },
    engine: mockEngine
  });

  // User asks a full conversational question
  const { stream, url } = mockRequest('POST', '/api/assistant/process', {
    task: 'archive-query',
    query: 'На каком заседании кафедры обсуждалась статья о влажности и какие решения были приняты?'
  }, { 'x-workspace-id': workspace.id });

  const res = mockResponse();
  const handled = await router(stream, res, url);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'completed');

  // Verify candidate was found via substantive term query
  assert.ok(Array.isArray(capturedCandidates));
  assert.equal(capturedCandidates.length, 1);
  assert.equal(capturedCandidates[0].id, 'm-42');
  assert.equal(capturedCandidates[0].number, '42');

  // Verify candidate.text contains the full content needed for quote validation
  assert.ok(capturedCandidates[0].text);
  assert.match(capturedCandidates[0].text, /Оценка влажности почв/u);
  assert.match(capturedCandidates[0].text, /ПОСТАНОВИЛИ: Одобрить результаты/u);

  // Verify quote was matched and marked as verified
  const match = res.body.result.matches[0];
  assert.equal(match.protocolNumber, '42');
  assert.equal(match.verified, true);

  database.close();
  await rm(root, { recursive: true, force: true });
});
