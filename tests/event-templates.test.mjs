import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import {
  createEventTemplate, createEventTemplateVersion, defaultEventTemplateDefinition,
  getEventTemplate, getEventTemplateVersion, listEventTemplates, normalizeEventCustomValues, normalizeEventTemplateDefinition
} from '../packages/plans/src/event-templates.mjs';
import { createMonthlyPlan, getMonthlyPlan, updateMonthlyPlan } from '../packages/plans/src/monthly.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-event-template-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const owner = createPerson(database, workspaceId, { displayName: 'Редактор шаблона' });
    const other = createPerson(database, workspaceId, { displayName: 'Другой сотрудник' });
    const context = { authenticated: true, enabled: true, role: 'staff', personId: owner.id, workspaceId };
    await run({ database, workspaceId, context, otherContext: { ...context, personId: other.id } });
    assert.equal(database.quickCheck(), true);
    assert.deepEqual(database.foreignKeyCheck(), []);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
}
function definition() {
  return { ...defaultEventTemplateDefinition(), fields: [...defaultEventTemplateDefinition().fields,
    { key: 'custom_participation', source: 'custom', label: 'Форма участия', type: 'select', options: ['Доклад', 'Слушатель'], visible: true, required: false, width: 20 },
    { key: 'custom_count', source: 'custom', label: 'Число участников', type: 'number', visible: true, required: false, width: 10 },
    { key: 'custom_deadline', source: 'custom', label: 'Дата заявки', type: 'date', visible: true, required: false, width: 15 }
  ] };
}

test('шаблон сохраняет версии, повторы и закреплённую версию месячного плана', async () => fixture(async ({ database: db, workspaceId: ws, context }) => {
  const input = { title: 'План кафедры', definition: definition(), idempotencyKey: 'create-template' };
  const first = createEventTemplate(db, ws, input, context);
  assert.equal(first.version, 1);
  assert.equal(createEventTemplate(db, ws, input, context).id, first.id);
  assert.throws(() => createEventTemplate(db, ws, { ...input, definition: { ...input.definition, layout: { orientation: 'portrait' } } }, context), { code: 'event_template_idempotency_conflict' });
  const oldSnapshot = getEventTemplateVersion(db, ws, first.currentVersionId, context);
  const draft = createMonthlyPlan(db, ws, { month: '2026-11', title: 'Ноябрь', eventTemplateVersionId: first.currentVersionId, departmentText: 'Кафедра метеорологии', idempotencyKey: 'monthly' }, context);
  const edited = definition();
  edited.fields = [edited.fields[0], edited.fields[3], edited.fields[1], ...edited.fields.slice(4)];
  edited.fields[0].label = 'Наименование мероприятия';
  edited.layout.orientation = 'portrait';
  const save = { title: 'План кафедры — новый', definition: edited, expectedVersion: 1, idempotencyKey: 'version-two' };
  const second = createEventTemplateVersion(db, ws, first.id, save, context);
  assert.equal(second.version, 2);
  assert.equal(createEventTemplateVersion(db, ws, first.id, save, context).duplicateRequest, true);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM plan_event_template_versions').n, 2);
  assert.deepEqual(getEventTemplateVersion(db, ws, first.currentVersionId, context), oldSnapshot);
  assert.equal(getMonthlyPlan(db, ws, draft.id, context).eventTemplate.version, 1);
  const updated = updateMonthlyPlan(db, ws, draft.id, { expectedRevision: draft.revision, eventTemplateVersionId: second.currentVersionId }, context);
  assert.equal(updated.eventTemplate.version, 2);
  assert.equal(updated.department_text, 'Кафедра метеорологии');
  assert.throws(() => createEventTemplateVersion(db, ws, first.id, { ...save, idempotencyKey: 'stale' }, context), { code: 'event_template_version_conflict' });
  assert.throws(() => db.run("UPDATE plan_event_template_versions SET title='Подмена' WHERE id=?", first.currentVersionId), /event_template_version_immutable/u);
  assert.throws(() => db.run('DELETE FROM plan_event_template_versions WHERE id=?', first.currentVersionId), /event_template_version_immutable/u);
  assert.equal(listEventTemplates(db, ws, context)[0].currentVersionId, second.currentVersionId);
}));

test('шаблоны соблюдают владельца и постоянный тип поля даже после удаления колонки', async () => fixture(async ({ database: db, workspaceId: ws, context, otherContext }) => {
  const first = createEventTemplate(db, ws, { title: 'С полями', definition: definition(), idempotencyKey: 'one' }, context);
  assert.throws(() => getEventTemplate(db, ws, first.id, otherContext), { code: 'event_template_forbidden' });
  assert.throws(() => getEventTemplateVersion(db, ws, first.currentVersionId, otherContext), { code: 'event_template_forbidden' });
  assert.deepEqual(listEventTemplates(db, ws, otherContext), []);
  createEventTemplateVersion(db, ws, first.id, { title: 'Без поля', definition: defaultEventTemplateDefinition(), expectedVersion: 1, idempotencyKey: 'remove' }, context);
  const changed = definition();
  changed.fields.find((field) => field.key === 'custom_count').type = 'text';
  assert.throws(() => createEventTemplateVersion(db, ws, first.id, { title: 'Возврат', definition: changed, expectedVersion: 2, idempotencyKey: 'different-type' }, context), { code: 'event_template_field_type_immutable' });
  assert.equal(getEventTemplate(db, ws, first.id, context).version, 2);
}));

test('настройка полей и типизированные значения не принимают неверные даты и произвольные ключи', () => {
  const normalized = normalizeEventTemplateDefinition(definition());
  assert.deepEqual(normalizeEventCustomValues({ custom_count: '2,5', custom_deadline: '2026-11-17', custom_participation: 'Доклад' }, normalized),
    { custom_count: '2.5', custom_deadline: '2026-11-17', custom_participation: 'Доклад' });
  assert.deepEqual(normalizeEventCustomValues({ custom_count: '', custom_deadline: '', custom_participation: null }, normalized),
    { custom_count: '', custom_deadline: '', custom_participation: null });
  assert.throws(() => normalizeEventCustomValues({ custom_deadline: '2026-02-31' }, normalized), { code: 'event_custom_date_invalid' });
  assert.throws(() => normalizeEventCustomValues({ custom_count: 'Infinity' }, normalized), { code: 'event_custom_number_invalid' });
  assert.throws(() => normalizeEventCustomValues({ custom_participation: 'Придуманный вариант' }, normalized), { code: 'event_custom_option_invalid' });
  const fewerOptions = normalizeEventTemplateDefinition(definition());
  fewerOptions.fields.find((field) => field.key === 'custom_participation').options = ['Слушатель'];
  assert.deepEqual(normalizeEventCustomValues({ custom_participation: 'Доклад' }, fewerOptions, { existingValues: { custom_participation: 'Доклад' } }), { custom_participation: 'Доклад' });
  assert.throws(() => normalizeEventCustomValues({ custom_participation: 'Доклад' }, fewerOptions), { code: 'event_custom_option_invalid' });
  assert.throws(() => normalizeEventCustomValues({ custom_unknown: 'x' }, normalized), { code: 'event_custom_field_unknown' });
  const hiddenDate = defaultEventTemplateDefinition(); hiddenDate.fields[1].visible = false;
  assert.throws(() => normalizeEventTemplateDefinition(hiddenDate), { code: 'event_template_core_field_required' });
  const mandatoryExecutor = defaultEventTemplateDefinition(); mandatoryExecutor.fields[2].required = true;
  assert.throws(() => normalizeEventTemplateDefinition(mandatoryExecutor), { code: 'event_template_executor_optional' });
  const duplicate = defaultEventTemplateDefinition(); duplicate.fields.push(duplicate.fields[0]);
  assert.throws(() => normalizeEventTemplateDefinition(duplicate), { code: 'event_template_key_invalid' });
});
