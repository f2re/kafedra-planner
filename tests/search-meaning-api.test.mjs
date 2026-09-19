import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { addSearchFragment } from '../packages/storage/src/search.mjs';
import { createAuthAccount } from '../packages/auth/src/service.mjs';
import { ensureObjectPolicy } from '../packages/access-control/src/service.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }

test('real authenticated API retrieves semantic documents, preserves filters and invalidates revoked evidence', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meaning-api-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const date = '2026-09-19T00:00:00.000Z';
  for (const id of ['staff', 'other']) database.run(`INSERT INTO people(id,workspace_id,display_name,normalized_name,status,created_at,updated_at)
    VALUES(?,?,?,?,'active',?,?)`, id, workspace.id, id, id, date, date);
  createAuthAccount(database, workspace.id, { personId: 'staff', username: 'searcher', password: 'SearchPassword2026', role: 'staff' });
  function document(id, title, content, owner = 'staff', lifecycle = 'active') {
    const hash = createHash('sha256').update(content).digest('hex');
    database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES(?,?,'text/plain',?,?)`,
      hash, Buffer.byteLength(content), join(root, hash), date);
    database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,lifecycle_status,created_at,updated_at)
      VALUES(?,?,?,'report','processed',?,?,?,?)`, id, workspace.id, title, `ver-${id}`, lifecycle, date, date);
    database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at)
      VALUES(?,?,1,?,?,'text/plain','txt','processed',?,?)`, `ver-${id}`, id, hash, `${id}.txt`, content, date);
    ensureObjectPolicy(database, { workspaceId: workspace.id, objectKind: 'document', objectId: id, ownerPersonId: owner, accessScope: 'restricted' });
    addSearchFragment(database, { workspaceId: workspace.id, sourceKind: 'document_version', sourceId: `ver-${id}`,
      documentVersionId: `ver-${id}`, title, content, locator: { documentId: id, page: 1 } });
  }
  document('report', 'Отчёт кафедры', 'В отчёте приведена статья о циклонах и их развитии.');
  document('minutes', 'Протокол заседания', 'Обсуждалась статья о развитии циклонов над Балтикой.');
  document('semantic', 'Научный результат', 'В отчёте изучен циклогенез и образование барических депрессий.');
  document('private', 'Чужой секретный источник', 'Циклогенез СЕКРЕТНАЯВСТАВКА, которую модель не должна увидеть.', 'other');
  document('archived', 'Архивный источник', 'Циклогенез АРХИВНАЯВСТАВКА, не использовать по умолчанию.', 'staff', 'archived');
  const modelInputs = [];
  const model = createServer(async (request, response) => {
    const parts = []; for await (const part of request) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const input = JSON.parse(body.messages[1].content);
    modelInputs.push(input);
    const candidate = input.candidates?.find((item) => item.id === 'document_version:ver-semantic');
    const output = input.candidates ? { suggestions: candidate ? [{ id: candidate.id, quote: candidate.text }] : [] }
      : { queries: ['циклогенез'] };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
  });
  const endpoint = await listen(model);
  const config = loadConfig({ KAFEDRA_AUTH_ENABLED: 'true', KAFEDRA_AUTH_MODE: 'accounts', KAFEDRA_DATA_DIR: root,
    KAFEDRA_LLM_ENABLED: 'true', KAFEDRA_LLM_ENDPOINT: endpoint, KAFEDRA_OCR_ENABLED: 'false', KAFEDRA_PREVIEW_ENABLED: 'false' });
  const app = createApp({ database, config, logger: { info() {}, error() {} } });
  const base = await listen(app);
  t.after(async () => { await close(app); await close(model); database.close(); await rm(root, { recursive: true, force: true }); });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'searcher', password: 'SearchPassword2026' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'x-kafedra-assistant': 'search-evidence-v1' };
  async function search(q, extra = {}) {
    const params = new URLSearchParams({ q, assistContext: '0123456789abcdef', assistGeneration: '1', ...extra });
    const response = await fetch(`${base}/api/search?${params}`, { headers });
    assert.equal(response.status, 200);
    return response.json();
  }
  const conversational = await search('отчёт где была статья про циклоны', { sourceKind: 'document' });
  assert.ok(conversational.items.some((item) => item.source_id === 'ver-report'));
  assert.ok(conversational.items.some((item) => item.source_id === 'ver-minutes'));
  assert.ok(conversational.items.every((item) => item.route.kind === 'document' && item.source_document_id));
  const query = 'образование атмосферных вихрей';
  const ordinary = await search(query);
  assert.equal(ordinary.items.length, 0);
  assert.equal((await search(query, { assist: 'start' })).assistant.status, 'queued');
  let ready;
  for (let count = 0; count < 100; count++) {
    ready = await search(query, { assist: 'poll' });
    if (ready.assistant.status === 'ready') break;
    await sleep(20);
  }
  assert.equal(ready.assistant.status, 'ready');
  assert.ok(ready.assistant.items.some((item) => item.source_id === 'ver-semantic'));
  assert.equal(ready.assistant.suggestions[0].id, 'document_version:ver-semantic');
  assert.doesNotMatch(JSON.stringify(modelInputs), /СЕКРЕТНАЯВСТАВКА|АРХИВНАЯВСТАВКА/u);
  assert.equal((await search(query, { sourceKind: 'periodic_task', assist: 'poll' })).assistant.status, 'idle');
  database.run("UPDATE object_access_policies SET owner_person_id='other' WHERE object_id='semantic'");
  const revoked = await search(query, { assist: 'poll' });
  assert.equal(revoked.assistant.status, 'idle');
  assert.doesNotMatch(JSON.stringify(revoked), /ver-semantic|барических депрессий/u);
  assert.equal(database.getSchemaVersion(), 31);
});
