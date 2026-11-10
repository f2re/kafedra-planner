import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { ensureObjectPolicy } from '../packages/access-control/src/service.mjs';
import {
  assistantCandidateSources, saveAssistantRun, listAssistantRuns, getAssistantRun, deleteAssistantRuns
} from '../packages/ai/src/assistant-history.mjs';
import { createAssistantRouter } from '../apps/api/src/assistant-router.mjs';

const migrationsDir = resolve('migrations');
const now = '2026-11-10T12:00:00.000Z';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-assistant-history-'));
  const db = new Database(join(root, 'work.sqlite3'), { migrationsDir });
  const ws = ensureDefaultWorkspace(db);
  return { root, db, ws, dispose: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}
function ctx(ws, accountId, personId = accountId, role = 'admin') {
  return { enabled: true, authenticated: true, accountId, personId, role, workspaceId: ws.id };
}

test('постоянная история: SQLite, пагинация, изоляция оператора, удаление', () => {
  const f = fixture();
  try {
    const one = ctx(f.ws, 'one');
    const two = ctx(f.ws, 'two');
    for (let i = 0; i < 38; i++) {
      saveAssistantRun(f.db, {
        workspaceId: f.ws.id, context: one, task: 'formula-calc',
        promptText: 'Вычислить сумму ' + i, status: 'completed',
        result: { type: 'formula', formula: '=СУММ(A1:A3)', description: String(i) },
        rawResponse: '{"formula":"=СУММ(A1:A3)"}'
      });
    }
    const first = listAssistantRuns(f.db, { workspaceId: f.ws.id, context: one, limit: 17 });
    assert.equal(first.items.length, 17);
    assert.ok(first.nextCursor);
    const second = listAssistantRuns(f.db, { workspaceId: f.ws.id, context: one, limit: 17, cursor: first.nextCursor });
    assert.equal(second.items.length, 17);
    assert.equal(new Set(first.items.concat(second.items).map((item) => item.id)).size, 34);
    assert.equal(listAssistantRuns(f.db, { workspaceId: f.ws.id, context: two }).items.length, 0);
    assert.equal(getAssistantRun(f.db, { workspaceId: f.ws.id, context: two, id: first.items[0].id }), null);
    assert.equal(getAssistantRun(f.db, { workspaceId: f.ws.id, context: one, id: first.items[0].id }).result.type, 'formula');
    assert.match(getAssistantRun(f.db, { workspaceId: f.ws.id, context: one, id: first.items[0].id }).rawResponse, /СУММ/u);
    assert.equal(deleteAssistantRuns(f.db, { workspaceId: f.ws.id, context: two }), 0);
    assert.equal(deleteAssistantRuns(f.db, { workspaceId: f.ws.id, context: one, id: first.items[0].id }), 1);
    assert.equal(deleteAssistantRuns(f.db, { workspaceId: f.ws.id, context: one }), 37);
    assert.equal(f.db.all('PRAGMA foreign_key_check').length, 0);
    assert.equal(f.db.quickCheck(), true);
  } finally { f.dispose(); }
});

test('ссылка сохраняет конкретную версию и становится недоступной после отзыва ACL', () => {
  const f = fixture();
  try {
    for (const id of ['per1', 'per2']) {
      f.db.run(
        'INSERT INTO people(id, workspace_id, display_name, normalized_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, f.ws.id, id, id, 'active', now, now
      );
    }
    f.db.run('INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at) VALUES (?, ?, ?, ?, ?)',
      'b'.repeat(64), 12, 'application/pdf', '/tmp/assistant-hist-pdf', now);
    f.db.run('INSERT INTO documents(id, workspace_id, title, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'doc-history', f.ws.id, 'Источниковый протокол', 'processed', 'version-history', now, now);
    f.db.run('INSERT INTO document_versions(id, document_id, version_no, blob_sha256, original_name, media_type, detected_format, processing_status, uploaded_at, preview_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'version-history', 'doc-history', 1, 'b'.repeat(64), 'original.pdf', 'application/pdf', 'pdf', 'completed', now, 'ready');
    ensureObjectPolicy(f.db, {
      workspaceId: f.ws.id, objectKind: 'document', objectId: 'doc-history',
      ownerPersonId: 'per1', accessScope: 'restricted'
    });
    const user1 = ctx(f.ws, 'account1', 'per1', 'staff');
    const user2 = ctx(f.ws, 'account2', 'per2', 'staff');
    const candidates = [{ kind: 'document', id: 'doc-history', documentVersionId: 'version-history',
      title: 'Реальный протокол', snippet: 'Содержится подтвержденная цитата' }];
    const refs = assistantCandidateSources(f.db, f.ws.id, user1, candidates);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].versionId, 'version-history');
    assert.equal(refs[0].previewAvailable, true);
    assert.equal(assistantCandidateSources(f.db, f.ws.id, user2, candidates).length, 0);
    const id = saveAssistantRun(f.db, {
      workspaceId: f.ws.id, context: user1, task: 'archive-query', promptText: 'Найти протокол',
      status: 'completed', result: { type: 'raw', text: 'Содержимое, зависящее от документа' },
      sources: candidates
    });
    assert.equal(getAssistantRun(f.db, { workspaceId: f.ws.id, context: user1, id }).sources.length, 1);
    assert.equal(getAssistantRun(f.db, { workspaceId: f.ws.id, context: user2, id }), null);
    f.db.run("UPDATE object_access_policies SET owner_person_id = 'per2' WHERE workspace_id = ? AND object_kind = 'document' AND object_id = 'doc-history'", f.ws.id);
    const blocked = getAssistantRun(f.db, { workspaceId: f.ws.id, context: user1, id });
    assert.equal(blocked.redacted, true);
    assert.equal(blocked.promptText, '');
    assert.equal(blocked.result, null);
    assert.deepEqual(blocked.sources, []);
  } finally { f.dispose(); }
});

function request(method, path, body, auth) {
  return {
    method, headers: { 'content-type': 'application/json' }, auth, url: path,
    on() {}, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); }
  };
}
function response() {
  let raw = '';
  let code = 200;
  return {
    writableEnded: false,
    writeHead(status) { code = status; },
    setHeader() {},
    write(chunk) { raw += String(chunk); },
    end(chunk = '') { raw += String(chunk); this.writableEnded = true; },
    get statusCode() { return code; },
    get rawBody() { return raw; },
    get body() { try { return JSON.parse(raw); } catch { return null; } }
  };
}

test('assistant API сохраняет ответ, возвращает историю и удаляет запись без LLM', async () => {
  const f = fixture();
  try {
    const user = ctx(f.ws, 'test-user');
    const engine = {
      enabled: true,
      process: async () => ({
        status: 'completed', result: { type: 'formula', formula: '=СУММ(A1:A2)' }, durationMs: 12
      }),
      streamProcess: async ({ onDone }) => onDone({
        status: 'completed', result: { type: 'raw', text: 'Ответ\n- строка' }, durationMs: 5
      })
    };
    const router = createAssistantRouter({
      config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:9999' },
      database: f.db, engine, logger: { warn() {} }
    });
    const invoke = async (method, path, body, auth = user) => {
      const res = response();
      const handled = await router(request(method, path, body, auth), res, new URL(path, 'http://127.0.0.1'));
      assert.equal(handled, true);
      return res;
    };
    const created = await invoke('POST', '/api/assistant/process', { task: 'formula-calc', text: 'Сумма строк' });
    assert.equal(created.statusCode, 200);
    assert.equal(created.body.historySaved, true);
    assert.ok(created.body.runId);
    const streamed = await invoke('POST', '/api/assistant/stream', { task: 'formula-calc', text: 'Другой запрос' });
    assert.match(streamed.rawBody, /event: done/u);
    assert.match(streamed.rawBody, /historySaved/u);
    const list = await invoke('GET', '/api/assistant/history?limit=20');
    assert.equal(list.body.items.length, 2);
    const saved = await invoke('GET', '/api/assistant/history/' + created.body.runId);
    assert.equal(saved.body.entry.result.formula, '=СУММ(A1:A2)');
    assert.equal(saved.body.entry.promptText, 'Сумма строк');
    const other = await invoke('GET', '/api/assistant/history', null, ctx(f.ws, 'other-account'));
    assert.equal(other.body.items.length, 0);
    const deleted = await invoke('DELETE', '/api/assistant/history/' + created.body.runId);
    assert.equal(deleted.body.deleted, 1);
    assert.equal((await invoke('GET', '/api/assistant/history')).body.items.length, 1);
  } finally { f.dispose(); }
});

test('schema 31→32 upgrade, repeated run and transactional migration failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-assistant-upgrade-'));
  const dbPath = join(root, 'upgrade.sqlite3');
  const oldMigrations = join(root, 'old');
  const brokenMigrations = join(root, 'broken');
  try {
    const mkdir = (path) => { cpSync(migrationsDir, path, { recursive: true }); };
    mkdir(oldMigrations);
    for (const name of readdirSync(oldMigrations)) {
      if (/^032_/u.test(name)) rmSync(join(oldMigrations, name));
    }
    const old = new Database(dbPath, { migrationsDir: oldMigrations });
    const ws = ensureDefaultWorkspace(old);
    assert.equal(old.getSchemaVersion(), 31);
    old.close();

    const upgraded = new Database(dbPath, { migrationsDir });
    assert.equal(upgraded.getSchemaVersion(), 32);
    assert.equal(upgraded.quickCheck(), true);
    assert.deepEqual(upgraded.foreignKeyCheck(), []);
    upgraded.migrate(migrationsDir);
    assert.equal(upgraded.getSchemaVersion(), 32);
    assert.ok(upgraded.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assistant_runs'"));
    assert.ok(upgraded.get('SELECT id FROM workspaces WHERE id = ?', ws.id));
    upgraded.close();

    mkdir(brokenMigrations);
    writeFileSync(join(brokenMigrations, '033_forced_failure.sql'),
      'CREATE TABLE assistant_migration_probe(id INTEGER); INSERT INTO does_not_exist VALUES(1);');
    const reopen = new Database(dbPath);
    assert.throws(() => reopen.migrate(brokenMigrations), /no such table/u);
    assert.equal(reopen.getSchemaVersion(), 32);
    assert.equal(reopen.get("SELECT name FROM sqlite_master WHERE name='assistant_migration_probe'"), undefined);
    assert.equal(reopen.quickCheck(), true);
    assert.deepEqual(reopen.foreignKeyCheck(), []);
    reopen.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
