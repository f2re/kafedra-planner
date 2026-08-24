import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import {
  createOrganizationPosition,
  createOrganizationUnit,
  createPersonAppointment,
  listPersonAppointments,
  organizationSnapshot,
  resolvePersonAppointment,
  setScientificAuthorAffiliation,
  updatePersonAppointment
} from '../packages/organization/src/service.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-organization-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, database, workspace };
}

async function closeFixture({ root, database }) {
  database.close();
  await rm(root, { recursive: true, force: true });
}

test('подразделения и назначения разрешаются на историческую дату', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор Кафедры' });
    const employee = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const manager = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович' });
    const rootUnit = organizationSnapshot(database, workspace.id, { asOf: '2020-01-01', includeInactive: true }).tree[0];
    assert.ok(rootUnit);
    const faculty = createOrganizationUnit(database, workspace.id, {
      name: 'Факультет подготовки специалистов', unitKind: 'faculty', parentUnitId: rootUnit.id,
      validFrom: '2010-01-01'
    }, actor.id);
    const oldDepartment = createOrganizationUnit(database, workspace.id, {
      name: 'Кафедра старого состава', unitKind: 'department', parentUnitId: faculty.id,
      validFrom: '2010-01-01', validTo: '2022-12-31'
    }, actor.id);
    const newDepartment = createOrganizationUnit(database, workspace.id, {
      name: 'Кафедра метеорологии', unitKind: 'department', parentUnitId: faculty.id,
      validFrom: '2023-01-01'
    }, actor.id);
    const assistant = createOrganizationPosition(database, workspace.id, { name: 'Ассистент' }, actor.id);
    const lecturer = createOrganizationPosition(database, workspace.id, { name: 'Старший преподаватель' }, actor.id);

    createPersonAppointment(database, workspace.id, employee.id, {
      unitId: oldDepartment.id, positionId: assistant.id, managerPersonId: manager.id,
      appointmentKind: 'primary', validFrom: '2020-01-01', validTo: '2022-12-31',
      reason: 'Назначение по приказу'
    }, actor.id);
    createPersonAppointment(database, workspace.id, employee.id, {
      unitId: newDepartment.id, positionId: lecturer.id, managerPersonId: manager.id,
      appointmentKind: 'primary', validFrom: '2023-01-01', reason: 'Перевод на новую кафедру'
    }, actor.id);

    const old = resolvePersonAppointment(database, workspace.id, employee.id, '2021-06-01');
    const current = resolvePersonAppointment(database, workspace.id, employee.id, '2026-06-01');
    assert.equal(old.unit_name, 'Кафедра старого состава');
    assert.equal(old.position_name, 'Ассистент');
    assert.equal(current.unit_name, 'Кафедра метеорологии');
    assert.equal(current.position_name, 'Старший преподаватель');
    assert.equal(database.get('SELECT position FROM people WHERE id = ?', employee.id).position, 'Старший преподаватель');
    assert.equal(listPersonAppointments(database, workspace.id, employee.id).length, 2);

    assert.throws(() => createPersonAppointment(database, workspace.id, employee.id, {
      unitId: newDepartment.id, positionId: lecturer.id, appointmentKind: 'primary',
      validFrom: '2024-01-01', validTo: '2025-01-01', closePrevious: false
    }, actor.id), /organization_appointment_overlap/u);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    await closeFixture(env);
  }
});

test('исправление периода требует причины и сохраняется в аудите', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const employee = createPerson(database, workspace.id, { displayName: 'Сидоров Сидор Сидорович' });
    const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
    const position = createOrganizationPosition(database, workspace.id, { name: 'Доцент' }, actor.id);
    const appointment = createPersonAppointment(database, workspace.id, employee.id, {
      unitId: rootUnit.id, positionId: position.id, validFrom: '2020-01-01', validTo: '2024-12-31'
    }, actor.id);

    assert.throws(() => updatePersonAppointment(database, workspace.id, appointment.id, {
      validTo: '2025-12-31'
    }, actor.id), /organization_change_reason_required/u);
    const updated = updatePersonAppointment(database, workspace.id, appointment.id, {
      validTo: '2025-12-31', reason: 'Уточнено по приказу № 17'
    }, actor.id);
    assert.equal(updated.valid_to, '2025-12-31');
    const audit = database.get(`
      SELECT details_json FROM audit_log WHERE subject_kind = 'person_appointment' AND subject_id = ?
      ORDER BY created_at DESC LIMIT 1
    `, appointment.id);
    assert.match(audit.details_json, /Уточнено по приказу/u);
  } finally {
    await closeFixture(env);
  }
});

test('циклическая цепочка руководителей запрещена', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const first = createPerson(database, workspace.id, { displayName: 'Первый Руководитель' });
    const second = createPerson(database, workspace.id, { displayName: 'Второй Руководитель' });
    const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
    createPersonAppointment(database, workspace.id, first.id, {
      unitId: rootUnit.id, managerPersonId: second.id, validFrom: '2020-01-01'
    }, actor.id);
    assert.throws(() => createPersonAppointment(database, workspace.id, second.id, {
      unitId: rootUnit.id, managerPersonId: first.id, validFrom: '2020-01-01'
    }, actor.id), /organization_manager_cycle/u);
  } finally {
    await closeFixture(env);
  }
});

test('научная аффилиация фиксирует подразделение на дату публикации и допускает аудируемую коррекцию', async () => {
  const env = await fixture();
  try {
    const { database, workspace } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const author = createPerson(database, workspace.id, { displayName: 'Орлов Олег Олегович' });
    const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
    const oldUnit = createOrganizationUnit(database, workspace.id, {
      name: 'Лаборатория радиолокации', unitKind: 'laboratory', parentUnitId: rootUnit.id,
      validFrom: '2015-01-01', validTo: '2022-12-31'
    }, actor.id);
    const newUnit = createOrganizationUnit(database, workspace.id, {
      name: 'Лаборатория наукастинга', unitKind: 'laboratory', parentUnitId: rootUnit.id,
      validFrom: '2023-01-01'
    }, actor.id);
    createPersonAppointment(database, workspace.id, author.id, {
      unitId: oldUnit.id, validFrom: '2015-01-01', validTo: '2022-12-31'
    }, actor.id);
    createPersonAppointment(database, workspace.id, author.id, {
      unitId: newUnit.id, validFrom: '2023-01-01'
    }, actor.id);

    const science = createScientificItem(database, workspace.id, {
      title: 'Методы радиолокационного прогноза осадков', kind: 'article',
      authors: ['Орлов Олег Олегович'], publicationYear: 2021
    });
    const derived = database.get(`
      SELECT * FROM scientific_author_affiliations WHERE scientific_item_id = ? AND author_raw = ?
    `, science.id, 'Орлов Олег Олегович');
    assert.equal(derived.unit_name_snapshot, 'Лаборатория радиолокации');
    assert.equal(derived.source_kind, 'derived');

    const corrected = setScientificAuthorAffiliation(database, workspace.id, science.id, 'Орлов Олег Олегович', {
      personId: author.id, unitName: 'Внешняя организация', validOn: '2021-12-31',
      reason: 'Аффилиация указана в опубликованной статье'
    }, actor.id);
    assert.equal(corrected[0].unit_name_snapshot, 'Внешняя организация');
    assert.equal(corrected[0].source_kind, 'manual');
  } finally {
    await closeFixture(env);
  }
});
