import { newId } from '../../core/src/ids.mjs';

function today(now = new Date().toISOString()) {
  return String(now).slice(0, 10);
}

function previousDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function safelyClosePreviousPrimary(database, workspaceId, input = {}, now = new Date().toISOString()) {
  if ((input.appointmentKind || 'primary') !== 'primary' || input.closePrevious === false) return null;
  const validFrom = String(input.validFrom || '').slice(0, 10);
  if (!validFrom || !input.personId) return null;
  const current = database.get(`
    SELECT * FROM person_appointments
    WHERE workspace_id = ? AND person_id = ? AND appointment_kind = 'primary'
      AND status <> 'cancelled' AND valid_from <= ?
      AND (valid_to IS NULL OR valid_to >= ?)
    ORDER BY valid_from DESC LIMIT 1
  `, workspaceId, input.personId, validFrom, validFrom);
  if (!current || current.valid_from >= validFrom) return null;
  database.run(`
    UPDATE person_appointments SET valid_to = ?, status = 'ended', updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `, previousDay(validFrom), now, workspaceId, current.id);
  return current;
}

function currentPrimary(database, workspaceId, personId, at) {
  return database.get(`
    SELECT a.*, COALESCE(pos.name, a.position_title_snapshot) AS effective_position
    FROM person_appointments a
    LEFT JOIN organization_positions pos ON pos.id = a.position_id
    WHERE a.workspace_id = ? AND a.person_id = ? AND a.appointment_kind = 'primary'
      AND a.status <> 'cancelled' AND a.valid_from <= ?
      AND (a.valid_to IS NULL OR a.valid_to >= ?)
    ORDER BY a.valid_from DESC LIMIT 1
  `, workspaceId, personId, at, at) || null;
}

function currentManager(database, workspaceId, unitId, at) {
  if (!unitId) return null;
  return database.get(`
    SELECT m.* FROM organization_unit_managers m
    WHERE m.workspace_id = ? AND m.organization_unit_id = ? AND m.status <> 'cancelled'
      AND m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to >= ?)
    ORDER BY m.valid_from DESC LIMIT 1
  `, workspaceId, unitId, at, at) || null;
}

export function syncPersonCompatibility(database, workspaceId, personId, now = new Date().toISOString()) {
  const at = today(now);
  const appointment = currentPrimary(database, workspaceId, personId, at);
  if (!appointment) return null;
  const manager = currentManager(database, workspaceId, appointment.organization_unit_id, at);
  database.run(`
    UPDATE people SET position = ?,
      manager_id = CASE WHEN ? IS NOT NULL THEN ? ELSE manager_id END,
      updated_at = ? WHERE workspace_id = ? AND id = ?
  `, appointment.effective_position, manager?.person_id || null, manager?.person_id || null,
  now, workspaceId, personId);
  return { appointment, manager };
}

export function syncUnitManagerCompatibility(database, workspaceId, unitId, previousManagerId = null, now = new Date().toISOString()) {
  const at = today(now);
  const manager = currentManager(database, workspaceId, unitId, at);
  const people = database.all(`
    SELECT DISTINCT person_id FROM person_appointments
    WHERE workspace_id = ? AND organization_unit_id = ? AND appointment_kind = 'primary'
      AND status <> 'cancelled' AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)
  `, workspaceId, unitId, at, at);
  for (const row of people) {
    if (manager) {
      database.run('UPDATE people SET manager_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ? AND id <> ?',
        manager.person_id, now, workspaceId, row.person_id, manager.person_id);
    } else if (previousManagerId) {
      database.run('UPDATE people SET manager_id = NULL, updated_at = ? WHERE workspace_id = ? AND id = ? AND manager_id = ?',
        now, workspaceId, row.person_id, previousManagerId);
    }
  }
  return manager;
}

function publicationDate(database, scientificItemId) {
  const item = database.get('SELECT published_at, publication_year, created_at FROM scientific_items WHERE id = ?', scientificItemId);
  return item ? String(
    item.published_at || (item.publication_year ? `${item.publication_year}-12-31` : '') || item.created_at || today()
  ).slice(0, 10) : null;
}

export function refreshDerivedScientificAffiliations(database, workspaceId, personId, now = new Date().toISOString()) {
  const authors = database.all(`
    SELECT sia.scientific_item_id, sia.author_raw
    FROM scientific_item_authors sia JOIN scientific_items si ON si.id = sia.scientific_item_id
    WHERE si.workspace_id = ? AND sia.person_id = ?
  `, workspaceId, personId);
  for (const author of authors) {
    const validOn = publicationDate(database, author.scientific_item_id) || today(now);
    const appointment = database.get(`
      SELECT a.*, u.name AS unit_name, COALESCE(pos.name, a.position_title_snapshot) AS position_name
      FROM person_appointments a
      JOIN organization_units u ON u.id = a.organization_unit_id
      LEFT JOIN organization_positions pos ON pos.id = a.position_id
      WHERE a.workspace_id = ? AND a.person_id = ? AND a.status <> 'cancelled'
        AND a.valid_from <= ? AND (a.valid_to IS NULL OR a.valid_to >= ?)
      ORDER BY a.appointment_kind = 'primary' DESC, a.valid_from DESC LIMIT 1
    `, workspaceId, personId, validOn, validOn) || null;
    database.run(`
      INSERT INTO scientific_author_affiliations(
        id, workspace_id, scientific_item_id, author_raw, person_id, appointment_id,
        organization_unit_id, position_id, unit_name_snapshot, position_name_snapshot,
        valid_on, source_kind, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'derived', ?, ?, ?)
      ON CONFLICT(scientific_item_id, author_raw) DO UPDATE SET
        person_id = excluded.person_id, appointment_id = excluded.appointment_id,
        organization_unit_id = excluded.organization_unit_id, position_id = excluded.position_id,
        unit_name_snapshot = excluded.unit_name_snapshot,
        position_name_snapshot = excluded.position_name_snapshot, valid_on = excluded.valid_on,
        evidence_json = excluded.evidence_json, updated_at = excluded.updated_at
      WHERE scientific_author_affiliations.source_kind = 'derived'
    `, newId('scienceaff'), workspaceId, author.scientific_item_id, author.author_raw,
    personId, appointment?.id || null, appointment?.organization_unit_id || null,
    appointment?.position_id || null, appointment?.unit_name || null, appointment?.position_name || null,
    validOn, JSON.stringify({ source: 'organization_history', appointmentId: appointment?.id || null }), now, now);
  }
}
