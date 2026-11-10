import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan, createManualPlanItem, updateManualPlanItem } from '../packages/plans/src/manual.mjs';
import { classifyPlanActivity } from '../packages/plans/src/activity.mjs';
import {
  addMonthlyPlanItems, createMonthlyPlan, getMonthlyPlan, listMonthlyPlans, listPlanEvents,
  removeMonthlyPlanItem, updateMonthlyPlan, updateMonthlyPlanItem
} from '../packages/plans/src/monthly.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-monthly-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const owner = createPerson(database, workspaceId, { displayName: 'Оператор кафедры' });
    const other = createPerson(database, workspaceId, { displayName: 'Секретарь института' });
    const context = { authenticated: true, enabled: true, role: 'staff', personId: owner.id, workspaceId };
    const otherContext = { ...context, personId: other.id };
    const institute = createManualPlan(database, workspaceId, {
      title: 'Годовой план института', planKind: 'organization', periodKind: 'calendar', year: 2026, accessScope: 'workspace'
    }, other.id);
    const department = createManualPlan(database, workspaceId, {
      title: 'План кафедры метеорологии', planKind: 'department', periodKind: 'calendar', year: 2026, accessScope: 'workspace'
    }, owner.id);
    const sourceA = createManualPlanItem(database, workspaceId, institute.id, {
      title: 'Научная конференция', startsAt: '2026-11-12', direction: 'science', responsibleRaw: 'Кафедра метеорологии'
    }, other.id);
    const sourceB = createManualPlanItem(database, workspaceId, department.id, {
      title: 'Методический семинар', dueDate: '2026-11-25', direction: 'education'
    }, owner.id);
    await run({ database, workspaceId, owner, other, context, otherContext, institute, department, sourceA, sourceB });
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('месячный план хранит ссылки, частичный успех и редактуру без копий календаря', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, sourceA, sourceB } = f;
  const before = db.all('SELECT * FROM calendar_items ORDER BY id');
  const sourceBefore = db.all('SELECT id, evidence_json, title FROM plan_items ORDER BY id');
  const input = { month: '2026-11', title: 'План кафедры на ноябрь', idempotencyKey: 'compose-november', planItemIds: [sourceA.id, sourceB.id, 'missing'] };
  let draft = createMonthlyPlan(db, ws, input, context);
  assert.equal(draft.items.length, 2);
  assert.deepEqual(draft.results.map((row) => row.status), ['added', 'added', 'error']);
  assert.equal(draft.results[2].code, 'monthly_plan_source_unavailable');
  assert.equal(createMonthlyPlan(db, ws, input, context).id, draft.id);
  assert.equal(createMonthlyPlan(db, ws, input, context).duplicateRequest, true);
  assert.throws(() => createMonthlyPlan(db, ws, { ...input, month: '2026-12' }, context), { code: 'monthly_plan_idempotency_conflict' });
  const repeated = addMonthlyPlanItems(db, ws, draft.id, { planItemIds: [sourceA.id, sourceA.id] }, context);
  assert.deepEqual(repeated.results.map((row) => row.status), ['existing']);
  assert.equal(repeated.draft.revision, draft.revision);

  const membership = draft.items.find((row) => row.plan_item_id === sourceA.id);
  draft = updateMonthlyPlanItem(db, ws, draft.id, membership.id, {
    expectedRevision: draft.revision, titleOverride: 'Участие кафедры в конференции', dateTextOverride: 'В течение ноября',
    responsibleOverride: 'Иванов И. И.', expectedResultOverride: 'Доклад', note: 'Делегировать сотрудника'
  }, context);
  const composed = draft.items.find((row) => row.id === membership.id);
  assert.equal(composed.effective.title, 'Участие кафедры в конференции');
  assert.equal(composed.effective.dateText, 'В течение ноября');
  assert.equal(composed.source.title, sourceA.title);
  assert.equal(composed.source.starts_at, '2026-11-12');
  assert.deepEqual(db.all('SELECT * FROM calendar_items ORDER BY id'), before);
  assert.deepEqual(db.all('SELECT id, evidence_json, title FROM plan_items ORDER BY id'), sourceBefore);
  assert.equal(createMonthlyPlan(db, ws, input, context).items.find((row) => row.id === membership.id).effective.title, 'Участие кафедры в конференции');

  const stale = draft.revision;
  draft = updateMonthlyPlan(db, ws, draft.id, { expectedRevision: stale, orderedItemIds: draft.items.map((row) => row.id).reverse() }, context);
  assert.equal(draft.items.at(-1).id, membership.id);
  assert.throws(() => updateMonthlyPlanItem(db, ws, draft.id, membership.id, { expectedRevision: stale, titleOverride: 'Устаревший ввод' }, context), { code: 'monthly_plan_revision_conflict' });
  assert.throws(() => removeMonthlyPlanItem(db, ws, draft.id, membership.id, {}, context), { code: 'monthly_plan_revision_required' });
  const removalRevision = draft.revision;
  draft = removeMonthlyPlanItem(db, ws, draft.id, membership.id, { expectedRevision: removalRevision }, context);
  assert.equal(draft.items.length, 1);
  assert.equal(removeMonthlyPlanItem(db, ws, draft.id, membership.id, { expectedRevision: removalRevision }, context).revision, draft.revision);
  assert.deepEqual(db.all('SELECT * FROM calendar_items ORDER BY id'), before);
  assert.ok(db.get('SELECT id FROM plan_items WHERE id = ?', sourceA.id));
}));

test('сохранённая подборка повторно проверяет источники и скрывает overlays после отзыва доступа', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, otherContext, sourceA, sourceB, institute } = f;
  let draft = createMonthlyPlan(db, ws, { month: '2026-11', idempotencyKey: 'permissions', planItemIds: [sourceA.id, sourceB.id] }, context);
  const membership = draft.items.find((row) => row.plan_item_id === sourceA.id);
  draft = updateMonthlyPlanItem(db, ws, draft.id, membership.id, { expectedRevision: draft.revision, note: 'Закрытая формулировка' }, context);
  assert.throws(() => getMonthlyPlan(db, ws, draft.id, otherContext), { code: 'monthly_plan_access_forbidden' });
  assert.deepEqual(listMonthlyPlans(db, ws, otherContext), []);
  db.run("UPDATE object_access_policies SET access_scope = 'restricted' WHERE object_kind = 'plan' AND object_id = ?", institute.id);
  const protectedDraft = getMonthlyPlan(db, ws, draft.id, context);
  assert.equal(protectedDraft.unavailableCount, 1);
  assert.deepEqual(protectedDraft.items.find((row) => row.id === membership.id), { id: membership.id, position: membership.position, unavailable: true });
  assert.doesNotMatch(JSON.stringify(protectedDraft), /Закрытая формулировка|Научная конференция/);
  assert.equal(listPlanEvents(db, ws, context, { month: '2026-11' }).items.some((row) => row.id === sourceA.id), false);
  assert.throws(() => updateMonthlyPlanItem(db, ws, draft.id, membership.id, { expectedRevision: draft.revision, note: 'x' }, context), { code: 'monthly_plan_source_unavailable' });
  const result = addMonthlyPlanItems(db, ws, draft.id, { planItemIds: [sourceA.id, sourceB.id] }, context);
  assert.deepEqual(result.results.map((row) => row.status), ['error', 'existing']);
  assert.equal(removeMonthlyPlanItem(db, ws, draft.id, membership.id, { expectedRevision: draft.revision }, context).items.length, 1);
}));

test('реестр отбирает месяц, виды работ и подразделение по исходным текстам', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, owner, department, sourceA, sourceB } = f;
  const undated = createManualPlanItem(db, ws, department.id, { title: 'Лекция по прогнозированию', direction: 'education' }, owner.id);
  const crossing = createManualPlanItem(db, ws, department.id, { title: 'Учебная практика', startsAt: '2026-10-28', endsAt: '2026-11-04', direction: 'education' }, owner.id);
  createManualPlanItem(db, ws, department.id, { title: 'Заседание в декабре', startsAt: '2026-12-12' }, owner.id);
  assert.equal(listPlanEvents(db, ws, context, { month: '2026-11' }).items.length, 3);
  const all = listPlanEvents(db, ws, context, { month: '2026-11', includeUndated: true });
  assert.equal(all.items.length, 4);
  assert.ok(all.items.some((row) => row.id === undated.id));
  assert.ok(all.items.some((row) => row.id === crossing.id));
  assert.equal(all.items.find((row) => row.id === sourceB.id).activity_kind, 'methodological');
  assert.equal(listPlanEvents(db, ws, context, { month: '2026-11', activityKind: 'science' }).items[0].id, sourceA.id);
  assert.equal(listPlanEvents(db, ws, context, { month: '2026-11', activityKind: 'methodological' }).items[0].id, sourceB.id);
  assert.equal(listPlanEvents(db, ws, context, { month: '2026-11', department: 'МЕТЕОРОЛОГИИ' }).items.length, 3);
  assert.equal(listPlanEvents(db, ws, context, { q: 'научная конференция' }).items[0].id, sourceA.id);
  const first = listPlanEvents(db, ws, context, { month: '2026-11', limit: 1 });
  const second = listPlanEvents(db, ws, context, { month: '2026-11', offset: first.nextOffset, limit: 1 });
  assert.equal(first.hasMore, true);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.throws(() => listPlanEvents(db, ws, context, { month: '2026-13' }), { code: 'monthly_plan_month_invalid' });
}));

test('изменения исходного мероприятия видны без повторной материализации и сохраняют месячную формулировку', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, context, owner, sourceB } = f;
  let draft = createMonthlyPlan(db, ws, { month: '2026-11', idempotencyKey: 'live-source', planItemIds: [sourceB.id] }, context);
  draft = updateMonthlyPlanItem(db, ws, draft.id, draft.items[0].id, { expectedRevision: draft.revision, responsibleOverride: 'Ответственный за месячный план' }, context);
  updateManualPlanItem(db, ws, sourceB.id, { title: 'Уточнённый методический семинар', dueDate: '2026-11-30' }, owner.id);
  const current = getMonthlyPlan(db, ws, draft.id, context);
  assert.equal(current.items[0].effective.title, 'Уточнённый методический семинар');
  assert.equal(current.items[0].effective.dueDate, '2026-11-30');
  assert.equal(current.items[0].effective.responsibleRaw, 'Ответственный за месячный план');
  assert.equal(current.revision, draft.revision);
  const reset = updateMonthlyPlanItem(db, ws, draft.id, draft.items[0].id, { expectedRevision: draft.revision, responsibleOverride: null }, context);
  assert.equal(reset.items[0].responsible_override, null);
}));

test('вид работы берётся из применённого значения или детерминированного текста', () => {
  assert.equal(classifyPlanActivity({ title: 'Разработка рабочего учебного пособия', direction: 'education' }), 'methodological');
  assert.equal(classifyPlanActivity({ title: 'Занятие по метеорологии' }), 'teaching');
  assert.equal(classifyPlanActivity({ title: 'Научная конференция' }), 'science');
  assert.equal(classifyPlanActivity({ title: 'Дежурство', direction: 'everyday' }), 'everyday');
  assert.equal(classifyPlanActivity({ title: 'Заседание', evidence_json: JSON.stringify({ activityKind: 'methodological' }) }), 'methodological');
  assert.equal(classifyPlanActivity({ title: 'Заседание', evidence: { llmProposal: { activityKind: 'science' } } }), 'organizational');
});
