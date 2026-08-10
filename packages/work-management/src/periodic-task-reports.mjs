import { newId } from '../../core/src/ids.mjs';
import { ensureReportFactExtraction } from '../../plan-fact/src/service.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function taskBase(database, workspaceId, taskId) {
  return database.get(`
    SELECT pt.*, owner.display_name AS owner_name, manager.display_name AS manager_name
    FROM periodic_tasks pt
    LEFT JOIN people owner ON owner.id = pt.owner_person_id
    LEFT JOIN people manager ON manager.id = pt.manager_person_id
    WHERE pt.workspace_id = ? AND pt.id = ?
  `, workspaceId, taskId) || null;
}

function reportRows(database, workspaceId, taskId) {
  return database.all(`
    SELECT pe.*, dv.document_id, dv.original_name, d.title AS document_title,
      rf.result_state, rf.summary AS extracted_summary, rf.progress_percent,
      rf.metrics_json, rf.evidence_json AS extracted_evidence_json, rf.confidence AS extraction_confidence
    FROM periodic_task_evidence pe
    JOIN document_versions dv ON dv.id = pe.document_version_id
    JOIN documents d ON d.id = dv.document_id AND d.workspace_id = ?
    LEFT JOIN report_fact_extractions rf
      ON rf.workspace_id = ? AND rf.document_version_id = pe.document_version_id
    WHERE pe.periodic_task_id = ?
    ORDER BY pe.created_at DESC, pe.id DESC
  `, workspaceId, workspaceId, taskId).map((row) => ({
    ...row,
    locator: parseJson(row.locator_json, {}),
    extractedMetrics: parseJson(row.metrics_json, []),
    extractedEvidence: parseJson(row.extracted_evidence_json, {})
  }));
}

export function getPeriodicTaskReports(database, workspaceId, taskId) {
  if (!taskBase(database, workspaceId, taskId)) return null;
  return reportRows(database, workspaceId, taskId);
}

function setTaskStatus(database, workspaceId, taskId, status, now) {
  const completedAt = status === 'completed' ? now : null;
  database.run(`
    UPDATE periodic_tasks
    SET status = ?, completed_at = ?, updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `, status, completedAt, now, workspaceId, taskId);
  database.run(`
    UPDATE calendar_items
    SET status = ?, completed_at = ?, revision = revision + 1, updated_at = ?
    WHERE workspace_id = ? AND source_kind = 'periodic_task' AND source_id = ?
  `, status, completedAt, now, workspaceId, taskId);
  const planStatus = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'confirmed';
  database.run(`
    UPDATE calendar_items
    SET status = ?, completed_at = ?, revision = revision + 1, updated_at = ?
    WHERE workspace_id = ? AND source_kind = 'periodic_task_plan' AND source_id = ?
  `, planStatus, status === 'completed' ? completedAt : null, now, workspaceId, taskId);
}

function audit(database, workspaceId, action, taskId, actorPersonId, details, now) {
  database.run(`
    INSERT INTO audit_log(
      id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, 'periodic_task', ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId ? `person:${actorPersonId}` : 'operator',
  action, taskId, JSON.stringify(details || {}), now);
}

export function attachPeriodicTaskReport(database, workspaceId, taskId, body, {
  actorPersonId = null,
  now = new Date().toISOString()
} = {}) {
  const task = taskBase(database, workspaceId, taskId);
  if (!task) return null;
  if (!body?.documentId) throw new Error('periodic_report_document_required');
  const version = database.get(`
    SELECT dv.id, dv.processing_status, d.id AS document_id, d.title
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, body.documentId);
  if (!version) throw new Error('periodic_report_document_not_found');
  if (!['processed', 'needs_review'].includes(version.processing_status)) {
    throw new Error('periodic_report_document_not_ready');
  }

  let evidenceId = null;
  database.transaction(() => {
    const existing = database.get(`
      SELECT id FROM periodic_task_evidence
      WHERE periodic_task_id = ? AND document_version_id = ? AND evidence_kind = 'report'
    `, taskId, version.id);
    if (existing) {
      evidenceId = existing.id;
      return;
    }
    evidenceId = newId('ptevidence');
    database.run(`
      INSERT INTO periodic_task_evidence(
        id, periodic_task_id, document_version_id, evidence_kind, note,
        locator_json, review_status, created_at
      ) VALUES (?, ?, ?, 'report', ?, ?, 'pending', ?)
    `, evidenceId, taskId, version.id, body.note || null, JSON.stringify(body.locator || {}), now);
    setTaskStatus(database, workspaceId, taskId, 'submitted', now);
    audit(database, workspaceId, 'periodic_task.report_attached', taskId, actorPersonId, {
      evidenceId,
      documentId: version.document_id,
      documentVersionId: version.id,
      note: body.note || null
    }, now);
  });

  ensureReportFactExtraction(database, workspaceId, version.id, now);
  return {
    task: taskBase(database, workspaceId, taskId),
    reports: reportRows(database, workspaceId, taskId),
    evidenceId
  };
}

export function reviewPeriodicTaskReport(database, workspaceId, taskId, body, {
  actorPersonId = null,
  now = new Date().toISOString()
} = {}) {
  const task = taskBase(database, workspaceId, taskId);
  if (!task) return null;
  if (!['approve', 'return'].includes(body?.action)) throw new Error('periodic_report_review_action_invalid');
  const evidence = body.evidenceId
    ? database.get(`
        SELECT * FROM periodic_task_evidence
        WHERE periodic_task_id = ? AND id = ?
      `, taskId, body.evidenceId)
    : database.get(`
        SELECT * FROM periodic_task_evidence
        WHERE periodic_task_id = ? AND evidence_kind = 'report' AND review_status = 'pending'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `, taskId);
  if (!evidence) throw new Error('periodic_report_evidence_missing');
  if (evidence.review_status !== 'pending') throw new Error('periodic_report_already_reviewed');

  const reviewStatus = body.action === 'approve' ? 'approved' : 'returned';
  const taskStatus = body.action === 'approve' ? 'completed' : 'rework';
  database.transaction(() => {
    database.run(`
      UPDATE periodic_task_evidence
      SET review_status = ?, reviewed_by_person_id = ?, reviewed_at = ?, review_note = ?
      WHERE id = ? AND periodic_task_id = ?
    `, reviewStatus, actorPersonId || null, now, body.note || null, evidence.id, taskId);
    setTaskStatus(database, workspaceId, taskId, taskStatus, now);
    audit(database, workspaceId,
      body.action === 'approve' ? 'periodic_task.report_approved' : 'periodic_task.report_returned',
      taskId, actorPersonId, {
        evidenceId: evidence.id,
        note: body.note || null,
        previousStatus: task.status,
        status: taskStatus
      }, now);
  });

  return {
    task: taskBase(database, workspaceId, taskId),
    reports: reportRows(database, workspaceId, taskId),
    evidenceId: evidence.id
  };
}
