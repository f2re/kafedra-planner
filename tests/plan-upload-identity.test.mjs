import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { planUploadKey, sha256Fallback } from '../public/plan-upload-identity.js';

test('локальный HTTP fallback SHA-256 совпадает с Node на коротких, граничных и двоичных файлах', () => {
  for (const bytes of [Buffer.from(''), Buffer.from('abc'), Buffer.from('План кафедры на ноябрь 2026 года'), ...[55, 56, 63, 64, 65, 1024, 65536].map(size => randomBytes(size))]) {
    assert.equal(sha256Fallback(bytes), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('ключ загрузки ожидает auth и разделяет workspace, аккаунт, назначение и содержимое', async t => {
  const previous = globalThis.window;
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  globalThis.window = { kafedraAuthReady: Promise.resolve().then(() => {
    globalThis.window.kafedraAuthContext = { authEnabled: true, authenticated: true, user: { workspaceId: 'ws-a', id: 'user-a', personId: 'person-a' } };
  }) };
  const file = new File(['мероприятие'], 'Русское название.docx');
  const key = await planUploadKey(file, 'plan-ui');
  assert.match(key, /^plan-ui:[0-9a-f]{64}$/u);
  assert.equal(await planUploadKey(new File(['мероприятие'], 'Другое название.docx'), 'plan-ui'), key);
  assert.notEqual(await planUploadKey(file, 'monthly-template'), key);
  assert.notEqual(await planUploadKey(new File(['другое мероприятие'], file.name), 'plan-ui'), key);
  window.kafedraAuthContext.user.id = 'user-b';
  assert.notEqual(await planUploadKey(file, 'plan-ui'), key);
  window.kafedraAuthContext.user.id = 'user-a';
  window.kafedraAuthContext.user.workspaceId = 'ws-b';
  assert.notEqual(await planUploadKey(file, 'plan-ui'), key);
  window.kafedraAuthContext.authenticated = false;
  await assert.rejects(planUploadKey(file, 'plan-ui'), /Войдите/u);
});

test('auth-disabled upload использует namespace браузера и реальный workspace', async t => {
  const prior = { window: globalThis.window, fetch: globalThis.fetch, storage: globalThis.localStorage };
  t.after(() => {
    if (prior.window === undefined) delete globalThis.window; else globalThis.window = prior.window;
    globalThis.fetch = prior.fetch;
    if (prior.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior.storage;
  });
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.window = { kafedraAuthContext: { authEnabled: false, authenticated: true } };
  let workspace = 'development-a';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [{ id: workspace }] }) });
  const file = new File(['тестовый план'], 'plan.txt');
  const key = await planUploadKey(file, 'plan-ui');
  assert.ok(storage.get('kafedra-disabled-upload-browser'));
  assert.equal(await planUploadKey(file, 'plan-ui'), key);
  workspace = 'development-b';
  assert.notEqual(await planUploadKey(file, 'plan-ui'), key);
});
