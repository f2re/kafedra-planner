import {
  assignUnitManager as baseAssignUnitManager,
  cancelAppointment as baseCancelAppointment,
  createAppointment as baseCreateAppointment,
  createOrganizationPosition,
  createOrganizationUnit as baseCreateOrganizationUnit,
  endAppointment,
  endUnitManager,
  getOrganizationUnit,
  listAppointments,
  listOrganizationPositions,
  listOrganizationUnits,
  listUnitManagers,
  organizationSnapshotAt as baseOrganizationSnapshotAt,
  resolvePersonOrganizationAt as baseResolvePersonOrganizationAt,
  updateAppointment as baseUpdateAppointment,
  updateOrganizationPosition,
  updateOrganizationUnit as baseUpdateOrganizationUnit
} from './base-service.mjs';

function fail(code, details = null) { const error = new Error(code); error.code = code; error.details = details; throw error; }

function isoDate(value, field, required = false) {
  if (!value) { if (required) fail('organization_date_required', { field }); return null; }
  const raw = String(value).slice(0, 10);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('organization_date_invalid', { field });
  }
  return raw;
}

function unitPeriod(input, current = {}) {
  const validFrom = isoDate(input.validFrom ?? current.valid_from ?? '2000-01-01', 'validFrom', true);
  const validTo = isoDate(input.validTo === undefined ? current.valid_to : input.validTo, 'validTo');
  if (validTo && validTo < validFrom) fail('organization_period_invalid');
  return { validFrom, validTo };
}

function assertParentPeriod(database, workspaceId, parentId, range) {
  if (!parentId) return;
  const parent = database.get('SELECT * FROM organization_units WHERE workspace_id = ? AND id = ?', workspaceId, parentId);
  if (!parent) fail('organization_unit_not_found');
  const end = range.validTo || '9999-12-31';
  const parentEnd = parent.valid_to || '9999-12-31';
  if (range.validFrom < parent.valid_from || end > parentEnd) fail('organization_parent_period_mismatch');
}

function assertUnitRelationsInside(database, workspaceId, unitId, range) {
  const end = range.validTo || '9999-12-31';
  const child = database.get(`SELECT id FROM organization_units WHERE workspace_id = ? AND parent_id = ? AND (valid_from < ? OR COALESCE(valid_to,'9999-12-31') > ?) LIMIT 1`, workspaceId, unitId, range.validFrom, end);
  if (child) fail('organization_unit_children_period_mismatch', { childUnitId: child.id });
  const appointment = database.get(`SELECT id FROM person_appointments WHERE workspace_id = ? AND organization_unit_id = ? AND status <> 'cancelled' AND (valid_from < ? OR COALESCE(valid_to,'9999-12-31') > ?) LIMIT 1`, workspaceId, unitId, range.validFrom, end);
  if (appointment) fail('organization_unit_appointments_period_mismatch', { appointmentId: appointment.id });
}

function assertAppointmentManager(database, workspaceId, personId, managerPersonId) {
  if (!managerPersonId) return null;
  if (managerPersonId === personId) fail('organization_manager_self');
  const manager = database.get('SELECT id, display_name FROM people WHERE workspace_id = ? AND id = ?', workspaceId, managerPersonId);
  if (!manager) fail('organization_manager_not_found');
  return manager;
}

function setAppointmentManager(database, workspaceId, appointmentId, personId, managerPersonId, now) {
  assertAppointmentManager(database, workspaceId, personId, managerPersonId);
  database.run('UPDATE person_appointments SET manager_person_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?', managerPersonId || null, now, workspaceId, appointmentId);
}

export function createOrganizationUnit(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const range = unitPeriod(input); assertParentPeriod(database, workspaceId, input.parentId || null, range);
  const item = baseCreateOrganizationUnit(database, workspaceId, input, actorPersonId, now);
  database.run('UPDATE organization_units SET valid_from = ?, valid_to = ?, updated_at = ? WHERE workspace_id = ? AND id = ?', range.validFrom, range.validTo, now, workspaceId, item.id);
  return getOrganizationUnit(database, workspaceId, item.id);
}

export function updateOrganizationUnit(database, workspaceId, unitId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = getOrganizationUnit(database, workspaceId, unitId); if (!current) fail('organization_unit_not_found');
  const range = unitPeriod(input, current);
  const parentId = input.parentId === undefined ? current.parent_id : (input.parentId || null);
  assertParentPeriod(database, workspaceId, parentId, range); assertUnitRelationsInside(database, workspaceId, unitId, range);
  baseUpdateOrganizationUnit(database, workspaceId, unitId, input, actorPersonId, now);
  database.run('UPDATE organization_units SET valid_from = ?, valid_to = ?, updated_at = ? WHERE workspace_id = ? AND id = ?', range.validFrom, range.validTo, now, workspaceId, unitId);
  return getOrganizationUnit(database, workspaceId, unitId);
}

export function createAppointment(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const managerPersonId = input.managerPersonId || null; assertAppointmentManager(database, workspaceId, input.personId, managerPersonId);
  const item = baseCreateAppointment(database, workspaceId, input, actorPersonId, now);
  setAppointmentManager(database, workspaceId, item.id, item.person_id, managerPersonId, now);
  return listAppointments(database, workspaceId, { personId: item.person_id, includeEnded: true }).find((row) => row.id === item.id) || item;
}

export function updateAppointment(database, workspaceId, appointmentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = listAppointments(database, workspaceId, { includeEnded: true }).find((row) => row.id === appointmentId); if (!current) fail('organization_appointment_not_found');
  const managerPersonId = input.managerPersonId === undefined ? current.manager_person_id : (input.managerPersonId || null);
  assertAppointmentManager(database, workspaceId, input.personId || current.person_id, managerPersonId);
  const item = baseUpdateAppointment(database, workspaceId, appointmentId, input, actorPersonId, now);
  setAppointmentManager(database, workspaceId, appointmentId, item.person_id, managerPersonId, now);
  return listAppointments(database, workspaceId, { personId: item.person_id, includeEnded: true }).find((row) => row.id === appointmentId) || item;
}

export function resolvePersonOrganizationAt(database, workspaceId, personId, at) {
  const result = baseResolvePersonOrganizationAt(database, workspaceId, personId, at);
  if (result.primary?.manager_person_id) {
    const manager = database.get('SELECT id, display_name FROM people WHERE workspace_id = ? AND id = ?', workspaceId, result.primary.manager_person_id);
    if (manager) result.manager = { id: `appointment:${result.primary.id}`, person_id: manager.id, person_name: manager.display_name, source_kind: 'appointment' };
  }
  return result;
}

function validUnitOn(item, at) { return item.valid_from <= at && (!item.valid_to || item.valid_to >= at); }
function filterUnitTree(nodes, at) {
  return (nodes || []).filter((item) => validUnitOn(item, at)).map((item) => ({ ...item, children: filterUnitTree(item.children || [], at) }));
}

export function organizationSnapshotAt(database, workspaceId, at = new Date().toISOString().slice(0,10)) {
  const date = isoDate(at, 'at', true);
  const snapshot = baseOrganizationSnapshotAt(database, workspaceId, date);
  return { ...snapshot, at: date, units: filterUnitTree(snapshot.units, date) };
}

export { baseAssignUnitManager as assignUnitManager, baseCancelAppointment as cancelAppointment, createOrganizationPosition, endAppointment, endUnitManager, getOrganizationUnit, listAppointments, listOrganizationPositions, listOrganizationUnits, listUnitManagers, updateOrganizationPosition };
