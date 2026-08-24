import { newId } from '../../core/src/ids.mjs';
import {
  UNIT_KINDS, STATUSES, fail, text, isoDate, today, audit, getUnit,
  unitRow, positionRow, assertPeriod, normalizeCode
} from './shared.mjs';

function norm(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
}

function overlaps(leftFrom, leftTo, rightFrom, rightTo) {
  return (leftTo || '9999-12-31') >= rightFrom && (rightTo || '9999-12-31') >= leftFrom;
}

function duplicateUnit(database, workspaceId, { unitId = null, parentUnitId = null, name, validFrom, validTo }) {
  return listOrganizationUnits(database, workspaceId, { includeInactive: true }).find((item) =>
    item.id !== unitId
      && (item.parent_unit_id || null) === (parentUnitId || null)
      && norm(item.name) === norm(name)
      && overlaps(item.valid_from, item.valid_to, validFrom, validTo)
  ) || null;
}

function assertParent(database, workspaceId, unitId, parentUnitId, validFrom, validTo) {
  if (!parentUnitId) return null;
  if (unitId && unitId === parentUnitId) fail('organization_unit_parent_self');
  const parent = getUnit(database, workspaceId, parentUnitId);
  if (!parent) fail('organization_unit_parent_not_found');
  const end = validTo || '9999-12-31';
  const parentEnd = parent.valid_to || '9999-12-31';
  if (validFrom < parent.valid_from || end > parentEnd) fail('organization_parent_period_mismatch');
  let current = parent;
  const visited = new Set();
  while (current?.parent_unit_id && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parent_unit_id === unitId) fail('organization_unit_cycle');
    current = getUnit(database, workspaceId, current.parent_unit_id);
  }
  return parent;
}

function assertContainedRelations(database, workspaceId, unitId, validFrom, validTo) {
  const end = validTo || '9999-12-31';
  const child = database.get(`
    SELECT id FROM organizational_units
    WHERE workspace_id = ? AND parent_unit_id = ?
      AND (valid_from < ? OR COALESCE(valid_to,'9999-12-31') > ?)
    LIMIT 1
  `, workspaceId, unitId, validFrom, end);
  if (child) fail('organization_unit_children_period_mismatch', { childUnitId: child.id });
  const appointment = database.get(`
    SELECT id FROM person_appointments
    WHERE workspace_id = ? AND unit_id = ?
      AND (valid_from < ? OR COALESCE(valid_to,'9999-12-31') > ?)
    LIMIT 1
  `, workspaceId, unitId, validFrom, end);
  if (appointment) fail('organization_unit_appointments_period_mismatch', { appointmentId: appointment.id });
}

export function listOrganizationUnits(database, workspaceId, {
  asOf = today(), includeInactive = false
} = {}) {
  const date = isoDate(asOf, 'asOf');
  const params = [workspaceId];
  const clauses = ['workspace_id = ?'];
  if (!includeInactive) {
    clauses.push("status = 'active'", 'valid_from <= ?', '(valid_to IS NULL OR valid_to >= ?)');
    params.push(date, date);
  }
  return database.all(`
    SELECT id FROM organizational_units WHERE ${clauses.join(' AND ')} ORDER BY name
  `, ...params).map((item) => unitRow(database, workspaceId, item.id, date));
}

export function organizationTree(database, workspaceId, options = {}) {
  const items = listOrganizationUnits(database, workspaceId, options);
  const byId = new Map(items.map((item) => [item.id, { ...item, children: [] }]));
  const roots = [];
  for (const item of byId.values()) {
    const parent = item.parent_unit_id ? byId.get(item.parent_unit_id) : null;
    if (parent) parent.children.push(item); else roots.push(item);
  }
  const sort = (nodes) => {
    nodes.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function listOrganizationPositions(database, workspaceId, { includeInactive = false } = {}) {
  return database.all(`
    SELECT id FROM organization_positions WHERE workspace_id = ?
      ${includeInactive ? '' : "AND status = 'active'"}
    ORDER BY name
  `, workspaceId).map((item) => positionRow(database, workspaceId, item.id));
}

export function createOrganizationUnit(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const name = text(input.name, 500);
  if (!name) fail('organization_unit_name_required');
  const unitKind = UNIT_KINDS.has(input.unitKind) ? input.unitKind : 'department';
  const validFrom = isoDate(input.validFrom, 'validFrom', { fallback: today() });
  const validTo = isoDate(input.validTo, 'validTo', { required: false });
  assertPeriod(validFrom, validTo);
  const parentUnitId = input.parentUnitId || null;
  assertParent(database, workspaceId, null, parentUnitId, validFrom, validTo);
  const duplicate = duplicateUnit(database, workspaceId, { parentUnitId, name, validFrom, validTo });
  if (duplicate) fail('organization_unit_duplicate', { unitId: duplicate.id });
  const code = normalizeCode(input.code);
  if (code && database.get('SELECT id FROM organizational_units WHERE workspace_id = ? AND code = ?', workspaceId, code)) {
    fail('organization_unit_duplicate');
  }
  const id = newId('orgunit');
  database.run(`
    INSERT INTO organizational_units(
      id, workspace_id, parent_unit_id, unit_kind, code, name, short_name,
      valid_from, valid_to, status, evidence_json, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `, id, workspaceId, parentUnitId, unitKind, code, name, text(input.shortName, 200),
  validFrom, validTo, JSON.stringify({ source: 'manual', provenance: 'operator' }), actorPersonId, now, now);
  audit(database, workspaceId, actorPersonId, 'organization.unit_created', 'organizational_unit', id,
    { parentUnitId, unitKind, validFrom, validTo }, now);
  return unitRow(database, workspaceId, id, validFrom);
}

export function updateOrganizationUnit(database, workspaceId, unitId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = getUnit(database, workspaceId, unitId);
  if (!current) fail('organization_unit_not_found');
  const reason = text(input.reason, 4000);
  if (!reason) fail('organization_change_reason_required');
  const name = text(input.name ?? current.name, 500);
  if (!name) fail('organization_unit_name_required');
  const unitKind = input.unitKind === undefined ? current.unit_kind : input.unitKind;
  if (!UNIT_KINDS.has(unitKind)) fail('organization_unit_kind_invalid');
  const status = input.status === undefined ? current.status : input.status;
  if (!STATUSES.has(status)) fail('organization_status_invalid');
  const validFrom = isoDate(input.validFrom ?? current.valid_from, 'validFrom');
  const validTo = isoDate(input.validTo === undefined ? current.valid_to : input.validTo, 'validTo', { required: false });
  assertPeriod(validFrom, validTo);
  const parentUnitId = input.parentUnitId === undefined ? current.parent_unit_id : (input.parentUnitId || null);
  assertParent(database, workspaceId, unitId, parentUnitId, validFrom, validTo);
  assertContainedRelations(database, workspaceId, unitId, validFrom, validTo);
  const duplicate = duplicateUnit(database, workspaceId, { unitId, parentUnitId, name, validFrom, validTo });
  if (duplicate) fail('organization_unit_duplicate', { unitId: duplicate.id });
  const code = normalizeCode(input.code === undefined ? current.code : input.code);
  if (code && database.get('SELECT id FROM organizational_units WHERE workspace_id = ? AND code = ? AND id <> ?', workspaceId, code, unitId)) {
    fail('organization_unit_duplicate');
  }
  database.run(`
    UPDATE organizational_units SET parent_unit_id = ?, unit_kind = ?, code = ?, name = ?, short_name = ?,
      valid_from = ?, valid_to = ?, status = ?, updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `, parentUnitId, unitKind, code, name,
  text(input.shortName === undefined ? current.short_name : input.shortName, 200),
  validFrom, validTo, status, now, workspaceId, unitId);
  audit(database, workspaceId, actorPersonId, 'organization.unit_updated', 'organizational_unit', unitId,
    { reason, previous: current, next: { parentUnitId, unitKind, code, name, validFrom, validTo, status } }, now);
  return unitRow(database, workspaceId, unitId, validFrom);
}

export function createOrganizationPosition(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const name = text(input.name, 500);
  if (!name) fail('organization_position_name_required');
  const duplicate = listOrganizationPositions(database, workspaceId, { includeInactive: true })
    .find((item) => norm(item.name) === norm(name));
  if (duplicate) fail('organization_position_duplicate', { positionId: duplicate.id });
  const code = normalizeCode(input.code);
  if (code && database.get('SELECT id FROM organization_positions WHERE workspace_id = ? AND code = ?', workspaceId, code)) {
    fail('organization_position_duplicate');
  }
  const id = newId('orgpos');
  database.run(`
    INSERT INTO organization_positions(
      id, workspace_id, code, name, status, evidence_json, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `, id, workspaceId, code, name,
  JSON.stringify({ source: 'manual', provenance: 'operator' }), actorPersonId, now, now);
  audit(database, workspaceId, actorPersonId, 'organization.position_created', 'organization_position', id, { name }, now);
  return positionRow(database, workspaceId, id);
}

export function updateOrganizationPosition(database, workspaceId, positionId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = database.get('SELECT * FROM organization_positions WHERE workspace_id = ? AND id = ?', workspaceId, positionId);
  if (!current) fail('organization_position_not_found');
  const reason = text(input.reason, 4000);
  if (!reason) fail('organization_change_reason_required');
  const name = text(input.name ?? current.name, 500);
  if (!name) fail('organization_position_name_required');
  const status = input.status === undefined ? current.status : input.status;
  if (!STATUSES.has(status)) fail('organization_status_invalid');
  const duplicate = listOrganizationPositions(database, workspaceId, { includeInactive: true })
    .find((item) => item.id !== positionId && norm(item.name) === norm(name));
  if (duplicate) fail('organization_position_duplicate', { positionId: duplicate.id });
  if (status === 'inactive' && database.get(`
    SELECT id FROM person_appointments WHERE workspace_id = ? AND position_id = ?
      AND valid_from <= date('now') AND (valid_to IS NULL OR valid_to >= date('now')) LIMIT 1
  `, workspaceId, positionId)) fail('organization_position_in_use');
  const code = normalizeCode(input.code === undefined ? current.code : input.code);
  if (code && database.get('SELECT id FROM organization_positions WHERE workspace_id = ? AND code = ? AND id <> ?', workspaceId, code, positionId)) {
    fail('organization_position_duplicate');
  }
  database.run(`UPDATE organization_positions SET code = ?, name = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
    code, name, status, now, workspaceId, positionId);
  audit(database, workspaceId, actorPersonId, 'organization.position_updated', 'organization_position', positionId,
    { reason, previous: current, next: { code, name, status } }, now);
  return positionRow(database, workspaceId, positionId);
}
