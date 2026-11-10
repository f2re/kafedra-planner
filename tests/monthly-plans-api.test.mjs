import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createAuthAccount } from '../packages/auth/src/service.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';

test('HTTP: общий реестр → состав месяца → DOCX, CSRF, stale edits и повторный ACL источников', { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-monthly-api-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspaceId = ensureDefaultWorkspace(database).id;
  const owner = createPerson(database, workspaceId, { displayName: 'Оператор кафедры' });
  const other = createPerson(database, workspaceId, { displayName: 'Автор исходного плана' });
  createAuthAccount(database, workspaceId, { personId: owner.id, username: 'monthly-editor', password: 'MonthlyPassword2026', role: 'staff' });
  createAuthAccount(database, workspaceId, { personId: other.id, username: 'monthly-other', password: 'OtherMonthlyPassword2026', role: 'staff' });
  const sourcePlan = createManualPlan(database, workspaceId, {
    title: 'План института', planKind: 'organization', periodKind: 'calendar', year: 2026, accessScope: 'workspace'
  }, other.id);
  const source = createManualPlanItem(database, workspaceId, sourcePlan.id, {
    title: 'Семинар кафедры метеорологии', startsAt: '2026-11-18', direction: 'science'
  }, other.id);
  const privatePlan = createManualPlan(database, workspaceId, {
    title: 'ЧУЖОЙ_ЗАКРЫТЫЙ_ПЛАН', planKind: 'personal', periodKind: 'calendar', year: 2026, accessScope: 'restricted'
  }, other.id);
  const privateItem = createManualPlanItem(database, workspaceId, privatePlan.id, {
    title: 'ЧУЖОЕ_ЗАКРЫТОЕ_МЕРОПРИЯТИЕ', dueDate: '2026-11-20'
  }, other.id);
  const config = loadConfig({ KAFEDRA_AUTH_ENABLED: 'true', KAFEDRA_AUTH_MODE: 'accounts', KAFEDRA_DATA_DIR: root,
    KAFEDRA_LLM_ENABLED: 'false', KAFEDRA_OCR_ENABLED: 'false', KAFEDRA_PREVIEW_ENABLED: 'false' });
  const app = createApp({ database, config, logger: { info() {}, error() {} } });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => {
    app.closeAllConnections();
    await new Promise((done) => app.close(done));
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  async function login(username, password) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': payload.csrfToken, 'content-type': 'application/json' };
  }
  const headers = await login('monthly-editor', 'MonthlyPassword2026');
  const otherHeaders = await login('monthly-other', 'OtherMonthlyPassword2026');
  async function json(path, { method = 'GET', body, credentials = headers, status = 200 } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: credentials, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  }

  await json('/api/monthly-plans', { credentials: {}, status: 401 });
  await json('/api/monthly-plans', { method: 'POST', body: null, status: 400 });
  await json('/api/monthly-plans', { method: 'POST', credentials: { cookie: headers.cookie, 'content-type': 'application/json' }, body: { month: '2026-11', idempotencyKey: 'csrf-fails' }, status: 403 });
  const events = await json('/api/plan-events?month=2026-11&department=%D0%BC%D0%B5%D1%82%D0%B5%D0%BE%D1%80%D0%BE%D0%BB%D0%BE%D0%B3%D0%B8%D0%B8');
  assert.deepEqual(events.items.map((row) => row.id), [source.id]);
  let draft = await json('/api/monthly-plans', { method: 'POST', status: 201, body: {
    month: '2026-11', title: 'Месячный план', idempotencyKey: 'api-monthly-create', planItemIds: [source.id, privateItem.id, 'missing-item']
  } });
  assert.deepEqual(draft.results.map((row) => row.status), ['added', 'error', 'error']);
  assert.equal(draft.results[1].code, draft.results[2].code);
  assert.equal(draft.results[1].message, draft.results[2].message);
  assert.doesNotMatch(JSON.stringify(draft), /ЧУЖОЙ_ЗАКРЫТЫЙ_ПЛАН|ЧУЖОЕ_ЗАКРЫТОЕ_МЕРОПРИЯТИЕ/u);
  await json(`/api/monthly-plans/${draft.id}`, { credentials: otherHeaders, status: 403 });
  assert.equal((await json('/api/monthly-plans', { credentials: otherHeaders })).items.length, 0);

  const membershipId = draft.items[0].id;
  const originalRevision = draft.revision;
  draft = await json(`/api/monthly-plans/${draft.id}/items/${membershipId}`, { method: 'PATCH', body: {
    expectedRevision: originalRevision, titleOverride: 'Участие в семинаре', dateTextOverride: '18 ноября', note: 'Исключительно месячная правка'
  } });
  await json(`/api/monthly-plans/${draft.id}`, { method: 'PATCH', status: 409, body: { expectedRevision: originalRevision, title: 'Устаревший заголовок' } });
  const exported = await json(`/api/monthly-plans/${draft.id}/export`, { method: 'POST', body: { expectedRevision: draft.revision, idempotencyKey: 'api-monthly-export' } });
  assert.ok(exported.documentId);
  const downloaded = await fetch(`${base}${exported.downloadUrl}`, { headers });
  assert.equal(downloaded.status, 200);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  await json(`/api/documents/${exported.documentId}`);
  const template = await json('/api/plan-templates', { method: 'POST', status: 201,
    body: { documentId: exported.documentId, name: 'Образец месячного плана', planKind: 'department' } });
  const blockedReprocess = await json(`/api/documents/${exported.documentId}/reprocess`, { method: 'POST', status: 409, body: {} });
  assert.equal(blockedReprocess.error.code, 'monthly_plan_export_is_snapshot');
  await json(`/api/documents/${exported.documentId}`, { credentials: otherHeaders, status: 403 });

  database.run("UPDATE object_access_policies SET access_scope = 'restricted' WHERE object_kind = 'plan' AND object_id = ?", sourcePlan.id);
  const revoked = await json(`/api/monthly-plans/${draft.id}`);
  assert.equal(revoked.unavailableCount, 1);
  assert.deepEqual(revoked.items, [{ id: membershipId, position: 0, unavailable: true }]);
  assert.doesNotMatch(JSON.stringify(revoked), /Участие в семинаре|Исключительно месячная правка/u);
  await json(`/api/monthly-plans/${draft.id}/export`, { method: 'POST', status: 409, body: { expectedRevision: draft.revision, idempotencyKey: 'api-monthly-export-after-revoke' } });
  await json(`/api/documents/${exported.documentId}`, { status: 403 });
  assert.equal((await fetch(`${base}${exported.downloadUrl}`, { headers })).status, 403);
  // A document-ID body must not bypass the live source ACL through another feature.
  await json('/api/plan-templates/analyze', { method: 'POST', status: 403, body: { documentId: exported.documentId } });
  await json('/api/templates/preview', { method: 'POST', status: 403, body: { documentVersionId: exported.versionId } });
  assert.equal((await json('/api/documents')).items.some((row) => row.id === exported.documentId), false);
  assert.equal((await json('/api/plan-templates')).items.some((row) => row.id === template.id), false);
  draft = await json(`/api/monthly-plans/${draft.id}/items/${membershipId}?expectedRevision=${draft.revision}`, { method: 'DELETE' });
  assert.equal(draft.items.length, 0);
  // Removing membership cannot bypass the original export's immutable source ACL.
  await json(`/api/documents/${exported.documentId}`, { status: 403 });
  // Even a malformed cyclic source graph fails closed without overflowing resolution.
  database.run("UPDATE plans SET origin_kind = 'document', source_document_version_id = ? WHERE id = ?", exported.versionId, sourcePlan.id);
  await json('/api/plan-templates/analyze', { method: 'POST', status: 403, body: { documentId: exported.documentId } });
  assert.equal(database.get("SELECT COUNT(*) AS n FROM jobs WHERE payload_json LIKE ?", `%${exported.versionId}%`).n, 0);
  assert.equal(database.quickCheck(), true);
  assert.deepEqual(database.foreignKeyCheck(), []);
});
