import { newId } from '../../core/src/ids.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function getTemplateDraft(database, workspaceId, documentVersionId) {
  const row = database.get(`
    SELECT * FROM template_drafts
    WHERE workspace_id = ? AND document_version_id = ?
  `, workspaceId, documentVersionId);
  if (!row) return null;
  return { ...row, payload: parseJson(row.payload_json, {}) };
}

export function saveTemplateDraft(database, workspaceId, {
  documentVersionId,
  payload,
  step = 1
}, now = new Date().toISOString()) {
  const version = database.get(`
    SELECT dv.id
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE dv.id = ? AND d.workspace_id = ?
  `, documentVersionId, workspaceId);
  if (!version) return null;
  const safeStep = Math.max(1, Math.min(3, Number(step) || 1));
  const existing = database.get(`
    SELECT id, created_at FROM template_drafts
    WHERE workspace_id = ? AND document_version_id = ?
  `, workspaceId, documentVersionId);
  const id = existing?.id || newId('template_draft');
  database.run(`
    INSERT INTO template_drafts(
      id, workspace_id, document_version_id, payload_json, step, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, document_version_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      step = excluded.step,
      updated_at = excluded.updated_at
  `, id, workspaceId, documentVersionId, JSON.stringify(payload || {}),
  safeStep, existing?.created_at || now, now);
  return getTemplateDraft(database, workspaceId, documentVersionId);
}

export function deleteTemplateDraft(database, workspaceId, documentVersionId) {
  const result = database.run(`
    DELETE FROM template_drafts
    WHERE workspace_id = ? AND document_version_id = ?
  `, workspaceId, documentVersionId);
  return Number(result.changes || 0) > 0;
}
