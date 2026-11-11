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

test('HTTP selection is authenticated, CSRF protected, source-filtered and applied by server run id', { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-selection-api-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspaceId = ensureDefaultWorkspace(database).id;
  const owner = createPerson(database, workspaceId, { displayName: 'Оператор кафедры' });
  const other = createPerson(database, workspaceId, { displayName: 'Другой оператор' });
  createAuthAccount(database, workspaceId, { personId: owner.id, username: 'selector', password: 'SelectionPassword2026', role: 'staff' });
  createAuthAccount(database, workspaceId, { personId: other.id, username: 'selection-other', password: 'SelectionPassword2026', role: 'staff' });
  const plan = createManualPlan(database, workspaceId, { title: 'План кафедры метеорологии', planKind: 'department', periodKind: 'calendar', year: 2026 }, owner.id);
  const item = createManualPlanItem(database, workspaceId, plan.id, { title: 'Открытое занятие', startsAt: '2026-11-18' }, owner.id);
  const privatePlan = createManualPlan(database, workspaceId, { title: 'PRIVATE_SELECTION_PLAN', planKind: 'personal', periodKind: 'calendar', year: 2026, accessScope: 'restricted' }, other.id);
  createManualPlanItem(database, workspaceId, privatePlan.id, { title: 'PRIVATE_SELECTION_ITEM', startsAt: '2026-11-18' }, other.id);
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
  async function login(username) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'SelectionPassword2026' }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': payload.csrfToken, 'content-type': 'application/json' };
  }
  const headers = await login('selector'), otherHeaders = await login('selection-other');
  async function json(path, { method = 'GET', body, credentials = headers, status = 200 } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: credentials, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  }
  const input = { month: '2026-11', department: 'Кафедра метеорологии', idempotencyKey: 'api-suggest' };
  await json('/api/plan-events/suggest', { method: 'POST', body: input, credentials: {}, status: 401 });
  await json('/api/plan-events/suggest', { method: 'POST', body: input, credentials: { cookie: headers.cookie, 'content-type': 'application/json' }, status: 403 });
  const run = await json('/api/plan-events/suggest', { method: 'POST', body: input });
  assert.equal(run.items.length, 1);
  assert.equal(run.items[0].planItemId, item.id);
  assert.equal(run.items[0].relevance, 'recommended');
  assert.doesNotMatch(JSON.stringify(run), /PRIVATE_SELECTION_PLAN|PRIVATE_SELECTION_ITEM/u);
  assert.equal((await json('/api/plan-events/suggest', { method: 'POST', body: input })).runId, run.runId);
  await json(`/api/plan-events/suggestions/${run.runId}`, { credentials: otherHeaders, status: 403 });
  const draft = await json('/api/monthly-plans', { method: 'POST', status: 201, body: { month: '2026-11', departmentText: input.department, idempotencyKey: 'api-month' } });
  const accepted = await json(`/api/monthly-plans/${draft.id}/apply-suggestion`, { method: 'POST', body: {
    runId: run.runId, planItemIds: [item.id, 'invented'], expectedRevision: draft.revision,
    suggestedFields: { location: 'Подмена клиентом' }, evidence: { model: 'forged' }
  } });
  assert.deepEqual(accepted.results.map((result) => result.status), ['added', 'error']);
  assert.equal(accepted.draft.items[0].effective.location, '');
  assert.equal(accepted.draft.items[0].selectionEvidence.runId, run.runId);
  assert.equal(accepted.draft.items[0].selectionEvidence.model, null);
  await json(`/api/monthly-plans/${draft.id}/apply-suggestion`, { method: 'POST', credentials: otherHeaders, status: 403,
    body: { runId: run.runId, planItemIds: [item.id], expectedRevision: draft.revision } });
  const repeated = await json(`/api/monthly-plans/${draft.id}/apply-suggestion`, { method: 'POST', body: { runId: run.runId, planItemIds: [item.id], expectedRevision: draft.revision } });
  assert.equal(repeated.duplicateRequest, true);
  assert.equal(repeated.draft.items.length, 1);
});
