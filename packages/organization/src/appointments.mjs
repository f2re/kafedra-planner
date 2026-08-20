import { newId } from '../../core/src/ids.mjs';
import {
  APPOINTMENT_KINDS, fail, text, isoDate, today, previousDay, audit,
  getPerson, getUnit, getPosition, appointmentRow, assertPeriod, assertInsideUnitPeriod
} from './shared.mjs';

export function listPersonAppointments(database, workspaceId, personId) {
  if (!getPerson(database, workspaceId, personId)) fail('organization_person_not_found');
  return database.all(`
    SELECT id FROM person_appointments WHERE workspace_id = ? AND person_id = ?
    ORDER BY valid_from DESC, appointment_kind, created_at DESC
  `, workspaceId, personId).map((item) => appointmentRow(database, workspaceId, item.id));
}

export function resolvePersonAppointment(database, workspaceId, personId, asOf = today(), { kind = 'primary' } = {}) {
  const date = isoDate(asOf, 'asOf');
  const params = [workspaceId, personId, date, date];
  let kindClause = '';
  if (kind) {
    kindClause = 'AND pa.appointment_kind = ?';
    params.push(kind);
  }
  const result = database.get(`
    SELECT pa.id FROM person_appointments pa
    WHERE pa.workspace_id = ? AND pa.person_id = ?
      AND pa.valid_from <= ? AND (pa.valid_to IS NULL OR pa.valid_to >= ?)
      ${kindClause}
    ORDER BY pa.appointment_kind = 'primary' DESC, pa.valid_from DESC LIMIT 1
  `, ...params);
  return result ? appointmentRow(database, workspaceId, result.id) : null;
}

export function listOrganizationPeople(database, workspaceId, { asOf = today() } = {}) {
  const date = isoDate(asOf, 'asOf');
  return database.all(`SELECT id FROM people WHERE workspace_id = ? ORDER BY status = 'active' DESC, display_name`, workspaceId)
    .map((item) => ({
      ...getPerson(database, workspaceId, item.id),
      appointment: resolvePersonAppointment(database, workspaceId, item.id, date, { kind: null })
    }));
}

function assertManager(database, workspaceId, personId, managerPersonId, asOf) {
  if (!managerPersonId) return null;
  if (personId === managerPersonId) fail('organization_manager_self');
  const manager = getPerson(database, workspaceId, managerPersonId);
  if (!manager) fail('organization_manager_not_found');
  let current = managerPersonId;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current === personId) fail('organization_manager_cycle');
    current = resolvePersonAppointment(database, workspaceId, current, asOf, { kind: 'primary' })?.manager_person_id
      || getPerson(database, workspaceId, current)?.manager_id || null;
  }
  return manager;
}

function appointmentInput(database, workspaceId, personId, input, current = {}) {
  if (!getPerson(database, workspaceId, personId)) fail('organization_person_not_found');
  const selectedUnit = getUnit(database, workspaceId, input.unitId ?? current.unit_id);
  if (!selectedUnit) fail('organization_unit_not_found');
  const positionId = input.positionId === undefined ? current.position_id : (input.positionId || null);
  const selectedPosition = positionId ? getPosition(database, workspaceId, positionId) : null;
  if (positionId && !selectedPosition) fail('organization_position_not_found');
  const validFrom = isoDate(input.validFrom ?? current.valid_from, 'validFrom', { fallback: today() });
  const validTo = isoDate(input.validTo === undefined ? current.valid_to : input.validTo, 'validTo', { required: false });
  assertPeriod(validFrom, validTo);
  assertInsideUnitPeriod(selectedUnit, validFrom, validTo);
  if (selectedUnit.status === 'inactive' && validFrom >= today()) fail('organization_unit_inactive');
  if (selectedPosition?.status === 'inactive' && validFrom >= today()) fail('organization_position_inactive');
  const managerPersonId = input.managerPersonId === undefined
    ? (current.manager_person_id || null)
    : (input.managerPersonId || null);
  assertManager(database, workspaceId, personId, managerPersonId, validFrom);
  const appointmentKind = input.appointmentKind ?? current.appointment_kind ?? 'primary';
  if (!APPOINTMENT_KINDS.has(appointmentKind)) fail('organization_appointment_kind_invalid');
  const sourceDocumentVersionId = input.sourceDocumentVersionId === undefined
    ? (current.source_document_version_id || null)
    : (input.sourceDocumentVersionId || null);
  if (sourceDocumentVersionId) {
    const source = database.get(`
      SELECT dv.id FROM document_versions dv JOIN documents d ON d.id = dv.document_id
      WHERE d.workspace_id = ? AND dv.id = ?
    `, workspaceId, sourceDocumentVersionId);
    if (!source) fail('organization_source_document_not_found');
  }
  return { selectedUnit, selectedPosition, validFrom, validTo, managerPersonId, appointmentKind, sourceDocumentVersionId };
}

function syncLegacyPerson(database, workspaceId, personId, now) {
  const current = resolvePersonAppointment(database, workspaceId, personId, today(), { kind: 'primary' });
  database.run(`UPDATE people SET position = ?, manager_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
    current?.position_name || null, current?.manager_person_id || null, now, workspaceId, personId);
}

export function refreshDerivedAffiliations(database, workspaceId, personId, actorPersonId = null, now = new Date().toISOString()) {
  const rows = database.all(`
    SELECT sia.scientific_item_id, sia.author_raw, si.published_at, si.publication_year, si.created_at
    FROM scientific_item_authors sia JOIN scientific_items si ON si.id = sia.scientific_item_id
    WHERE si.workspace_id = ? AND sia.person_id = ?
  `, workspaceId, personId);
  for (const item of rows) {
    const validOn = String(item.published_at || (item.publication_year ? `${item.publication_year}-12-31` : item.created_at)).slice(0, 10);
    const appointment = resolvePersonAppointment(database, workspaceId, personId, validOn, { kind: null });
    database.run(`
      INSERT INTO scientific_author_affiliations(
        id, scientific_item_id, author_raw, person_id, appointment_id, unit_id, position_id,
        unit_name_snapshot, position_name_snapshot, valid_on, source_kind, evidence_json,
        created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'derived', ?, ?, ?, ?)
      ON CONFLICT(scientific_item_id, author_raw) DO UPDATE SET
        person_id = excluded.person_id, appointment_id = excluded.appointment_id,
        unit_id = excluded.unit_id, position_id = excluded.position_id,
        unit_name_snapshot = excluded.unit_name_snapshot,
        position_name_snapshot = excluded.position_name_snapshot,
        valid_on = excluded.valid_on, evidence_json = excluded.evidence_json, updated_at = excluded.updated_at
      WHERE scientific_author_affiliations.source_kind = 'derived'
    `, newId('scienceaff'), item.scientific_item_id, item.author_raw, personId, appointment?.id || null,
    appointment?.unit_id || null, appointment?.position_id || null, appointment?.unit_name || null,
    appointment?.position_name || null, validOn,
    JSON.stringify({ derivedFromAppointmentId: appointment?.id || null }), actorPersonId, now, now);
  }
}

export function createPersonAppointment(database, workspaceId, personId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const normalized = appointmentInput(database, workspaceId, personId, input);
  const id = newId('appointment');
  database.transaction(() => {
    if (normalized.appointmentKind === 'primary' && input.closePrevious !== false) {
      const previous = resolvePersonAppointment(database, workspaceId, personId, normalized.validFrom, { kind: 'primary' });
      if (previous && previous.valid_from < normalized.validFrom) {
        database.run('UPDATE person_appointments SET valid_to = ?, updated_at = ? WHERE id = ?',
          previousDay(normalized.validFrom), now, previous.id);
      }
    }
    try {
      database.run(`
        INSERT INTO person_appointments(
          id, workspace_id, person_id, unit_id, position_id, manager_person_id,
          appointment_kind, valid_from, valid_to, source_document_version_id,
          evidence_json, change_reason, created_by_person_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, workspaceId, personId, normalized.selectedUnit.id, normalized.selectedPosition?.id || null,
      normalized.managerPersonId, normalized.appointmentKind, normalized.validFrom, normalized.validTo,
      normalized.sourceDocumentVersionId,
      JSON.stringify({ source: normalized.sourceDocumentVersionId ? 'document' : 'manual', provenance: 'operator' }),
      text(input.reason, 4000), actorPersonId, now, now);
    } catch (error) {
      if (/person_appointment_primary_overlap/iu.test(String(error?.message || error))) fail('organization_appointment_overlap');
      throw error;
    }
    syncLegacyPerson(database, workspaceId, personId, now);
    refreshDerivedAffiliations(database, workspaceId, personId, actorPersonId, now);
    audit(database, workspaceId, actorPersonId, 'organization.appointment_created', 'person_appointment', id,
      { personId, unitId: normalized.selectedUnit.id, positionId: normalized.selectedPosition?.id || null,
        managerPersonId: normalized.managerPersonId, appointmentKind: normalized.appointmentKind,
        validFrom: normalized.validFrom, validTo: normalized.validTo }, now);
  });
  return appointmentRow(database, workspaceId, id);
}

export function updatePersonAppointment(database, workspaceId, appointmentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = appointmentRow(database, workspaceId, appointmentId);
  if (!current) fail('organization_appointment_not_found');
  const reason = text(input.reason, 4000);
  if (!reason) fail('organization_change_reason_required');
  const normalized = appointmentInput(database, workspaceId, current.person_id, input, current);
  database.transaction(() => {
    try {
      database.run(`
        UPDATE person_appointments SET unit_id = ?, position_id = ?, manager_person_id = ?,
          appointment_kind = ?, valid_from = ?, valid_to = ?, source_document_version_id = ?, change_reason = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `, normalized.selectedUnit.id, normalized.selectedPosition?.id || null, normalized.managerPersonId,
      normalized.appointmentKind, normalized.validFrom, normalized.validTo, normalized.sourceDocumentVersionId, reason, now, workspaceId, appointmentId);
    } catch (error) {
      if (/person_appointment_primary_overlap/iu.test(String(error?.message || error))) fail('organization_appointment_overlap');
      throw error;
    }
    syncLegacyPerson(database, workspaceId, current.person_id, now);
    refreshDerivedAffiliations(database, workspaceId, current.person_id, actorPersonId, now);
    audit(database, workspaceId, actorPersonId, 'organization.appointment_updated', 'person_appointment', appointmentId,
      { reason, previous: current, next: { unitId: normalized.selectedUnit.id,
        positionId: normalized.selectedPosition?.id || null, managerPersonId: normalized.managerPersonId,
        appointmentKind: normalized.appointmentKind, validFrom: normalized.validFrom, validTo: normalized.validTo } }, now);
  });
  return appointmentRow(database, workspaceId, appointmentId);
}
