import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { literalQuery, topicQuery, editDistance, relatedQueryFor } from '../packages/search/src/intent.mjs';
import { retrieveMaterials } from '../packages/search/src/retrieval.mjs';
import { SEARCH_TASKS, validateSearchExpansion, prepareSearchTask } from '../packages/ai/src/search-tasks.mjs';
import { createSearchAssistant } from '../packages/ai/src/search-assistant.mjs';

function index(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec('CREATE VIRTUAL TABLE search_fts USING fts5(id UNINDEXED,title,content)');
  const records = [
    ['report', 'Отчёт кафедры', 'В годовой отчёт включена статья о развитии циклонов над Балтикой.'],
    ['article', 'Циклоны умеренных широт', 'Исследование развития циклонов и образования фронтальных систем.'],
    ['meeting', 'Протокол заседания', 'Обсуждались результаты исследования циклонов и план публикации статьи.'],
    ['semantic', 'Барическая депрессия', 'В отчёте рассмотрен циклогенез и развитие барических депрессий.'],
    ['other', 'Антициклоны', 'Влияние антициклонов на засуху и температуру воздуха.'],
    ['secret', 'Секретная тема', 'Циклоны секретного проекта, специальный термин циклоноскопия.']
  ];
  for (const record of records) sql.prepare('INSERT INTO search_fts VALUES(?,?,?)').run(...record);
  let allowed = new Set(['report', 'article', 'meeting', 'semantic', 'other']);
  const database = { exec: (query) => sql.exec(query), all: (query, ...params) => sql.prepare(query).all(...params) };
  const find = (q) => sql.prepare(`SELECT id, title, content FROM search_fts WHERE search_fts MATCH ?`).all(
    q.split(' ').map((token) => `"${token}"*`).join(' AND ')
  ).filter((row) => allowed.has(row.id)).map((row) => ({
    id: row.id, source_kind: 'document', source_id: row.id, title: row.title, snippet: row.content,
    document_version_id: `v-${row.id}`, locator_json: '{"page":1}', route: { kind: 'document', id: row.id }
  }));
  return { sql, database, find, revoke: (id) => allowed.delete(id) };
}

const config = { llmEnabled: true, llmEndpoint: 'http://localhost:8081', llmModel: 'test' };
const response = (content) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
async function settled(engine, context) {
  for (let count = 0; count < 500; count++) {
    const result = engine.request(context);
    if (!['queued', 'running'].includes(result.status)) return result;
    await sleep(2);
  }
  throw new Error('did not settle');
}

test('conversational Russian query isolates the topic without domain-specific synonyms', () => {
  assert.equal(topicQuery('ищется отчёт где была статья про циклоны'), 'циклон');
  assert.equal(topicQuery('покажи документы про углеродные нанотрубки'), 'углеродн нанотрубк');
  assert.equal(literalQuery('"Циклоны": (2026) OR * <tag>'), 'циклоны 2026 or tag');
  assert.equal(literalQuery('отчёт'), 'отчёт');
  assert.equal(editDistance('циколн', 'циклон'), 1);
  assert.equal(relatedQueryFor({ title: 'Протокол заседания про циклоны' }), 'циклоны');
});

test('existing FTS index finds reports, articles and minutes with Russian inflections', (t) => {
  const { database, find } = index(t);
  const result = retrieveMaterials({ database, find, query: 'отчёт где была статья про циклоны' });
  assert.deepEqual(new Set(result.items.map((item) => item.source_id)), new Set(['report', 'article', 'meeting']));
  assert.equal(result.mode, 'word_forms');
  assert.ok(result.relatedQueries.every((hint) => hint.count > 0));
  assert.ok(result.items.every((item) => item.document_version_id && item.locator_json));
});

test('typos use the live index vocabulary, never an unverified search suggestion', (t) => {
  const { database, find } = index(t);
  const result = retrieveMaterials({ database, find, query: 'цеклоны' });
  assert.ok(result.items.some((item) => item.source_id === 'article'));
  assert.equal(result.mode, 'spelling');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.deepEqual(retrieveMaterials({ database, find, query: 'циклоноскопиа' }).relatedQueries, []);
  assert.ok(retrieveMaterials({ database, find, query: 'отчет' }).items.some((item) => item.source_id === 'report'));
});

test('temporary vocabulary neither changes persistent schema nor needs rebuilding after import', (t) => {
  const { sql, database, find } = index(t);
  const before = sql.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
  retrieveMaterials({ database, find, query: 'цеклоны' });
  assert.deepEqual(sql.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(), before);
  sql.prepare('UPDATE search_fts SET content=? WHERE id=?').run('Материалы о метеорологии и спутниковых измерениях.', 'article');
  assert.ok(retrieveMaterials({ database, find, query: 'метеоролгии' }).items.some((item) => item.source_id === 'article'));
});

test('the model planner is schema-bound and cannot invent years or return commands', () => {
  for (const bad of [
    { queries: ['циклоны'], filters: { person: 'чужой' } }, { queries: ['публикации 2099'] },
    { queries: ['SELECT * FROM documents'] }, { queries: ['http://external.example'] },
    { queries: Array(4).fill('циклоны') }
  ]) assert.throws(() => validateSearchExpansion(JSON.stringify(bad), { query: 'циклоны 2026' }));
  assert.deepEqual(validateSearchExpansion('{"queries":["циклогенез","барические депрессии"]}', {}), ['циклогенез', 'барические депрессии']);
  for (const task of Object.values(SEARCH_TASKS)) assert.match(task.system, /недоверенные данные/u);
});

test('prompt registry bounds context and carries reproducible hashes without retaining raw text', () => {
  const task = prepareSearchTask('search-evidence', { query: 'циклоны', candidates: Array(12).fill({ text: 'я'.repeat(600), title: 'x'.repeat(160) }) }, config);
  assert.ok(task.candidates.length < 12);
  assert.ok(Buffer.byteLength(task.body.messages.map((message) => message.content).join('')) < 8192 - 768);
  assert.match(task.metadata.inputSha256, /^[a-f0-9]{64}$/u);
  assert.equal(task.metadata.task, 'search-evidence-v2');
  assert.throws(() => prepareSearchTask('arbitrary-task', {}, config));
});

test('LLM expansion retrieves documents absent from the initial result, with supported related queries', async (t) => {
  const source = index(t);
  const query = 'статья про циклоны';
  const retrieve = (expansions) => retrieveMaterials({ ...source, query, expansions });
  const initial = retrieve([]);
  assert.ok(!initial.items.some((item) => item.source_id === 'semantic'));
  let calls = 0;
  const engine = createSearchAssistant({ config, fetchImpl: async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    calls++;
    if (!input.candidates) return response({ queries: ['циклогенез', 'барические депрессии', 'несуществующая тема'] });
    assert.ok(input.candidates.every((item) => !item.id.includes('secret')));
    const match = input.candidates.find((item) => item.id === 'document:semantic');
    assert.ok(match);
    return response({ suggestions: [{ id: match.id, quote: match.text }] });
  } });
  t.after(() => engine.close());
  const context = { scope: ['w', 'u'], query, items: initial.items, retrieve };
  engine.request(context, { start: true });
  const result = await settled(engine, context);
  assert.equal(result.status, 'ready');
  assert.equal(calls, 2);
  assert.equal(result.suggestions[0].id, 'document:semantic');
  assert.ok(result.items.some((item) => item.source_id === 'semantic'));
  assert.ok(result.relatedQueries.every((hint) => hint.query !== 'несуществующая тема'));
  source.revoke('semantic');
  const revoked = engine.request(context);
  assert.equal(revoked.status, 'idle');
  assert.ok(!JSON.stringify(revoked).includes('Барическая'));
});

test('empty initial search can recover semantically; a rejected quote preserves retrieved materials', async (t) => {
  const source = index(t);
  const query = 'образование атмосферных вихрей';
  const retrieve = (expansions) => retrieveMaterials({ ...source, query, expansions });
  const engine = createSearchAssistant({ config, fetchImpl: async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    return input.candidates ? response({ suggestions: [{ id: 'invented', quote: 'Несуществующее подтверждённое событие.' }] })
      : response({ queries: ['циклогенез'] });
  } });
  t.after(() => engine.close());
  const context = { scope: ['w', 'u'], query, items: [], retrieve };
  assert.equal(engine.request(context, { start: true }).status, 'queued');
  const result = await settled(engine, context);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.suggestions, []);
  assert.ok(result.items.some((item) => item.source_id === 'semantic'));
});

test('permissions are rechecked after expansion and before any document text reaches the model', async (t) => {
  const source = index(t);
  const query = 'атмосферные вихри';
  const retrieve = (expansions) => retrieveMaterials({ ...source, query, expansions });
  let calls = 0;
  const engine = createSearchAssistant({ config, fetchImpl: async () => {
    calls++;
    source.revoke('semantic');
    return response({ queries: ['циклогенез'] });
  } });
  t.after(() => engine.close());
  const context = { scope: ['w', 'u'], query, items: [], retrieve };
  engine.request(context, { start: true });
  const result = await settled(engine, context);
  assert.equal(result.status, 'ready');
  assert.equal(result.items.length, 0);
  assert.equal(calls, 1);
});

test('cancellation received before a delayed start prevents wasted model work', (t) => {
  const engine = createSearchAssistant({ config, fetchImpl: () => assert.fail('cancelled generation must not start') });
  t.after(() => engine.close());
  const context = { scope: ['w', 'u'], query: 'циклоны', items: [], retrieve: () => ({ items: [], relatedQueries: [] }) };
  engine.request(context, { cancel: true, generation: '1' });
  assert.equal(engine.request(context, { start: true, generation: '1' }).status, 'cancelled');
});

test('semantic candidates retain space when literal results already fill the result budget', () => {
  const base = Array.from({ length: 80 }, (_, i) => ({ source_kind: 'document', source_id: `base-${i}` }));
  const meaning = { source_kind: 'document', source_id: 'new-topic' };
  const result = retrieveMaterials({ query: 'циклон', expansions: ['циклогенез'], find: (q) => q === 'циклон' ? base : [meaning], limit: 80 });
  assert.equal(result.items.length, 80);
  assert.ok(result.items.slice(0, 12).some((item) => item.source_id === 'new-topic'));
  assert.equal(result.items[0].source_id, 'base-0');
});
