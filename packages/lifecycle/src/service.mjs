import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';

function value(value, maximum = 500) {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, maximum) : null;
}

function requiredTitle(value) {
  const title = value(value, 500);
  if (!title) throw new AppError('lifecycle_title_required', 'Укажите понятное название.', 400);
  return title;
}

function normalizedDocumentType(input) {
  const type = value(input, 80);
  if (!type) return null;
  if (!/^[a-z][a-z0-9_]*$/u.test(type)) {
    throw new AppError('document_type_invalid', 'Выберите допустимый вид документа.', 400);
  }
  return type;
}

function audit(database, workspaceId, actorPersonId, action, subjectKind, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(
      id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action,
  subjectKind, subjectId, JSON.stringify(details || {}), now);
}

function documentRow(database, workspaceId, documentId) {
  return database.get(`
    SELECT d.*, replacement.title AS replacement_title
    FROM documents d
    LEFT JOIN documents replacement ON replacement.id = d.replacement_document_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId) || null;
}

function planRow(database, workspaceId, planId) {
  return database.get(`
    SELECT p.*, replacement.title AS replacement_title
    FROM plans p
    LEFT JOIN plans replacement ON replacement.id = p.replacement_plan_id
    WHERE p.workspace_id = ? AND p.id = ?
  `, workspaceId, planId) || null;
}

function ensureDocument(database, workspaceId, documentId) {
  const item = documentRow(database, workspaceId, documentId);
  if (!item) throw new AppError('document_not_found', 'Документ не найден.', 404);
  return item;
}

function ensurePlan(database, workspaceId, planId) {
  const item = planRow(database, workspaceId, planId);
  if (!item) throw new AppError('plan_not_found', 'План не найден.', 404);
  return item;
}

function validateDocumentReplacement(database, workspaceId, documentId, replacementId) {
  if (!replacementId) return null;
  if (replacementId === documentId) {
    throw new AppError('replacement_self_reference', 'Нельзя указать объект заменой самому себе.', 409);
  }
  const replacement = documentRow(database, workspaceId, replacementId);
  if (!replacement) {
    throw new AppError('replacement_document_not_found', 'Заменяющий документ не найден в этом рабочем пространстве.', 404);
  }
  if ((replacement.lifecycle_status || 'active') !== 'active') {
    throw new AppError('replacement_document_archived', 'Заменяющий документ должен находиться в работе.', 409);
  }
  const visited = new Set([documentId]);
  let cursor = replacement;
  while (cursor?.replacement_document_id) {
    if (visited.has(cursor.replacement_document_id)) {
      throw new AppError('replacement_cycle', 'Получается замкнутая цепочка замен. Выберите другой документ.', 409);
    }
    visited.add(cursor.replacement_document_id);
    cursor = documentRow(database, workspaceId, cursor.replacement_document_id);
  }
  return replacement;
}

function validatePlanReplacement(database, workspaceId, planId, replacementId) {
  if (!replacementId) return null;
  if (replacementId === planId) {
    throw new AppError('replacement_self_reference', 'Нельзя указать объект заменой самому себе.', 409);
  }
  const replacement = planRow(database, workspaceId, replacementId);
  if (!replacement) {
    throw new AppError('replacement_plan_not_found', 'Заменяющий план не найден в этом рабочем пространстве.', 404);
  }
  if (replacement.status !== 'active') {
    throw new AppError('replacement_plan_archived', 'Заменяющий план должен находиться в работе.', 409);
  }
  const visited = new Set([planId]);
  let cursor = replacement;
  while (cursor?.replacement_plan_id) {
    if (visited.has(cursor.replacement_plan_id)) {
      throw new AppError('replacement_cycle', 'Получается замкнутая цепочка замен. Выберите другой план.', 409);
    }
    visited.add(cursor.replacement_plan_id);
    cursor = planRow(database, workspaceId, cursor.replacement_plan_id);
  }
  return replacement;
}

function count(database, sql, ...params) {
  return Number(database.get(sql, ...params)?.count || 0);
}

export function documentImpact(database, workspaceId, documentId) {
  const document = ensureDocument(database, workspaceId, documentId);
  const versionScope = `SELECT id FROM document_versions WHERE document_id = ?`;
  const planScope = `SELECT id FROM plans WHERE source_document_version_id IN (${versionScope})`;
  const itemScope = `SELECT id FROM plan_items WHERE plan_id IN (${planScope})`;
  const assignmentScope = `SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id IN (${itemScope})`;
  const directiveScope = `SELECT id FROM directives WHERE source_document_version_id IN (${versionScope})`;
  const meetingScope = `SELECT id FROM meetings WHERE source_document_version_id IN (${versionScope})`;
  return {
    document: { id: document.id, title: document.title },
    versions: count(database, 'SELECT COUNT(*) AS count FROM document_versions WHERE document_id = ?', documentId),
    plans: count(database, `SELECT COUNT(*) AS count FROM plans WHERE source_document_version_id IN (${versionScope})`, documentId),
    planItems: count(database, `SELECT COUNT(*) AS count FROM plan_items WHERE plan_id IN (${planScope})`, documentId),
    calendarItems: count(database, `SELECT COUNT(*) AS count FROM calendar_items WHERE source_kind = 'plan_item' AND source_id IN (${itemScope})`, documentId),
    assignments: count(database, `SELECT COUNT(*) AS count FROM assignments WHERE id IN (${assignmentScope})`, documentId),
    activeAssignments: count(database, `SELECT COUNT(*) AS count FROM assignments WHERE id IN (${assignmentScope}) AND status NOT IN ('completed','cancelled')`, documentId),
    directives: count(database, `SELECT COUNT(*) AS count FROM directives WHERE source_document_version_id IN (${versionScope})`, documentId),
    directiveAssignments: count(database, `SELECT COUNT(*) AS count FROM assignments WHERE directive_id IN (${directiveScope})`, documentId),
    meetings: count(database, `SELECT COUNT(*) AS count FROM meetings WHERE source_document_version_id IN (${versionScope})`, documentId),
    decisions: count(database, `SELECT COUNT(*) AS count FROM decisions WHERE agenda_item_id IN (SELECT id FROM agenda_items WHERE meeting_id IN (${meetingScope}))`, documentId),
    extractionTemplates: count(database, `SELECT COUNT(*) AS count FROM document_templates WHERE source_document_version_id IN (${versionScope})`, documentId),
    planTemplates: count(database, `SELECT COUNT(*) AS count FROM plan_document_templates WHERE source_document_version_id IN (${versionScope})`, documentId),
    assignmentReports: count(database, `SELECT COUNT(*) AS count FROM assignment_evidence WHERE document_version_id IN (${versionScope})`, documentId),
    scientificRecords: count(database, `SELECT COUNT(DISTINCT scientific_item_id) AS count FROM scientific_item_evidence WHERE document_version_id IN (${versionScope})`, documentId)
      + count(database, `SELECT COUNT(*) AS count FROM scientific_items WHERE source_document_version_id IN (${versionScope})`, documentId),
    supportingDocuments: count(database, `SELECT COUNT(*) AS count FROM supporting_documents WHERE document_version_id IN (${versionScope})`, documentId),
    generatedPlans: count(database, 'SELECT COUNT(*) AS count FROM plan_generation_runs WHERE generated_document_id = ?', documentId)
  };
}

export function planImpact(database, workspaceId, planId) {
  const plan = ensurePlan(database, workspaceId, planId);
  const itemScope = 'SELECT id FROM plan_items WHERE plan_id = ?';
  const assignmentScope = `SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id IN (${itemScope})`;
  return {
    plan: { id: plan.id, title: plan.title },
    items: count(database, 'SELECT COUNT(*) AS count FROM plan_items WHERE plan_id = ?', planId),
    completedItems: count(database, "SELECT COUNT(*) AS count FROM plan_items WHERE plan_id = ? AND status = 'completed'", planId),
    calendarItems: count(database, `SELECT COUNT(*) AS count FROM calendar_items WHERE source_kind = 'plan_item' AND source_id IN (${itemScope})`, planId),
    assignments: count(database, `SELECT COUNT(*) AS count FROM assignments WHERE id IN (${assignmentScope})`, planId),
    activeAssignments: count(database, `SELECT COUNT(*) AS count FROM assignments WHERE id IN (${assignmentScope}) AND status NOT IN ('completed','cancelled')`, planId),
    supportingDocuments: count(database, `SELECT COUNT(*) AS count FROM supporting_document_links WHERE target_kind = 'plan_item' AND target_id IN (${itemScope})`, planId),
    agendaItems: count(database, `SELECT COUNT(*) AS count FROM agenda_items WHERE source_kind = 'plan_item' AND source_id IN (${itemScope})`, planId)
  };
}

export function updateDocumentMetadata(database, workspaceId, documentId, body, actorPersonId = null, now = new Date().toISOString()) {
  const current = ensureDocument(database, workspaceId, documentId);
  const title = Object.prototype.hasOwnProperty.call(body, 'title') ? requiredTitle(body.title) : current.title;
  const documentType = Object.prototype.hasOwnProperty.call(body, 'documentType')
    ? normalizedDocumentType(body.documentType) : current.document_type;
  if (title === current.title && documentType === current.document_type) return current;
  database.transaction(() => {
    database.run(`
      UPDATE documents SET title = ?, document_type = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, title, documentType || 'unknown', now, workspaceId, documentId);
    audit(database, workspaceId, actorPersonId, 'document.metadata_updated', 'document', documentId, {
      before: { title: current.title, documentType: current.document_type },
      after: { title, documentType: documentType || 'unknown' }
    }, now);
  });
  return documentRow(database, workspaceId, documentId);
}

export function updatePlanMetadata(database, workspaceId, planId, body, actorPersonId = null, now = new Date().toISOString()) {
  const current = ensurePlan(database, workspaceId, planId);
  const title = Object.prototype.hasOwnProperty.call(body, 'title') ? requiredTitle(body.title) : current.title;
  if (title === current.title) return current;
  database.transaction(() => {
    database.run('UPDATE plans SET title = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
      title, now, workspaceId, planId);
    audit(database, workspaceId, actorPersonId, 'plan.metadata_updated', 'plan', planId, {
      before: { title: current.title }, after: { title }
    }, now);
  });
  return planRow(database, workspaceId, planId);
}

export function archiveDocument(database, workspaceId, documentId, body = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = ensureDocument(database, workspaceId, documentId);
  const replacementId = value(body.replacementDocumentId, 120);
  const replacement = validateDocumentReplacement(database, workspaceId, documentId, replacementId);
  const reason = value(body.reason, 1000);
  if ((current.lifecycle_status || 'active') === 'archived'
      && (current.replacement_document_id || null) === (replacement?.id || null)
      && (current.archive_reason || null) === reason) return current;
  database.transaction(() => {
    database.run(`
      UPDATE documents
      SET lifecycle_status = 'archived', archived_at = ?, archived_by_person_id = ?,
        archive_reason = ?, replacement_document_id = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, now, actorPersonId || null, reason, replacement?.id || null, now, workspaceId, documentId);
    audit(database, workspaceId, actorPersonId, 'document.archived', 'document', documentId, {
      reason, replacementDocumentId: replacement?.id || null, impact: documentImpact(database, workspaceId, documentId)
    }, now);
  });
  return documentRow(database, workspaceId, documentId);
}

export function restoreDocument(database, workspaceId, documentId, actorPersonId = null, now = new Date().toISOString()) {
  const current = ensureDocument(database, workspaceId, documentId);
  if ((current.lifecycle_status || 'active') === 'active' && !current.replacement_document_id) return current;
  database.transaction(() => {
    database.run(`
      UPDATE documents
      SET lifecycle_status = 'active', archived_at = NULL, archived_by_person_id = NULL,
        archive_reason = NULL, replacement_document_id = NULL, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, now, workspaceId, documentId);
    audit(database, workspaceId, actorPersonId, 'document.restored', 'document', documentId, {
      previousReplacementDocumentId: current.replacement_document_id || null
    }, now);
  });
  return documentRow(database, workspaceId, documentId);
}

export function archivePlan(database, workspaceId, planId, body = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = ensurePlan(database, workspaceId, planId);
  const replacementId = value(body.replacementPlanId, 120);
  const replacement = validatePlanReplacement(database, workspaceId, planId, replacementId);
  const reason = value(body.reason, 1000);
  if (current.status === 'archived'
      && (current.replacement_plan_id || null) === (replacement?.id || null)
      && (current.archive_reason || null) === reason) return current;
  database.transaction(() => {
    database.run(`
      UPDATE plans
      SET status = 'archived', archived_at = ?, archived_by_person_id = ?,
        archive_reason = ?, replacement_plan_id = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, now, actorPersonId || null, reason, replacement?.id || null, now, workspaceId, planId);
    audit(database, workspaceId, actorPersonId, 'plan.archived', 'plan', planId, {
      reason, replacementPlanId: replacement?.id || null, impact: planImpact(database, workspaceId, planId)
    }, now);
  });
  return planRow(database, workspaceId, planId);
}

export function restorePlan(database, workspaceId, planId, actorPersonId = null, now = new Date().toISOString()) {
  const current = ensurePlan(database, workspaceId, planId);
  if (current.status === 'active' && !current.replacement_plan_id) return current;
  database.transaction(() => {
    database.run(`
      UPDATE plans
      SET status = 'active', archived_at = NULL, archived_by_person_id = NULL,
        archive_reason = NULL, replacement_plan_id = NULL, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, now, workspaceId, planId);
    audit(database, workspaceId, actorPersonId, 'plan.restored', 'plan', planId, {
      previousReplacementPlanId: current.replacement_plan_id || null
    }, now);
  });
  return planRow(database, workspaceId, planId);
}
