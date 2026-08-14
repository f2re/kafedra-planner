import { newId } from '../../core/src/ids.mjs';

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function required(value, code) {
  const text = clean(value);
  if (!text) fail(code);
  return text;
}

export function dateValue(value) {
  const text = required(value, 'meeting_date_required');
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/u);
  if (!match) fail('meeting_date_invalid');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) fail('meeting_date_invalid');
  return text;
}

export function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) fail(code);
  return number;
}

export function writeAudit(database, workspaceId, actorPersonId, action, subjectKind, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(
      id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action,
  subjectKind, subjectId, JSON.stringify(details || {}), now);
}

export function activePerson(database, workspaceId, personId) {
  if (!personId) return null;
  return database.get(`
    SELECT id, display_name, email, position
    FROM people
    WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, personId) || null;
}

export function templateVersion(database, workspaceId, versionId) {
  if (!versionId) return null;
  return database.get(`
    SELECT dv.id AS version_id, dv.document_id, dv.original_name, dv.detected_format,
      dv.blob_sha256, fb.storage_path, d.title, d.document_type, d.status
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, versionId) || null;
}

export function assertDocxTemplate(database, workspaceId, versionId) {
  const row = templateVersion(database, workspaceId, versionId);
  if (!row) fail('meeting_template_not_found');
  if (row.detected_format !== 'docx' && !String(row.original_name || '').toLowerCase().endsWith('.docx')) {
    fail('meeting_template_must_be_docx');
  }
  return row;
}
