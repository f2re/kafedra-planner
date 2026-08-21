import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import {
  assignUnitManager,
  createAppointment,
  createOrganizationPosition,
  createOrganizationUnit,
  endAppointment,
  endUnitManager,
  getOrganizationUnit,
  organizationSnapshotAt,
  resolvePersonOrganizationAt,
  updateOrganizationUnit
} from '../packages/organization/src/service.mjs';
import { syncPersonCompatibility } from '../packages/organization/src/compatibility.mjs';

const migrationsDir = resolve('migrations');

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-organization-'));
  const database = new Database(join(root, 'database.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return {
    root, database, workspace,
    async close() {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  };
}

test('структура разрешается на выбранную дату', async () => {
  const context = await setup();
  const { database, workspace } = context;
  try {
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const employee = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const managerPerson = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович' });
    const faculty = createOrganizationUnit(database, workspace.id, {
      code: 'faculty', name: 'Факультет', unitKind: 'faculty'
    }, actor.id);
    const department = createOrganizationUnit(database, workspace.id, {
      code: 'department', name: 'Кафедра прогнозирования', unitKind: 'department', parentId: faculty.id
    }, actor.id);
    const position = createOrganizationPosition(database, workspace.id, {
      code: 'assistant-professor', name: 'Доцент', category: 'teaching'
    }, actor.id);
    const appointment = createAppointment(database, workspace.id, {
      personId: employee.id,
      organizationUnitId: department.id,
      positionId: position.id,
      appointmentKind: 'primary',
      validFrom: '2025-09-01'
    }, actor.id);
    const manager = assignUnitManager(database, workspace.id, {
      organizationUnitId: department.id,
      personId: managerPerson.id,
      validFrom: '2025-01-01'
    }, actor.id);

    const snapshot = organizationSnapshotAt(database, workspace.id, '2026-02-01');
    assert.equal(snapshot.units[0].id, faculty.id);
    assert.equal(snapshot.units[0].children[0].id, department.id);
    assert.equal(snapshot.units[0].children[0].appointments[0].id, appointment.id);
    assert.equal(snapshot.units[0].children[0].manager.id, manager.id);

    const personAtDate = resolvePersonOrganizationAt(database, workspace.id, employee.id, '2026-02-01');
    assert.equal(personAtDate.primary.unit_name, 'Кафедра прогнозирования');
    assert.equal(personAtDate.primary.position_name, 'Доцент');
    assert.equal(personAtDate.manager.person_name, 'Петров Пётр Петрович');
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    await context.close();
  }
});

test('пересечение основных назначений и цикл дерева отклоняются без частичной записи', async () => {
  const context = await setup();
  const { database, workspace } = context;
  try {
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const employee = createPerson(database, workspace.id, { displayName: 'Сотрудник' });
    const root = createOrganizationUnit(database, workspace.id, {
      code: 'root', name: 'Организация', unitKind: 'organization'
    }, actor.id);
    const first = createOrganizationUnit(database, workspace.id, {
      code: 'first', name: 'Первое подразделение', parentId: root.id
    }, actor.id);
    const second = createOrganizationUnit(database, workspace.id, {
      code: 'second', name: 'Второе подразделение', parentId: root.id
    }, actor.id);
    const position = createOrganizationPosition(database, workspace.id, {
      code: 'engineer', name: 'Инженер', category: 'engineering'
    }, actor.id);

    createAppointment(database, workspace.id, {
      personId: employee.id, organizationUnitId: first.id, positionId: position.id,
      appointmentKind: 'primary', validFrom: '2025-01-01', validTo: '2025-12-31'
    }, actor.id);
    const appointmentsBefore = database.get('SELECT COUNT(*) AS count FROM person_appointments').count;
    assert.throws(() => createAppointment(database, workspace.id, {
      personId: employee.id, organizationUnitId: second.id, positionId: position.id,
      appointmentKind: 'primary', validFrom: '2025-06-01', validTo: '2026-05-31'
    }, actor.id), /organization_primary_appointment_overlap/u);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM person_appointments').count, appointmentsBefore);

    assert.throws(() => updateOrganizationUnit(database, workspace.id, root.id, {
      parentId: first.id
    }, actor.id), /organization_unit_cycle/u);
    assert.equal(getOrganizationUnit(database, workspace.id, root.id).parent_id, null);
  } finally {
    await context.close();
  }
});

test('завершение назначения сохраняет исторический срез', async () => {
  const context = await setup();
  const { database, workspace } = context;
  try {
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const employee = createPerson(database, workspace.id, { displayName: 'Сотрудник' });
    const managerPerson = createPerson(database, workspace.id, { displayName: 'Руководитель' });
    const unit = createOrganizationUnit(database, workspace.id, {
      code: 'department', name: 'Кафедра', unitKind: 'department'
    }, actor.id);
    const position = createOrganizationPosition(database, workspace.id, {
      code: 'teacher', name: 'Преподаватель', category: 'teaching'
    }, actor.id);
    const appointment = createAppointment(database, workspace.id, {
      personId: employee.id, organizationUnitId: unit.id, positionId: position.id,
      validFrom: '2024-09-01'
    }, actor.id);
    const manager = assignUnitManager(database, workspace.id, {
      organizationUnitId: unit.id, personId: managerPerson.id, validFrom: '2024-01-01'
    }, actor.id);

    endAppointment(database, workspace.id, appointment.id, { validTo: '2025-08-31', reason: 'Перевод' }, actor.id,
      '2025-08-31T12:00:00.000Z');
    endUnitManager(database, workspace.id, manager.id, { validTo: '2025-12-31', reason: 'Смена руководителя' }, actor.id,
      '2025-12-31T12:00:00.000Z');

    assert.equal(resolvePersonOrganizationAt(database, workspace.id, employee.id, '2025-06-01').primary.id, appointment.id);
    assert.equal(resolvePersonOrganizationAt(database, workspace.id, employee.id, '2025-10-01').primary, null);
    assert.equal(organizationSnapshotAt(database, workspace.id, '2025-06-01').units[0].manager.id, manager.id);
    assert.equal(organizationSnapshotAt(database, workspace.id, '2026-01-01').units[0].manager, null);
  } finally {
    await context.close();
  }
});

test('у подразделения не бывает двух руководителей в один период', async () => {
  const context = await setup();
  const { database, workspace } = context;
  try {
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const first = createPerson(database, workspace.id, { displayName: 'Первый руководитель' });
    const second = createPerson(database, workspace.id, { displayName: 'Второй руководитель' });
    const unit = createOrganizationUnit(database, workspace.id, {
      code: 'department', name: 'Кафедра', unitKind: 'department'
    }, actor.id);
    assignUnitManager(database, workspace.id, {
      organizationUnitId: unit.id, personId: first.id,
      validFrom: '2025-01-01', validTo: '2025-12-31'
    }, actor.id);
    const before = database.get('SELECT COUNT(*) AS count FROM organization_unit_managers').count;
    assert.throws(() => assignUnitManager(database, workspace.id, {
      organizationUnitId: unit.id, personId: second.id,
      validFrom: '2025-06-01', validTo: '2026-05-31'
    }, actor.id), /organization_manager_period_overlap/u);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM organization_unit_managers').count, before);
  } finally {
    await context.close();
  }
});

test('после окончания последнего назначения совместимая текущая проекция очищается', async () => {
  const context = await setup();
  const { database, workspace } = context;
  try {
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const managerPerson = createPerson(database, workspace.id, { displayName: 'Руководитель' });
    const employee = createPerson(database, workspace.id, {
      displayName: 'Сотрудник Проекции', position: 'Старая должность', managerId: managerPerson.id
    });
    const unit = createOrganizationUnit(database, workspace.id, {
      code: 'projection-unit', name: 'Кафедра проекции', unitKind: 'department'
    }, actor.id);
    const position = createOrganizationPosition(database, workspace.id, {
      code: 'projection-position', name: 'Новая должность', category: 'teaching'
    }, actor.id);
    const appointment = createAppointment(database, workspace.id, {
      personId: employee.id, organizationUnitId: unit.id, positionId: position.id,
      validFrom: '2025-01-01', validTo: '2026-08-20'
    }, actor.id);
    syncPersonCompatibility(database, workspace.id, employee.id, '2026-08-21T08:00:00.000Z');
    const current = database.get('SELECT position, manager_id FROM people WHERE id = ?', employee.id);
    assert.equal(current.position, null);
    assert.equal(current.manager_id, null);
    assert.equal(database.get('SELECT id FROM person_appointments WHERE id = ?', appointment.id).id, appointment.id);
  } finally {
    await context.close();
  }
});
