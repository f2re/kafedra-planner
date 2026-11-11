import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createEventTemplate, createEventTemplateVersion, defaultEventTemplateDefinition } from '../packages/plans/src/event-templates.mjs';
import { getPlanEventDetails, updatePlanEventDetails } from '../packages/plans/src/event-details.mjs';
import { createMonthlyPlan, getMonthlyPlan, listPlanEvents, updateMonthlyPlanItem } from '../packages/plans/src/monthly.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-event-details-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const owner = createPerson(database, workspaceId, { displayName: 'Оператор кафедры' });
    const other = createPerson(database, workspaceId, { displayName: 'Читатель' });
    const context = { authenticated: true, enabled: true, role: 'staff', personId: owner.id, workspaceId };
    const plan = createManualPlan(database, workspaceId, { title: 'План кафедры', planKind: 'department', periodKind: 'calendar', year: 2026, accessScope: 'workspace' }, owner.id);
    const item = createManualPlanItem(database, workspaceId, plan.id, { title: 'Семинар', startsAt: '2026-11-12', direction: 'education' }, owner.id);
    const definition = defaultEventTemplateDefinition();
    definition.fields.push({ key: 'custom_room', label: 'Оснащение', source: 'custom', type: 'text', visible: true, required: false, width: 20 });
    const template = createEventTemplate(database, workspaceId, { title: 'Мероприятия', definition, idempotencyKey: 'template' }, context);
    await run({ database, workspaceId, context, otherContext: { ...context, personId: other.id }, plan, item, template });
    assert.equal(database.quickCheck(), true); assert.deepEqual(database.foreignKeyCheck(), []);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
}

test('каноническое место и дополнительные поля переживают версии шаблона без изменения источника и календаря', async () => fixture(async ({ database: db, workspaceId: ws, context, item, template }) => {
  const sourceBefore = db.get('SELECT * FROM plan_items WHERE id=?', item.id);
  const calendarBefore = db.all('SELECT * FROM calendar_items ORDER BY id');
  assert.equal(getPlanEventDetails(db, ws, item.id, context).revision, 0);
  let details = updatePlanEventDetails(db, ws, item.id, { expectedRevision: 0, location: 'Аудитория 201', templateVersionId: template.currentVersionId, customValues: { custom_room: 'Проектор' } }, context);
  assert.equal(details.revision, 1);
  assert.equal(updatePlanEventDetails(db, ws, item.id, { expectedRevision: 1, location: 'Аудитория 201' }, context).revision, 1);
  createEventTemplateVersion(db, ws, template.id, { expectedVersion: 1, title: 'Скрытое поле', definition: defaultEventTemplateDefinition(), idempotencyKey: 'new-version' }, context);
  details = updatePlanEventDetails(db, ws, item.id, { expectedRevision: 1, location: 'Аудитория 202' }, context);
  assert.equal(details.customValues.custom_room, 'Проектор');
  const event = listPlanEvents(db, ws, context, { month: '2026-11' }).items[0];
  assert.equal(event.location, 'Аудитория 202');
  assert.equal(event.detailsRevision, 2);
  assert.equal(event.canEditDetails, true);
  assert.deepEqual(db.get('SELECT * FROM plan_items WHERE id=?', item.id), sourceBefore);
  assert.deepEqual(db.all('SELECT * FROM calendar_items ORDER BY id'), calendarBefore);
  const history = db.all("SELECT details_json FROM audit_log WHERE subject_kind='plan_item' AND subject_id=? AND action='plan_event.details_updated' ORDER BY created_at,id", item.id).map((row) => JSON.parse(row.details_json));
  assert.equal(history.length, 2);
  assert.equal(history.some((row) => row.previous.location === 'Аудитория 201' && row.next.location === 'Аудитория 202'), true);
}));

test('детали требуют edit ACL и актуальной ревизии; печатные поля отделены от канонических', async () => fixture(async ({ database: db, workspaceId: ws, context, otherContext, item, template }) => {
  assert.equal(getPlanEventDetails(db, ws, item.id, otherContext).canEdit, false);
  assert.throws(() => updatePlanEventDetails(db, ws, item.id, { expectedRevision: 0, location: 'Чужая правка' }, otherContext), { code: 'plan_access_forbidden' });
  updatePlanEventDetails(db, ws, item.id, { expectedRevision: 0, location: 'Аудитория 201', templateVersionId: template.currentVersionId, customValues: { custom_room: 'Проектор' } }, context);
  assert.throws(() => updatePlanEventDetails(db, ws, item.id, { expectedRevision: 0, location: 'Устаревший ввод' }, context), { code: 'event_details_revision_conflict' });
  let draft = createMonthlyPlan(db, ws, { month: '2026-11', eventTemplateVersionId: template.currentVersionId, planItemIds: [item.id], idempotencyKey: 'draft' }, context);
  const memberId = draft.items[0].id;
  assert.equal(draft.items[0].effective.customValues.custom_room, 'Проектор');
  draft = updateMonthlyPlanItem(db, ws, draft.id, memberId, { expectedRevision: draft.revision, locationOverride: '', customValues: { custom_room: 'Раздаточные материалы' } }, context);
  assert.equal(draft.items[0].effective.location, '');
  assert.equal(draft.items[0].effective.customValues.custom_room, 'Раздаточные материалы');
  assert.equal(getPlanEventDetails(db, ws, item.id, context).customValues.custom_room, 'Проектор');
  draft = updateMonthlyPlanItem(db, ws, draft.id, memberId, { expectedRevision: draft.revision, locationOverride: null, customValues: { custom_room: null } }, context);
  assert.equal(draft.items[0].effective.location, 'Аудитория 201');
  assert.equal(draft.items[0].effective.customValues.custom_room, 'Проектор');
  assert.deepEqual(draft.items[0].customValues, {});
  draft = updateMonthlyPlanItem(db, ws, draft.id, memberId, { expectedRevision: draft.revision, customValues: { custom_room: '' } }, context);
  assert.equal(getMonthlyPlan(db, ws, draft.id, context).items[0].effective.customValues.custom_room, '');
  draft = updateMonthlyPlanItem(db, ws, draft.id, memberId, { expectedRevision: draft.revision, customValues: null }, context);
  assert.equal(draft.items[0].effective.customValues.custom_room, 'Проектор');
  assert.throws(() => updateMonthlyPlanItem(db, ws, draft.id, memberId, { expectedRevision: draft.revision, customValues: { custom_unknown: 'нет' } }, context), { code: 'event_custom_field_unknown' });
}));
