import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { searchFaceted } from '../packages/storage/src/faceted-search.mjs';
import { createMeeting } from '../packages/protocols/src/meetings.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createAuthAccount } from '../packages/auth/src/service.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';

test('manual meetings and plan items remain searchable without invented source documents', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-manual-search-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  t.after(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
  const workspace = ensureDefaultWorkspace(database);
  const date = new Date().toISOString();
  for (const id of ['staff', 'other']) database.run(`INSERT INTO people(id,workspace_id,display_name,normalized_name,status,created_at,updated_at)
    VALUES(?,?,?,?,'active',?,?)`, id, workspace.id, id, id, date, date);
  createAuthAccount(database, workspace.id, { personId: 'staff', username: 'searcher', password: 'SearchPassword2026', role: 'staff' });
  const own = createMeeting(database, workspace.id, { meetingDate: '2026-09-15', protocolNumber: 'MANUAL-1' }, 'staff');
  const other = createMeeting(database, workspace.id, { meetingDate: '2026-09-16', protocolNumber: 'MANUAL-2' }, 'other');
  const plan = createManualPlan(database, workspace.id, { planKind: 'personal', periodKind: 'calendar', year: 2026, title: 'Исследование циклонов' }, 'staff');
  const item = createManualPlanItem(database, workspace.id, plan.id, { title: 'Исследование циклогенеза', dueDate: '2026-10-10' }, 'staff');
  const privatePlan = createManualPlan(database, workspace.id, { planKind: 'personal', periodKind: 'calendar', year: 2026, title: 'Исследование чужого сотрудника' }, 'other');
  const meetings = searchFaceted(database, workspace.id, { sourceKind: 'protocol', number: 'MANUAL-' });
  assert.equal(meetings.items.length, 2);
  assert.ok(meetings.items.every((row) => row.source_document_id === null && row.document_version_id === null));
  const plans = searchFaceted(database, workspace.id, { sourceKind: 'plans', period: '2026' });
  assert.ok(plans.items.some((row) => row.source_id === plan.id));
  assert.ok(plans.items.some((row) => row.source_id === item.id));
  const config = loadConfig({ KAFEDRA_DATA_DIR: root, KAFEDRA_AUTH_ENABLED: 'true', KAFEDRA_AUTH_MODE: 'accounts', KAFEDRA_LLM_ENABLED: 'false' });
  const app = createApp({ database, config, logger: { info() {}, error() {} } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'searcher', password: 'SearchPassword2026' }) });
    assert.equal(login.status, 200);
    const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
    const query = async (filters) => {
      const response = await fetch(`${base}/api/search?${new URLSearchParams(filters)}`, { headers });
      assert.equal(response.status, 200);
      return response.json();
    };
    const visibleMeetings = await query({ q: 'Заседание кафедры', sourceKind: 'protocol', number: 'MANUAL-' });
    assert.deepEqual(visibleMeetings.items.map((row) => row.source_id), [own.id]);
    assert.deepEqual(visibleMeetings.items[0].route, { kind: 'meeting', id: own.id });
    assert.equal((await query({ sourceKind: 'protocol', number: 'MANUAL-2' })).items.length, 0);
    const visiblePlans = await query({ sourceKind: 'plans', period: '2026' });
    assert.ok(visiblePlans.items.some((row) => row.source_id === plan.id));
    assert.deepEqual(visiblePlans.items.find((row) => row.source_id === item.id)?.route, { kind: 'plan', id: plan.id });
    assert.ok(!visiblePlans.items.some((row) => row.source_id === privatePlan.id));
    assert.equal(other.source_document_version_id, null);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM document_versions').n, 0);
    assert.equal(database.getSchemaVersion(), 31);
  } finally {
    app.closeAllConnections();
    await new Promise((done) => app.close(done));
  }
});
