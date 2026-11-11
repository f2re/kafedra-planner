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
import { defaultEventTemplateDefinition } from '../packages/plans/src/event-templates.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';

test('HTTP: версии шаблона, канонические поля, частные данные и месячные печатные правки', { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-event-template-api-'));
  const db = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  const ws = ensureDefaultWorkspace(db).id;
  const owner = createPerson(db, ws, { displayName: 'Оператор кафедры' });
  const other = createPerson(db, ws, { displayName: 'Другой сотрудник' });
  for (const [person, username] of [[owner, 'event-owner'], [other, 'event-reader']]) {
    createAuthAccount(db, ws, { personId: person.id, username, password: 'EventPassword2026', role: 'staff' });
  }
  const plan = createManualPlan(db, ws, { title: 'План кафедры', planKind: 'department', periodKind: 'calendar', year: 2026, accessScope: 'workspace' }, owner.id);
  const item = createManualPlanItem(db, ws, plan.id, { title: 'Семинар', startsAt: '2026-11-18' }, owner.id);
  const config = loadConfig({ KAFEDRA_AUTH_ENABLED: 'true', KAFEDRA_AUTH_MODE: 'accounts', KAFEDRA_DATA_DIR: root,
    KAFEDRA_LLM_ENABLED: 'false', KAFEDRA_OCR_ENABLED: 'false', KAFEDRA_PREVIEW_ENABLED: 'false' });
  const app = createApp({ database: db, config, logger: { info() {}, error() {} } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { app.closeAllConnections(); await new Promise((done) => app.close(done)); db.close(); await rm(root, { recursive: true, force: true }); });
  async function login(username) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'EventPassword2026' }) });
    assert.equal(response.status, 200); const payload = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': payload.csrfToken, 'content-type': 'application/json' };
  }
  const headers = await login('event-owner'); const otherHeaders = await login('event-reader');
  async function json(path, { method = 'GET', body, credentials = headers, status = 200 } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: credentials, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`); return result;
  }
  await json('/api/event-templates', { credentials: {}, status: 401 });
  await json('/api/event-templates', { method: 'POST', credentials: { cookie: headers.cookie, 'content-type': 'application/json' }, body: {}, status: 403 });
  const definition = defaultEventTemplateDefinition();
  definition.fields.push({ key: 'custom_participation', source: 'custom', label: 'Форма участия', type: 'select', options: ['Доклад', 'Слушатель'], visible: true, required: false, width: 15 });
  const create = { title: 'План мероприятий', definition, idempotencyKey: 'http-template' };
  const template = await json('/api/event-templates', { method: 'POST', body: create, status: 201 });
  assert.equal((await json('/api/event-templates', { method: 'POST', body: create })).id, template.id);
  assert.equal((await json('/api/event-templates')).items[0].currentVersionId, template.currentVersionId);
  await json(`/api/event-templates/${template.id}`, { credentials: otherHeaders, status: 403 });
  assert.deepEqual((await json('/api/event-templates', { credentials: otherHeaders })).items, []);
  const source = await json(`/api/plan-events/${item.id}/details`);
  assert.equal(source.revision, 0);
  const details = await json(`/api/plan-events/${item.id}/details`, { method: 'PATCH', body: { expectedRevision: 0, location: 'Аудитория 201', templateVersionId: template.currentVersionId, customValues: { custom_participation: 'Доклад' } } });
  assert.equal(details.revision, 1);
  await json(`/api/plan-events/${item.id}/details`, { method: 'PATCH', credentials: otherHeaders, body: { expectedRevision: 1, location: 'Подмена' }, status: 403 });
  await json(`/api/plan-events/${item.id}/details`, { method: 'PATCH', body: { expectedRevision: 0, location: 'Устаревшая правка' }, status: 409 });
  await json(`/api/plan-events/${item.id}/details`, { method: 'PATCH', body: { expectedRevision: 1, templateVersionId: template.currentVersionId, customValues: { custom_participation: 'Неизвестно' } }, status: 400 });
  assert.equal((await json('/api/plan-events?month=2026-11', { credentials: otherHeaders })).items[0].canEditDetails, false);
  let draft = await json('/api/monthly-plans', { method: 'POST', status: 201, body: { month: '2026-11', eventTemplateVersionId: template.currentVersionId, departmentText: 'Кафедра метеорологии', planItemIds: [item.id], idempotencyKey: 'http-monthly' } });
  draft = await json(`/api/monthly-plans/${draft.id}/items/${draft.items[0].id}`, { method: 'PATCH', body: { expectedRevision: draft.revision, locationOverride: 'Актовый зал', customValues: { custom_participation: 'Слушатель' } } });
  assert.equal(draft.items[0].effective.location, 'Актовый зал');
  assert.equal(draft.items[0].effective.customValues.custom_participation, 'Слушатель');
  assert.equal((await json(`/api/plan-events/${item.id}/details`)).location, 'Аудитория 201');
  const newVersion = await json(`/api/event-templates/${template.id}/versions`, { method: 'POST', status: 201, body: { expectedVersion: 1, title: 'План мероприятий, новая версия', definition: { ...definition, layout: { orientation: 'portrait', showRowNumbers: false } }, idempotencyKey: 'http-new-version' } });
  assert.equal(newVersion.version, 2);
  assert.equal((await json(`/api/monthly-plans/${draft.id}`)).eventTemplate.version, 1);
  assert.equal(db.quickCheck(), true); assert.deepEqual(db.foreignKeyCheck(), []);
});
