import { newId } from '../../core/src/ids.mjs';

export const UNIT_KINDS = new Set(['organization', 'faculty', 'department', 'laboratory', 'section', 'other']);
export const APPOINTMENT_KINDS = new Set(['primary', 'additional']);
export const STATUSES = new Set(['active', 'inactive']);

export function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

export function text(value, max = 1000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

export function isoDate(value, field, { required = true, fallback = null } = {}) {
  const raw = String(value || fallback || '').slice(0, 10);
  if (!raw && !required) return null;
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw)) fail('organization_date_invalid', { field });
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('organization_date_invalid', { field });
  }
  return raw;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function previousDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function audit(database, workspaceId, actorPersonId, action, subjectKind, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action, subjectKind, subjectId,
  JSON.stringify(details || {}), now);
}

export function getPerson(database, workspaceId, personId) {
  if (!personId) return null;
  return database.get('SELECT * FROM people WHERE workspace_id = ? AND id = ?', workspaceId, personId) || null;
}

export function getUnit(database, workspaceId, unitId) {
  if (!unitId) return null;
  return database.get('SELECT * FROM organizational_units WHERE workspace_id = ? AND id = ?', workspaceId, unitId) || null;
}

export function getPosition(database, workspaceId, positionId) {
  if (!positionId) return null;
  return database.get('SELECT * FROM organization_positions WHERE workspace_id = ? AND id = ?', workspaceId, positionId) || null;
}

export function unitRow(database, workspaceId, unitId, asOf = today()) {
  const row = database.get(`
    SELECT ou.*, parent.name AS parent_name,
      (SELECT COUNT(*) FROM person_appointments pa
       WHERE pa.workspace_id = ou.workspace_id AND pa.unit_id = ou.id
         AND pa.valid_from <= ? AND (pa.valid_to IS NULL OR pa.valid_to >= ?)) AS appointment_count
    FROM organizational_units ou
    LEFT JOIN organizational_units parent ON parent.id = ou.parent_unit_id
    WHERE ou.workspace_id = ? AND ou.id = ?
  `, asOf, asOf, workspaceId, unitId);
  return row ? { ...row, evidence: parseJson(row.evidence_json) } : null;
}

export function positionRow(database, workspaceId, positionId) {
  const row = database.get(`
    SELECT op.*,
      (SELECT COUNT(*) FROM person_appointments pa
       WHERE pa.workspace_id = op.workspace_id AND pa.position_id = op.id
         AND pa.valid_from <= date('now') AND (pa.valid_to IS NULL OR pa.valid_to >= date('now'))) AS appointment_count
    FROM organization_positions op WHERE op.workspace_id = ? AND op.id = ?
  `, workspaceId, positionId);
  return row ? { ...row, evidence: parseJson(row.evidence_json) } : null;
}

export function appointmentRow(database, workspaceId, appointmentId) {
  const row = database.get(`
    SELECT pa.*, p.display_name AS person_name, ou.name AS unit_name,
      ou.short_name AS unit_short_name, op.name AS position_name,
      manager.display_name AS manager_name, dv.document_id AS source_document_id,
      dv.original_name AS source_document_name
    FROM person_appointments pa
    JOIN people p ON p.id = pa.person_id
    JOIN organizational_units ou ON ou.id = pa.unit_id
    LEFT JOIN organization_positions op ON op.id = pa.position_id
    LEFT JOIN people manager ON manager.id = pa.manager_person_id
    LEFT JOIN document_versions dv ON dv.id = pa.source_document_version_id
    WHERE pa.workspace_id = ? AND pa.id = ?
  `, workspaceId, appointmentId);
  return row ? { ...row, evidence: parseJson(row.evidence_json) } : null;
}

export function assertPeriod(validFrom, validTo) {
  if (validTo && validTo < validFrom) fail('organization_period_invalid');
}

export function assertInsideUnitPeriod(unit, validFrom, validTo) {
  if (!unit) fail('organization_unit_not_found');
  const end = validTo || '9999-12-31';
  const unitEnd = unit.valid_to || '9999-12-31';
  if (validFrom < unit.valid_from || end > unitEnd) {
    fail('organization_unit_period_mismatch', { unitId: unit.id, validFrom, validTo });
  }
}

export function normalizeCode(value) {
  return text(value, 80)?.toLocaleUpperCase('ru-RU') || null;
}
