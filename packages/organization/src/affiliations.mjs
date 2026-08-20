import { newId } from '../../core/src/ids.mjs';
import { fail, text, isoDate, audit, getPerson, getUnit, getPosition, parseJson } from './shared.mjs';

export function listScientificAuthorAffiliations(database, workspaceId, scientificItemId) {
  return database.all(`
    SELECT saa.*, p.display_name AS person_name, ou.name AS unit_name, op.name AS position_name
    FROM scientific_author_affiliations saa
    JOIN scientific_items si ON si.id = saa.scientific_item_id
    LEFT JOIN people p ON p.id = saa.person_id
    LEFT JOIN organizational_units ou ON ou.id = saa.unit_id
    LEFT JOIN organization_positions op ON op.id = saa.position_id
    WHERE si.workspace_id = ? AND saa.scientific_item_id = ? ORDER BY saa.author_raw
  `, workspaceId, scientificItemId).map((item) => ({ ...item, evidence: parseJson(item.evidence_json) }));
}

export function setScientificAuthorAffiliation(database, workspaceId, scientificItemId, authorRaw, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const author = database.get(`
    SELECT sia.*, si.published_at, si.publication_year, si.created_at
    FROM scientific_item_authors sia JOIN scientific_items si ON si.id = sia.scientific_item_id
    WHERE si.workspace_id = ? AND sia.scientific_item_id = ? AND sia.author_raw = ?
  `, workspaceId, scientificItemId, authorRaw);
  if (!author) fail('scientific_author_not_found');
  const reason = text(input.reason, 4000);
  if (!reason) fail('organization_change_reason_required');
  const validOn = isoDate(input.validOn, 'validOn', {
    fallback: String(author.published_at || (author.publication_year ? `${author.publication_year}-12-31` : author.created_at)).slice(0, 10)
  });
  const selectedUnit = input.unitId ? getUnit(database, workspaceId, input.unitId) : null;
  if (input.unitId && !selectedUnit) fail('organization_unit_not_found');
  const selectedPosition = input.positionId ? getPosition(database, workspaceId, input.positionId) : null;
  if (input.positionId && !selectedPosition) fail('organization_position_not_found');
  const selectedPerson = input.personId ? getPerson(database, workspaceId, input.personId) : null;
  if (input.personId && !selectedPerson) fail('organization_person_not_found');
  database.transaction(() => {
    database.run(`
      INSERT INTO scientific_author_affiliations(
        id, scientific_item_id, author_raw, person_id, unit_id, position_id,
        unit_name_snapshot, position_name_snapshot, valid_on, source_kind, evidence_json,
        created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
      ON CONFLICT(scientific_item_id, author_raw) DO UPDATE SET
        person_id = excluded.person_id, appointment_id = NULL, unit_id = excluded.unit_id,
        position_id = excluded.position_id, unit_name_snapshot = excluded.unit_name_snapshot,
        position_name_snapshot = excluded.position_name_snapshot, valid_on = excluded.valid_on,
        source_kind = 'manual', evidence_json = excluded.evidence_json,
        created_by_person_id = excluded.created_by_person_id, updated_at = excluded.updated_at
    `, newId('scienceaff'), scientificItemId, authorRaw, selectedPerson?.id || author.person_id || null,
    selectedUnit?.id || null, selectedPosition?.id || null,
    selectedUnit?.name || text(input.unitName, 500), selectedPosition?.name || text(input.positionName, 500),
    validOn, JSON.stringify({ source: 'manual', reason }), actorPersonId, now, now);
    database.run(`
      UPDATE scientific_item_authors SET person_id = COALESCE(?, person_id), affiliation = ?
      WHERE scientific_item_id = ? AND author_raw = ?
    `, selectedPerson?.id || null, selectedUnit?.name || text(input.unitName, 500), scientificItemId, authorRaw);
    audit(database, workspaceId, actorPersonId, 'science.affiliation_updated', 'scientific_item', scientificItemId,
      { authorRaw, validOn, unitId: selectedUnit?.id || null, positionId: selectedPosition?.id || null, reason }, now);
  });
  return listScientificAuthorAffiliations(database, workspaceId, scientificItemId);
}
