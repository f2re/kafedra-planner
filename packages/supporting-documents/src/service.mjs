import { newId } from '../../core/src/ids.mjs';

const TARGET_TABLES = {
  document: ['documents', 'id', 'workspace_id'],
  plan_item: ['plan_items', 'id', null],
  assignment: ['assignments', 'id', 'workspace_id'],
  scientific_item: ['scientific_items', 'id', 'workspace_id'],
  meeting: ['meetings', 'id', 'workspace_id']
};
const RELATIONS = new Set(['evidence', 'basis', 'publication', 'completion', 'reference']);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function date(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(raw)) fail('supporting_document_date_invalid');
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) fail('supporting_document_date_invalid');
  return raw;
}

function optional(value, max = 12000) {
  const raw = String(value ?? '').trim();
  return raw ? raw.slice(0, max) : null;
}

function fileVersion(database, workspaceId, input) {
  if (input.documentVersionId) {
    return database.get(`
      SELECT dv.id, dv.document_id, dv.original_name, d.title
      FROM document_versions dv JOIN documents d ON d.id = dv.document_id
      WHERE d.workspace_id = ? AND dv.id = ?
    `, workspaceId, input.documentVersionId) || fail('supporting_document_file_not_found');
  }
  if (input.documentId) {
    return database.get(`
      SELECT dv.id, dv.document_id, dv.original_name, d.title
      FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
      WHERE d.workspace_id = ? AND d.id = ?
    `, workspaceId, input.documentId) || fail('supporting_document_file_not_found');
  }
  return null;
}

function targetExists(database, workspaceId, targetKind, targetId) {
  if (targetKind === 'plan_item') {
    return Boolean(database.get(`
      SELECT pi.id FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
      WHERE p.workspace_id = ? AND pi.id = ?
    `, workspaceId, targetId));
  }
  const spec = TARGET_TABLES[targetKind];
  if (!spec) return false;
  const [table, idColumn, workspaceColumn] = spec;
  return Boolean(database.get(
    `SELECT ${idColumn} AS id FROM ${table} WHERE ${workspaceColumn} = ? AND ${idColumn} = ?`, workspaceId, targetId
  ));
}

function audit(database, workspaceId, actorPersonId, action, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, 'supporting_document', ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action, subjectId, JSON.stringify(details || {}), now);
}

function row(database, workspaceId, id) {
  const item = database.get(`
    SELECT sd.*, dv.document_id, dv.original_name, d.title AS document_title
    FROM supporting_documents sd
    LEFT JOIN document_versions dv ON dv.id = sd.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE sd.workspace_id = ? AND sd.id = ?
  `, workspaceId, id);
  if (!item) return null;
  return {
    ...item,
    links: database.all(`
      SELECT * FROM supporting_document_links
      WHERE workspace_id = ? AND supporting_document_id = ? ORDER BY created_at
    `, workspaceId, id)
  };
}

export function getSupportingDocument(database, workspaceId, id) {
  return row(database, workspaceId, id);
}

export function listSupportingDocuments(database, workspaceId, { targetKind, targetId, includeDeleted = false, limit = 300 } = {}) {
  const params = [workspaceId];
  const clauses = ['sd.workspace_id = ?'];
  let join = '';
  if (!includeDeleted) clauses.push("sd.status = 'active'");
  if (targetKind || targetId) {
    if (!targetKind || !targetId || !TARGET_TABLES[targetKind]) fail('supporting_document_target_invalid');
    join = 'JOIN supporting_document_links l ON l.supporting_document_id = sd.id';
    clauses.push('l.workspace_id = ?', 'l.target_kind = ?', 'l.target_id = ?');
    params.push(workspaceId, targetKind, targetId);
  }
  params.push(Math.max(1, Math.min(1000, Number(limit) || 300)));
  return database.all(`
    SELECT DISTINCT sd.*, dv.document_id, dv.original_name, d.title AS document_title
    FROM supporting_documents sd
    ${join}
    LEFT JOIN document_versions dv ON dv.id = sd.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY sd.document_date DESC, sd.document_number, sd.created_at DESC LIMIT ?
  `, ...params).map((item) => ({
    ...item,
    links: database.all(`
      SELECT * FROM supporting_document_links
      WHERE workspace_id = ? AND supporting_document_id = ? ORDER BY created_at
    `, workspaceId, item.id)
  }));
}

export function linkSupportingDocument(database, workspaceId, supportingDocumentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const support = row(database, workspaceId, supportingDocumentId);
  if (!support || support.status !== 'active') fail('supporting_document_not_found');
  const targetKind = String(input.targetKind || '');
  const targetId = String(input.targetId || '').trim();
  const relationKind = RELATIONS.has(input.relationKind) ? input.relationKind : 'evidence';
  if (!TARGET_TABLES[targetKind] || !targetId || !targetExists(database, workspaceId, targetKind, targetId)) {
    fail('supporting_document_target_not_found', { targetKind, targetId });
  }
  const id = newId('supportlink');
  database.run(`
    INSERT INTO supporting_document_links(
      id, supporting_document_id, workspace_id, target_kind, target_id,
      relation_kind, note, created_by_person_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supporting_document_id, target_kind, target_id, relation_kind) DO UPDATE SET
      note = COALESCE(excluded.note, supporting_document_links.note)
  `, id, supportingDocumentId, workspaceId, targetKind, targetId, relationKind,
  optional(input.note, 4000), actorPersonId, now);
  audit(database, workspaceId, actorPersonId, 'supporting_document.linked', supportingDocumentId,
    { targetKind, targetId, relationKind }, now);
  return row(database, workspaceId, supportingDocumentId);
}

export function createSupportingDocument(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const number = optional(input.documentNumber || input.number, 300);
  if (!number) fail('supporting_document_number_required');
  const documentDate = date(input.documentDate || input.date);
  const file = fileVersion(database, workspaceId, input);
  const id = newId('supportdoc');
  database.transaction(() => {
    database.run(`
      INSERT INTO supporting_documents(
        id, workspace_id, document_number, document_date, title, note,
        document_version_id, status, created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `, id, workspaceId, number, documentDate, optional(input.title, 1000), optional(input.note),
    file?.id || null, actorPersonId, now, now);
    audit(database, workspaceId, actorPersonId, 'supporting_document.created', id, {
      documentNumber: number, documentDate, documentVersionId: file?.id || null
    }, now);
    if (input.targetKind && input.targetId) {
      linkSupportingDocument(database, workspaceId, id, input, actorPersonId, now);
    }
  });
  return row(database, workspaceId, id);
}

export function unlinkSupportingDocument(database, workspaceId, supportingDocumentId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const support = row(database, workspaceId, supportingDocumentId);
  if (!support) fail('supporting_document_not_found');
  const relationKind = RELATIONS.has(input.relationKind) ? input.relationKind : 'evidence';
  const result = database.run(`
    DELETE FROM supporting_document_links
    WHERE workspace_id = ? AND supporting_document_id = ? AND target_kind = ? AND target_id = ? AND relation_kind = ?
  `, workspaceId, supportingDocumentId, input.targetKind, input.targetId, relationKind);
  audit(database, workspaceId, actorPersonId, 'supporting_document.unlinked', supportingDocumentId, {
    targetKind: input.targetKind, targetId: input.targetId, relationKind, changed: Number(result.changes || 0)
  }, now);
  return row(database, workspaceId, supportingDocumentId);
}

export function deleteSupportingDocument(database, workspaceId, supportingDocumentId, actorPersonId = null, now = new Date().toISOString()) {
  const support = row(database, workspaceId, supportingDocumentId);
  if (!support) fail('supporting_document_not_found');
  if (support.status !== 'deleted') {
    database.run(`
      UPDATE supporting_documents
      SET status = 'deleted', deleted_by_person_id = ?, deleted_at = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, actorPersonId, now, now, workspaceId, supportingDocumentId);
    audit(database, workspaceId, actorPersonId, 'supporting_document.deleted', supportingDocumentId, {
      preservedDocumentVersionId: support.document_version_id || null,
      preservedLinks: support.links.length
    }, now);
  }
  return row(database, workspaceId, supportingDocumentId);
}
