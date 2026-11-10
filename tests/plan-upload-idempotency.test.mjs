import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { registerDocument } from '../packages/storage/src/documents.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createAuthAccount } from '../packages/auth/src/service.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';

test('ключ загрузки возвращает только тот же файл в том же workspace, конфликт не раскрывает чужие идентификаторы', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-upload-key-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  t.after(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
  const workspaceId = ensureDefaultWorkspace(database).id;
  database.run('INSERT INTO workspaces(id, code, name, created_at) VALUES (?, ?, ?, ?)',
    'ws_other', 'other-upload', 'Другая кафедра', new Date().toISOString());
  const bytes = Buffer.from('Годовой план кафедры');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const input = {
    workspaceId, title: 'Годовой план', originalName: 'plan.txt', mediaType: 'text/plain', detectedFormat: 'text',
    blob: { sha256, sizeBytes: bytes.length, storagePath: join(root, 'source.txt') },
    requestedType: 'department_plan', idempotencyKey: 'legacy-plan-key'
  };
  const created = registerDocument(database, input);
  const repeated = registerDocument(database, input);
  assert.equal(repeated.duplicateRequest, true);
  assert.equal(repeated.documentId, created.documentId);
  assert.equal(repeated.versionId, created.versionId);
  assert.equal(repeated.jobId, created.jobId);
  const original = database.get('SELECT * FROM document_versions WHERE id = ?', created.versionId);
  const conflicts = [
    { ...input, workspaceId: 'ws_other' },
    { ...input, blob: { ...input.blob, sha256: createHash('sha256').update('Другой файл').digest('hex') } }
  ];
  const errors = conflicts.map((conflict) => {
    let failure;
    assert.throws(() => registerDocument(database, conflict), (cause) => {
      failure = cause;
      return cause.code === 'idempotency_key_conflict' && cause.status === 409;
    });
    assert.equal(failure.details, undefined);
    assert.ok(!failure.message.includes(created.documentId));
    assert.ok(!failure.message.includes(created.versionId));
    return failure.message;
  });
  assert.equal(errors[0], errors[1]);
  assert.deepEqual(database.get('SELECT * FROM document_versions WHERE id = ?', created.versionId), original);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM documents').n, 1);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM document_versions').n, 1);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM jobs').n, 1);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM file_blobs').n, 1);
  assert.deepEqual(database.foreignKeyCheck(), []);
});

test('HTTP повтор загрузки проверяет ACL до ответа и сохраняет владельца, политику и единственное задание', { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-upload-acl-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  let app;
  t.after(async () => {
    if (app) { app.closeAllConnections(); await new Promise((done) => app.close(done)); }
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  const workspaceId = ensureDefaultWorkspace(database).id;
  const owner = createPerson(database, workspaceId, { displayName: 'Владелец плана' });
  const other = createPerson(database, workspaceId, { displayName: 'Другой сотрудник' });
  const password = 'UploadPassword2026';
  createAuthAccount(database, workspaceId, { personId: owner.id, username: 'upload-owner', password, role: 'staff' });
  createAuthAccount(database, workspaceId, { personId: other.id, username: 'upload-other', password, role: 'staff' });
  const config = loadConfig({ KAFEDRA_AUTH_ENABLED: 'true', KAFEDRA_AUTH_MODE: 'accounts', KAFEDRA_DATA_DIR: root,
    KAFEDRA_LLM_ENABLED: 'false', KAFEDRA_OCR_ENABLED: 'false', KAFEDRA_PREVIEW_ENABLED: 'false' });
  app = createApp({ database, config, logger: { info() {}, error() {} } });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  async function login(username) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': result.csrfToken };
  }
  const credentials = await login('upload-owner');
  const otherCredentials = await login('upload-other');
  const bytes = Buffer.from('План кафедры на 2026 год\n1. Методический семинар — 15 ноября');
  async function upload(auth, body = bytes, status = 202) {
    const response = await fetch(`${base}/api/documents`, {
      method: 'POST', headers: { ...auth, 'content-type': 'text/plain', 'x-file-name': 'plan.txt',
        'x-document-type': 'department_plan', 'idempotency-key': 'stable-plan-upload-key' }, body
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return { result, location: response.headers.get('location') };
  }
  const first = await upload(credentials);
  const policy = database.get('SELECT * FROM object_access_policies WHERE object_kind = ? AND object_id = ?', 'document', first.result.documentId);
  assert.equal(policy.owner_person_id, owner.id);
  assert.equal(policy.access_scope, 'restricted');
  const duplicate = await upload(credentials);
  assert.equal(duplicate.result.duplicateRequest, true);
  assert.equal(duplicate.result.documentId, first.result.documentId);
  assert.equal(duplicate.result.versionId, first.result.versionId);
  assert.equal(duplicate.result.jobId, first.result.jobId);
  const forbidden = await upload(otherCredentials, bytes, 403);
  assert.equal(forbidden.result.error.code, 'object_access_forbidden');
  assert.equal(forbidden.location, null);
  assert.ok(!JSON.stringify(forbidden.result).includes(first.result.documentId));
  const conflict = await upload(credentials, Buffer.from('Другой план'), 409);
  assert.equal(conflict.result.error.code, 'idempotency_key_conflict');
  assert.equal(conflict.location, null);
  assert.ok(!JSON.stringify(conflict.result).includes(first.result.documentId));
  assert.deepEqual(database.get('SELECT * FROM object_access_policies WHERE object_kind = ? AND object_id = ?', 'document', first.result.documentId), policy);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM documents').n, 1);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM document_versions').n, 1);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM jobs').n, 1);
  assert.deepEqual(database.foreignKeyCheck(), []);
});
