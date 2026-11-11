import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan, createManualPlanItem, updateManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createEventTemplate, defaultEventTemplateDefinition } from '../packages/plans/src/event-templates.mjs';
import { getPlanEventDetails, updatePlanEventDetails } from '../packages/plans/src/event-details.mjs';
import { createMonthlyPlan, updateMonthlyPlanItem } from '../packages/plans/src/monthly.mjs';
import { suggestPlanEvents, getPlanSelectionRun, applyPlanSelection } from '../packages/plans/src/selection.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-selection-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const owner = createPerson(database, workspaceId, { displayName: 'Оператор кафедры' });
    const other = createPerson(database, workspaceId, { displayName: 'Автор института' });
    const context = { authenticated: true, enabled: true, role: 'staff', personId: owner.id, workspaceId };
    const sourcePlan = createManualPlan(database, workspaceId, { title: 'План института', planKind: 'organization', periodKind: 'calendar', year: 2026, accessScope: 'workspace' }, other.id);
    const first = createManualPlanItem(database, workspaceId, sourcePlan.id, { title: 'Методический семинар', startsAt: '2026-11-18', responsibleRaw: 'Кафедра метеорологии',
      description: 'Место: аудитория 215. Форма участия: Доклад.' }, other.id);
    const second = createManualPlanItem(database, workspaceId, sourcePlan.id, { title: 'Совещание администрации', startsAt: '2026-11-20', responsibleRaw: 'Дирекция института' }, other.id);
    const definition = defaultEventTemplateDefinition();
    definition.fields.push({ key: 'custom_form', source: 'custom', type: 'select', label: 'Форма участия', options: ['Доклад', 'Слушатель'], visible: true, required: false, width: 20 });
    const template = createEventTemplate(database, workspaceId, { title: 'Месячный план', definition, idempotencyKey: 'tpl' }, context);
    const input = { month: '2026-11', department: 'Кафедра метеорологии', eventTemplateVersionId: template.currentVersionId, idempotencyKey: 'selection' };
    const config = { dataDir: root, llmEnabled: false };
    await run({ root, database, workspaceId, context, otherContext: { ...context, personId: other.id }, other,
      first, second, sourcePlan, template, input, config });
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.foreignKeyCheck(), []);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
}
function modelResponse(payload, targetId) {
  const candidates = JSON.parse(payload.messages[1].content).candidates;
  return new Response(JSON.stringify({ model: 'selection-fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    items: candidates.map((item) => ({ planItemId: item.planItemId, relevance: item.planItemId === targetId ? 'recommended' : 'other',
      reason: item.planItemId === targetId ? 'Кафедра указана как исполнитель.' : 'Мероприятие дирекции.',
      quote: item.title, segmentId: 'item:title', fields: item.planItemId === targetId ? [
        { key: 'location', value: 'аудитория 215', quote: 'Место: аудитория 215', segmentId: 'item:description' },
        { key: 'custom_form', value: 'Доклад', quote: 'Форма участия: Доклад', segmentId: 'item:description' }
      ] : [] })) }) } }] }));
}

test('department selection persists immutable runs and adds canonical references without duplicates', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, input, first, second, config } = f;
  const calendar = db.all('SELECT * FROM calendar_items ORDER BY id');
  const sourceRows = db.all('SELECT * FROM plan_items ORDER BY id');
  const run = await suggestPlanEvents(db, ws, input, context, config);
  assert.equal(run.method, 'rules');
  assert.deepEqual(run.items.map((item) => [item.planItemId, item.relevance]), [[first.id, 'recommended'], [second.id, 'other']]);
  assert.equal((await suggestPlanEvents(db, ws, input, context, config)).runId, run.runId);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM plan_event_selection_runs').n, 1);
  await assert.rejects(suggestPlanEvents(db, ws, { ...input, month: '2026-12' }, context, config), { code: 'plan_selection_idempotency_conflict' });
  assert.throws(() => getPlanSelectionRun(db, ws, run.runId, f.otherContext), { code: 'plan_selection_forbidden' });
  assert.throws(() => db.run("UPDATE plan_event_selection_runs SET result_json='{}' WHERE id=?", run.runId), /event_selection_immutable/u);
  const draft = createMonthlyPlan(db, ws, { month: input.month, eventTemplateVersionId: input.eventTemplateVersionId, idempotencyKey: 'month' }, context);
  const accepted = applyPlanSelection(db, ws, draft.id, { runId: run.runId, planItemIds: [first.id, second.id, 'unknown'], expectedRevision: draft.revision }, context);
  assert.deepEqual(accepted.results.map((item) => item.status), ['added', 'added', 'error']);
  const row = accepted.draft.items.find((item) => item.plan_item_id === first.id);
  assert.equal(row.selectionEvidence.runId, run.runId);
  const edited = updateMonthlyPlanItem(db, ws, draft.id, row.id, { expectedRevision: accepted.draft.revision, locationOverride: 'Ручная правка' }, context);
  const repeated = applyPlanSelection(db, ws, draft.id, { runId: run.runId, planItemIds: [first.id], expectedRevision: draft.revision }, context);
  assert.equal(repeated.duplicateRequest, true);
  assert.equal(repeated.draft.revision, edited.revision);
  assert.equal(repeated.draft.items.find((item) => item.id === row.id).effective.location, 'Ручная правка');
  assert.deepEqual(db.all('SELECT * FROM calendar_items ORDER BY id'), calendar);
  assert.deepEqual(db.all('SELECT * FROM plan_items ORDER BY id'), sourceRows);
}));

test('grounded LLM prefill changes only newly accepted print fields; stale candidates fail independently', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, input, first, second } = f;
  const config = { ...f.config, llmEnabled: true, llmEndpoint: 'http://localhost:8081', llmTimeoutMs: 10_000 };
  const run = await suggestPlanEvents(db, ws, input, context, config, { fetchImpl: async (_url, options) => modelResponse(JSON.parse(options.body), first.id) });
  assert.equal(run.method, 'llm');
  assert.equal(run.items[0].suggestedFields.location.value, 'аудитория 215');
  const draft = createMonthlyPlan(db, ws, { month: input.month, eventTemplateVersionId: input.eventTemplateVersionId, idempotencyKey: 'month' }, context);
  const accepted = applyPlanSelection(db, ws, draft.id, { runId: run.runId, planItemIds: [first.id], expectedRevision: draft.revision }, context);
  assert.equal(accepted.draft.items[0].effective.location, 'аудитория 215');
  assert.equal(accepted.draft.items[0].effective.customValues.custom_form, 'Доклад');
  assert.equal(getPlanEventDetails(db, ws, first.id, context).location, '');
  assert.deepEqual(getPlanEventDetails(db, ws, first.id, context).customValues, {});
  updateManualPlanItem(db, ws, first.id, { title: 'Изменённое мероприятие' }, f.other.id);
  const next = createMonthlyPlan(db, ws, { month: input.month, eventTemplateVersionId: input.eventTemplateVersionId, idempotencyKey: 'month-next' }, context);
  const partial = applyPlanSelection(db, ws, next.id, { runId: run.runId, planItemIds: [first.id, second.id], expectedRevision: next.revision }, context);
  assert.equal(partial.results[0].code, 'plan_selection_source_changed');
  assert.equal(partial.results[1].status, 'added');
  assert.equal(partial.draft.items.length, 1);
  assert.equal(getPlanSelectionRun(db, ws, run.runId, context).items.find((item) => item.planItemId === first.id).stale, true);
  const otherDepartment = createMonthlyPlan(db, ws, { month: input.month, eventTemplateVersionId: input.eventTemplateVersionId,
    departmentText: 'Кафедра математики', idempotencyKey: 'another-department' }, context);
  assert.throws(() => applyPlanSelection(db, ws, otherDepartment.id, { runId: run.runId, planItemIds: [second.id],
    expectedRevision: otherDepartment.revision }, context), { code: 'plan_selection_context_changed' });
}));

test('late LLM responses cannot overwrite manual details or leak sources after access is revoked', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, input, first } = f;
  const config = { ...f.config, llmEnabled: true, llmEndpoint: 'http://localhost:8081' };
  const run = await suggestPlanEvents(db, ws, input, context, config, { fetchImpl: async (_url, options) => {
    updatePlanEventDetails(db, ws, first.id, { expectedRevision: 0, location: 'Выбрано оператором' }, f.otherContext);
    return modelResponse(JSON.parse(options.body), first.id);
  } });
  const firstProposal = run.items.find((item) => item.planItemId === first.id);
  assert.equal(firstProposal.source.location, 'Выбрано оператором');
  assert.equal(firstProposal.method, 'rules');
  assert.deepEqual(firstProposal.suggestedFields, {});
  db.run("UPDATE object_access_policies SET access_scope='restricted' WHERE object_kind='plan' AND object_id=?", f.sourcePlan.id);
  const filtered = getPlanSelectionRun(db, ws, run.runId, context);
  assert.deepEqual(filtered.items, []);
  assert.doesNotMatch(JSON.stringify(filtered), /Выбрано оператором|Совещание администрации/u);
  const draft = createMonthlyPlan(db, ws, { month: input.month, eventTemplateVersionId: input.eventTemplateVersionId, idempotencyKey: 'month' }, context);
  const denied = applyPlanSelection(db, ws, draft.id, { runId: run.runId, planItemIds: [first.id], expectedRevision: draft.revision }, context);
  assert.equal(denied.results[0].status, 'error');
  assert.equal(denied.draft.items.length, 0);
}));

test('cancelled selection leaves no run; a failing optional model still yields a usable saved selection', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, input, first } = f;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(suggestPlanEvents(db, ws, input, context, f.config, { signal: controller.signal }), { code: 'plan_selection_cancelled' });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM plan_event_selection_runs').n, 0);
  const run = await suggestPlanEvents(db, ws, input, context, { ...f.config, llmEnabled: true, llmEndpoint: 'http://localhost:8081' },
    { fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal(run.method, 'rules');
  assert.equal(run.items[0].planItemId, first.id);
  assert.match(run.warnings.join(' '), /Модель недоступна/u);
}));
