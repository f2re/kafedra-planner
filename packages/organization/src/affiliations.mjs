import { newId } from '../../core/src/ids.mjs';

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

function isoDate(value, field) {
  const raw = String(value || '').slice(0, 10);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('organization_date_invalid', { field });
  }
  return raw;
}

export function listScientificAuthorAffiliations(database, workspaceId, scientificItemId) {
  return database.all(`
    SELECT saa.*, p.display_name AS person_name
    FROM scientific_author_affiliations saa
    LEFT JOIN people p ON p.id = saa.person_id
    WHERE saa.workspace_id = ? AND saa.scientific_item_id = ?
    ORDER BY saa.author_raw
  `, workspaceId, scientificItemId);
}

export function setScientificAuthorAffiliation(database, workspaceId, scientificItemId, authorRaw, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const author = database.get(`
    SELECT sia.person_id, si.published_at, si.publication_year, si.created_at
    FROM scientific_item_authors sia JOIN scientific_items si ON si.id = sia.scientific_item_id
    WHERE si.workspace_id = ? AND sia.scientific_item_id = ? AND sia.author_raw = ?
  `, workspaceId, scientificItemId, authorRaw);
  if (!author) fail('scientific_author_not_found');
  const reason = text(input.reason, 4000);
  if (!reason) fail('organization_change_reason_required');
  const validOn = isoDate(input.validOn || String(
    author.published_at || (author.publication_year ? `${author.publication_year}-12-31` : '') || author.created_at
  ).slice(0, 10), 'validOn');
  const personId = input.personId || author.person_id || null;
  if (personId && !database.get('SELECT id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, personId)) {
    fail('organization_person_not_found');
  }
  const unit = input.organizationUnitId
    ? database.get('SELECT * FROM organization_units WHERE workspace_id = ? AND id = ?', workspaceId, input.organizationUnitId)
    : null;
  if (input.organizationUnitId && !unit) fail('organization_unit_not_found');
  const position = input.positionId
    ? database.get('SELECT * FROM organization_positions WHERE workspace_id = ? AND id = ?', workspaceId, input.positionId)
    : null;
  if (input.positionId && !position) fail('organization_position_not_found');

  database.run(`
    INSERT INTO scientific_author_affiliations(
      id, workspace_id, scientific_item_id, author_raw, person_id, appointment_id,
      organization_unit_id, position_id, unit_name_snapshot, position_name_snapshot,
      valid_on, source_kind, evidence_json, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
    ON CONFLICT(scientific_item_id, author_raw) DO UPDATE SET
      person_id = excluded.person_id, appointment_id = NULL,
      organization_unit_id = excluded.organization_unit_id, position_id = excluded.position_id,
      unit_name_snapshot = excluded.unit_name_snapshot,
      position_name_snapshot = excluded.position_name_snapshot,
      valid_on = excluded.valid_on, source_kind = 'manual',
      evidence_json = excluded.evidence_json,
      created_by_person_id = excluded.created_by_person_id, updated_at = excluded.updated_at
  `, newId('scienceaff'), workspaceId, scientificItemId, authorRaw, personId,
  unit?.id || null, position?.id || null,
  unit?.name || text(input.unitName, 500), position?.name || text(input.positionName, 500),
  validOn, JSON.stringify({ source: 'manual', reason }), actorPersonId, now, now);
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, 'science.affiliation_updated', 'scientific_item', ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', scientificItemId,
  JSON.stringify({ authorRaw, validOn, personId, organizationUnitId: unit?.id || null, positionId: position?.id || null, reason }), now);
  return listScientificAuthorAffiliations(database, workspaceId, scientificItemId);
}
