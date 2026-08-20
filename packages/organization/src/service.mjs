import { newId } from '../../core/src/ids.mjs';

const UNIT_KINDS = new Set(['organization', 'faculty', 'department', 'laboratory', 'section', 'other']);
const POSITION_CATEGORIES = new Set(['leadership', 'teaching', 'research', 'engineering', 'administrative', 'support', 'other']);
const APPOINTMENT_KINDS = new Set(['primary', 'additional', 'temporary']);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value, max = 1000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function normalizedCode(value) {
  const result = text(value, 120)?.toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!result) fail('organization_code_required');
  return result;
}

function isoDate(value, field, required = false) {
  if (!value) {
    if (required) fail('organization_date_required', { field });
    return null;
  }
  const raw = String(value).slice(0, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw)) fail('organization_date_invalid', { field });
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('organization_date_invalid', { field });
  }
  return raw;
}

function period(input = {}, current = {}) {
  const validFrom = isoDate(input.validFrom ?? input.valid_from ?? current.valid_from, 'validFrom', true);
  const validTo = isoDate(input.validTo ?? input.valid_to ?? current.valid_to, 'validTo');
  if (validTo && validTo < validFrom) fail('organization_period_invalid');
  return { validFrom, validTo };
}

function audit(database, workspaceId, actorPersonId, action, subjectKind, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action, subjectKind, subjectId,
  JSON.stringify(details || {}), now);
}

function person(database, workspaceId, personId) {
  const row = database.get('SELECT id, display_name, status FROM people WHERE workspace_id = ? AND id = ?', workspaceId, personId);
  if (!row) fail('organization_person_not_found', { personId });
  return row;
}

function unit(database, workspaceId, unitId) {
  return database.get(`
    SELECT u.*, parent.name AS parent_name
    FROM organization_units u
    LEFT JOIN organization_units parent ON parent.id = u.parent_id
    WHERE u.workspace_id = ? AND u.id = ?
  `, workspaceId, unitId) || null;
}

function position(database, workspaceId, positionId) {
  if (!positionId) return null;
  return database.get('SELECT * FROM organization_positions WHERE workspace_id = ? AND id = ?', workspaceId, positionId) || null;
}

function appointment(database, workspaceId, appointmentId) {
  return database.get(`
    SELECT a.*, p.display_name AS person_name, u.name AS unit_name,
      pos.name AS position_name, pos.code AS position_code
    FROM person_appointments a
    JOIN people p ON p.id = a.person_id
    JOIN organization_units u ON u.id = a.organization_unit_id
    LEFT JOIN organization_positions pos ON pos.id = a.position_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, appointmentId) || null;
}

function manager(database, workspaceId, managerId) {
  return database.get(`
    SELECT m.*, p.display_name AS person_name, u.name AS unit_name
    FROM organization_unit_managers m
    JOIN people p ON p.id = m.person_id
    JOIN organization_units u ON u.id = m.organization_unit_id
    WHERE m.workspace_id = ? AND m.id = ?
  `, workspaceId, managerId) || null;
}

function requireUnit(database, workspaceId, unitId, active = false) {
  const row = unit(database, workspaceId, unitId);
  if (!row || (active && row.status !== 'active')) fail('organization_unit_not_found', { unitId });
  return row;
}

function requirePosition(database, workspaceId, positionId, active = false) {
  if (!positionId) return null;
  const row = position(database, workspaceId, positionId);
  if (!row || (active && row.status !== 'active')) fail('organization_position_not_found', { positionId });
  return row;
}

function descendants(database, workspaceId, unitId) {
  return database.all(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM organization_units WHERE workspace_id = ? AND parent_id = ?
      UNION ALL
      SELECT child.id FROM organization_units child JOIN tree ON child.parent_id = tree.id
      WHERE child.workspace_id = ?
    ) SELECT id FROM tree
  `, workspaceId, unitId, workspaceId).map((row) => row.id);
}

function requireParent(database, workspaceId, unitId, parentId) {
  if (!parentId) return null;
  const row = requireUnit(database, workspaceId, parentId, true);
  if (unitId && (unitId === parentId || descendants(database, workspaceId, unitId).includes(parentId))) {
    fail('organization_unit_cycle');
  }
  return row;
}

function periodsOverlap(database, table, workspaceId, subjectColumn, subjectId, range, excludeId = null, extra = '') {
  const params = [workspaceId, subjectId, range.validTo, range.validFrom];
  let exclude = '';
  if (excludeId) { exclude = 'AND id <> ?'; params.push(excludeId); }
  return database.get(`
    SELECT id, valid_from, valid_to FROM ${table}
    WHERE workspace_id = ? AND ${subjectColumn} = ? AND status <> 'cancelled'
      AND valid_from <= COALESCE(?, '9999-12-31')
      AND (valid_to IS NULL OR valid_to >= ?)
      ${extra} ${exclude}
    ORDER BY valid_from LIMIT 1
  `, ...params) || null;
}

export function listOrganizationUnits(database, workspaceId, { includeArchived = false } = {}) {
  return database.all(`
    SELECT u.*, parent.name AS parent_name,
      (SELECT COUNT(*) FROM organization_units c WHERE c.parent_id = u.id) AS child_count,
      (SELECT COUNT(*) FROM person_appointments a
        WHERE a.organization_unit_id = u.id AND a.status <> 'cancelled') AS appointment_count
    FROM organization_units u
    LEFT JOIN organization_units parent ON parent.id = u.parent_id
    WHERE u.workspace_id = ? ${includeArchived ? '' : "AND u.status = 'active'"}
    ORDER BY u.parent_id IS NOT NULL, u.sort_order, u.name
  `, workspaceId);
}

export function getOrganizationUnit(database, workspaceId, unitId) {
  const item = unit(database, workspaceId, unitId);
  if (!item) return null;
  return {
    ...item,
    children: database.all(`SELECT * FROM organization_units WHERE workspace_id = ? AND parent_id = ? ORDER BY sort_order, name`, workspaceId, unitId),
    appointments: listAppointments(database, workspaceId, { organizationUnitId: unitId, includeEnded: true }),
    managers: listUnitManagers(database, workspaceId, { organizationUnitId: unitId, includeEnded: true })
  };
}

export function createOrganizationUnit(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const name = text(input.name, 500);
  if (!name) fail('organization_unit_name_required');
  const code = normalizedCode(input.code || name);
  const kind = UNIT_KINDS.has(input.unitKind) ? input.unitKind : 'department';
  const parent = requireParent(database, workspaceId, null, input.parentId || null);
  const id = newId('unit');
  try {
    database.run(`
      INSERT INTO organization_units(
        id, workspace_id, parent_id, code, name, unit_kind, status, sort_order,
        created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `, id, workspaceId, parent?.id || null, code, name, kind,
    Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    actorPersonId, now, now);
  } catch (cause) {
    if (String(cause?.message || cause).includes('UNIQUE')) fail('organization_unit_code_exists', { code });
    throw cause;
  }
  audit(database, workspaceId, actorPersonId, 'organization.unit_created', 'organization_unit', id,
    { parentId: parent?.id || null, code, kind }, now);
  return unit(database, workspaceId, id);
}

export function updateOrganizationUnit(database, workspaceId, unitId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = requireUnit(database, workspaceId, unitId);
  const name = text(input.name ?? current.name, 500);
  if (!name) fail('organization_unit_name_required');
  const code = normalizedCode(input.code ?? current.code);
  const kind = UNIT_KINDS.has(input.unitKind) ? input.unitKind : current.unit_kind;
  const parentId = input.parentId === undefined ? current.parent_id : (input.parentId || null);
  requireParent(database, workspaceId, unitId, parentId);
  const status = ['active', 'archived'].includes(input.status) ? input.status : current.status;
  if (status === 'archived') {
    const activeChildren = database.get(`SELECT COUNT(*) AS count FROM organization_units WHERE workspace_id = ? AND parent_id = ? AND status = 'active'`, workspaceId, unitId)?.count || 0;
    if (activeChildren) fail('organization_unit_has_active_children', { count: activeChildren });
    const activeAppointments = database.get(`SELECT COUNT(*) AS count FROM person_appointments WHERE workspace_id = ? AND organization_unit_id = ? AND status = 'active'`, workspaceId, unitId)?.count || 0;
    if (activeAppointments) fail('organization_unit_has_active_appointments', { count: activeAppointments });
  }
  try {
    database.run(`
      UPDATE organization_units SET parent_id = ?, code = ?, name = ?, unit_kind = ?, status = ?, sort_order = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, parentId, code, name, kind, status,
    Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : current.sort_order,
    now, workspaceId, unitId);
  } catch (cause) {
    if (String(cause?.message || cause).includes('UNIQUE')) fail('organization_unit_code_exists', { code });
    throw cause;
  }
  audit(database, workspaceId, actorPersonId, 'organization.unit_updated', 'organization_unit', unitId, { previous: current }, now);
  return unit(database, workspaceId, unitId);
}

export function listOrganizationPositions(database, workspaceId, { includeArchived = false } = {}) {
  return database.all(`
    SELECT pos.*, (SELECT COUNT(*) FROM person_appointments a
      WHERE a.position_id = pos.id AND a.status <> 'cancelled') AS appointment_count
    FROM organization_positions pos
    WHERE pos.workspace_id = ? ${includeArchived ? '' : "AND pos.status = 'active'"}
    ORDER BY pos.category, pos.name
  `, workspaceId);
}

export function createOrganizationPosition(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const name = text(input.name, 500);
  if (!name) fail('organization_position_name_required');
  const code = normalizedCode(input.code || name);
  const category = POSITION_CATEGORIES.has(input.category) ? input.category : 'other';
  const id = newId('position');
  try {
    database.run(`
      INSERT INTO organization_positions(id, workspace_id, code, name, category, status, created_by_person_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `, id, workspaceId, code, name, category, actorPersonId, now, now);
  } catch (cause) {
    if (String(cause?.message || cause).includes('UNIQUE')) fail('organization_position_code_exists', { code });
    throw cause;
  }
  audit(database, workspaceId, actorPersonId, 'organization.position_created', 'organization_position', id, { code, category }, now);
  return position(database, workspaceId, id);
}

export function updateOrganizationPosition(database, workspaceId, positionId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = requirePosition(database, workspaceId, positionId);
  const name = text(input.name ?? current.name, 500);
  if (!name) fail('organization_position_name_required');
  const code = normalizedCode(input.code ?? current.code);
  const category = POSITION_CATEGORIES.has(input.category) ? input.category : current.category;
  const status = ['active', 'archived'].includes(input.status) ? input.status : current.status;
  if (status === 'archived') {
    const active = database.get(`SELECT COUNT(*) AS count FROM person_appointments WHERE workspace_id = ? AND position_id = ? AND status = 'active'`, workspaceId, positionId)?.count || 0;
    if (active) fail('organization_position_has_active_appointments', { count: active });
  }
  try {
    database.run(`UPDATE organization_positions SET code = ?, name = ?, category = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
      code, name, category, status, now, workspaceId, positionId);
  } catch (cause) {
    if (String(cause?.message || cause).includes('UNIQUE')) fail('organization_position_code_exists', { code });
    throw cause;
  }
  audit(database, workspaceId, actorPersonId, 'organization.position_updated', 'organization_position', positionId, { previous: current }, now);
  return position(database, workspaceId, positionId);
}

function normalizedAppointment(database, workspaceId, input, current = {}) {
  const personId = input.personId ?? current.person_id;
  person(database, workspaceId, personId);
  const unitId = input.organizationUnitId ?? input.unitId ?? current.organization_unit_id;
  requireUnit(database, workspaceId, unitId, true);
  const positionId = input.positionId === undefined ? (current.position_id || null) : (input.positionId || null);
  const pos = requirePosition(database, workspaceId, positionId, true);
  const snapshot = text(input.positionTitleSnapshot ?? input.positionTitle ?? current.position_title_snapshot, 500) || pos?.name || null;
  if (!snapshot) fail('organization_appointment_position_required');
  const kind = APPOINTMENT_KINDS.has(input.appointmentKind) ? input.appointmentKind : (current.appointment_kind || 'primary');
  const workload = Number(input.workloadFraction ?? current.workload_fraction ?? 1);
  if (!Number.isFinite(workload) || workload <= 0 || workload > 1.5) fail('organization_workload_invalid');
  return { personId, unitId, positionId, snapshot, kind, workload, ...period(input, current) };
}

function requirePrimaryFree(database, workspaceId, personId, range, excludeId = null) {
  const conflict = periodsOverlap(database, 'person_appointments', workspaceId, 'person_id', personId, range, excludeId,
    "AND appointment_kind = 'primary'");
  if (conflict) fail('organization_primary_appointment_overlap', { conflict });
}

export function createAppointment(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const value = normalizedAppointment(database, workspaceId, input);
  if (value.kind === 'primary') requirePrimaryFree(database, workspaceId, value.personId, value);
  const id = newId('appointment');
  database.run(`
    INSERT INTO person_appointments(
      id, workspace_id, person_id, organization_unit_id, position_id, position_title_snapshot,
      appointment_kind, workload_fraction, valid_from, valid_to, status,
      source_document_version_id, evidence_json, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `, id, workspaceId, value.personId, value.unitId, value.positionId, value.snapshot, value.kind, value.workload,
  value.validFrom, value.validTo, input.sourceDocumentVersionId || null,
  JSON.stringify(input.evidence || { source: 'manual', enteredByPersonId: actorPersonId, enteredAt: now }),
  actorPersonId, now, now);
  audit(database, workspaceId, actorPersonId, 'organization.appointment_created', 'person_appointment', id,
    { personId: value.personId, unitId: value.unitId, kind: value.kind, validFrom: value.validFrom, validTo: value.validTo }, now);
  return appointment(database, workspaceId, id);
}

export function updateAppointment(database, workspaceId, appointmentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = appointment(database, workspaceId, appointmentId);
  if (!current) fail('organization_appointment_not_found');
  if (current.status === 'cancelled') fail('organization_appointment_cancelled');
  const value = normalizedAppointment(database, workspaceId, input, current);
  if (value.kind === 'primary') requirePrimaryFree(database, workspaceId, value.personId, value, appointmentId);
  const status = ['active', 'ended'].includes(input.status) ? input.status : current.status;
  database.run(`
    UPDATE person_appointments SET person_id = ?, organization_unit_id = ?, position_id = ?,
      position_title_snapshot = ?, appointment_kind = ?, workload_fraction = ?,
      valid_from = ?, valid_to = ?, status = ?, updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `, value.personId, value.unitId, value.positionId, value.snapshot, value.kind, value.workload,
  value.validFrom, value.validTo, status, now, workspaceId, appointmentId);
  audit(database, workspaceId, actorPersonId, 'organization.appointment_updated', 'person_appointment', appointmentId, { previous: current }, now);
  return appointment(database, workspaceId, appointmentId);
}

export function endAppointment(database, workspaceId, appointmentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = appointment(database, workspaceId, appointmentId);
  if (!current) fail('organization_appointment_not_found');
  const validTo = isoDate(input.validTo || now.slice(0, 10), 'validTo', true);
  if (validTo < current.valid_from) fail('organization_period_invalid');
  database.run(`UPDATE person_appointments SET valid_to = ?, status = 'ended', updated_at = ? WHERE workspace_id = ? AND id = ?`,
    validTo, now, workspaceId, appointmentId);
  audit(database, workspaceId, actorPersonId, 'organization.appointment_ended', 'person_appointment', appointmentId,
    { validTo, reason: text(input.reason, 4000) }, now);
  return appointment(database, workspaceId, appointmentId);
}

export function cancelAppointment(database, workspaceId, appointmentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = appointment(database, workspaceId, appointmentId);
  if (!current) fail('organization_appointment_not_found');
  database.run(`UPDATE person_appointments SET status = 'cancelled', updated_at = ? WHERE workspace_id = ? AND id = ?`,
    now, workspaceId, appointmentId);
  audit(database, workspaceId, actorPersonId, 'organization.appointment_cancelled', 'person_appointment', appointmentId,
    { reason: text(input.reason, 4000), preserved: current }, now);
  return appointment(database, workspaceId, appointmentId);
}

export function listAppointments(database, workspaceId, {
  personId = null, organizationUnitId = null, at = null, includeEnded = false
} = {}) {
  const params = [workspaceId];
  const where = ['a.workspace_id = ?'];
  if (personId) { where.push('a.person_id = ?'); params.push(personId); }
  if (organizationUnitId) { where.push('a.organization_unit_id = ?'); params.push(organizationUnitId); }
  if (at) {
    const date = isoDate(at, 'at', true);
    where.push("a.status <> 'cancelled' AND a.valid_from <= ? AND (a.valid_to IS NULL OR a.valid_to >= ?)");
    params.push(date, date);
  } else if (!includeEnded) where.push("a.status = 'active'");
  else where.push("a.status <> 'cancelled'");
  return database.all(`
    SELECT a.*, p.display_name AS person_name, u.name AS unit_name,
      pos.name AS position_name, pos.code AS position_code
    FROM person_appointments a
    JOIN people p ON p.id = a.person_id
    JOIN organization_units u ON u.id = a.organization_unit_id
    LEFT JOIN organization_positions pos ON pos.id = a.position_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.valid_from DESC, a.appointment_kind, p.display_name
  `, ...params);
}

export function assignUnitManager(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const unitId = input.organizationUnitId || input.unitId;
  requireUnit(database, workspaceId, unitId, true);
  const managerPerson = person(database, workspaceId, input.personId);
  const range = period(input);
  const conflict = periodsOverlap(database, 'organization_unit_managers', workspaceId, 'organization_unit_id', unitId, range);
  if (conflict) fail('organization_manager_period_overlap', { conflict });
  const linkedAppointment = input.appointmentId ? appointment(database, workspaceId, input.appointmentId) : null;
  if (input.appointmentId && (!linkedAppointment || linkedAppointment.person_id !== managerPerson.id || linkedAppointment.organization_unit_id !== unitId)) {
    fail('organization_manager_appointment_invalid');
  }
  const id = newId('unitmanager');
  database.run(`
    INSERT INTO organization_unit_managers(
      id, workspace_id, organization_unit_id, person_id, appointment_id,
      valid_from, valid_to, status, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `, id, workspaceId, unitId, managerPerson.id, linkedAppointment?.id || null,
  range.validFrom, range.validTo, actorPersonId, now, now);
  audit(database, workspaceId, actorPersonId, 'organization.manager_assigned', 'organization_unit_manager', id,
    { unitId, personId: managerPerson.id, ...range }, now);
  return manager(database, workspaceId, id);
}

export function endUnitManager(database, workspaceId, managerId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = manager(database, workspaceId, managerId);
  if (!current) fail('organization_manager_not_found');
  const validTo = isoDate(input.validTo || now.slice(0, 10), 'validTo', true);
  if (validTo < current.valid_from) fail('organization_period_invalid');
  database.run(`UPDATE organization_unit_managers SET valid_to = ?, status = 'ended', updated_at = ? WHERE workspace_id = ? AND id = ?`,
    validTo, now, workspaceId, managerId);
  audit(database, workspaceId, actorPersonId, 'organization.manager_ended', 'organization_unit_manager', managerId,
    { validTo, reason: text(input.reason, 4000) }, now);
  return manager(database, workspaceId, managerId);
}

export function listUnitManagers(database, workspaceId, {
  organizationUnitId = null, personId = null, at = null, includeEnded = false
} = {}) {
  const params = [workspaceId];
  const where = ['m.workspace_id = ?'];
  if (organizationUnitId) { where.push('m.organization_unit_id = ?'); params.push(organizationUnitId); }
  if (personId) { where.push('m.person_id = ?'); params.push(personId); }
  if (at) {
    const date = isoDate(at, 'at', true);
    where.push("m.status <> 'cancelled' AND m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to >= ?)");
    params.push(date, date);
  } else if (!includeEnded) where.push("m.status = 'active'");
  else where.push("m.status <> 'cancelled'");
  return database.all(`
    SELECT m.*, p.display_name AS person_name, u.name AS unit_name
    FROM organization_unit_managers m
    JOIN people p ON p.id = m.person_id
    JOIN organization_units u ON u.id = m.organization_unit_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.valid_from DESC, u.name
  `, ...params);
}

export function resolvePersonOrganizationAt(database, workspaceId, personId, at = new Date().toISOString().slice(0, 10)) {
  person(database, workspaceId, personId);
  const date = isoDate(at, 'at', true);
  const appointments = listAppointments(database, workspaceId, { personId, at: date, includeEnded: true });
  const primary = appointments.find((row) => row.appointment_kind === 'primary') || null;
  const additional = appointments.filter((row) => row.appointment_kind !== 'primary');
  const activeManager = primary ? listUnitManagers(database, workspaceId, {
    organizationUnitId: primary.organization_unit_id, at: date, includeEnded: true
  })[0] || null : null;
  return { personId, at: date, primary, additional, manager: activeManager };
}

export function organizationSnapshotAt(database, workspaceId, at = new Date().toISOString().slice(0, 10)) {
  const date = isoDate(at, 'at', true);
  const units = listOrganizationUnits(database, workspaceId, { includeArchived: true });
  const appointments = listAppointments(database, workspaceId, { at: date, includeEnded: true });
  const managers = listUnitManagers(database, workspaceId, { at: date, includeEnded: true });
  const grouped = new Map();
  for (const item of units) {
    const key = item.parent_id || '__root__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const build = (parentId = null, path = new Set()) => (grouped.get(parentId || '__root__') || []).map((item) => {
    if (path.has(item.id)) fail('organization_unit_cycle', { unitId: item.id });
    const next = new Set(path); next.add(item.id);
    return {
      ...item,
      manager: managers.find((row) => row.organization_unit_id === item.id) || null,
      appointments: appointments.filter((row) => row.organization_unit_id === item.id),
      children: build(item.id, next)
    };
  });
  return { at: date, units: build() };
}
