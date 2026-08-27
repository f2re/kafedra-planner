import { newId } from '../../core/src/ids.mjs';
import {
  applyReportFactsToAssignment,
  ensureReportFactExtraction,
  getAssignmentPlanFact
} from '../../plan-fact/src/service.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function assignmentDetails(database, workspaceId, assignmentId) {
  const row = database.get(`
    SELECT a.*, d.document_number, d.issued_at, d.directive_kind,
      d.title AS directive_title, dv.document_id AS source_document_id
    FROM assignments a
    LEFT JOIN directives d ON d.id = a.directive_id
    LEFT JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, assignmentId);
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidence_json, {}),
    executors: database.all(`
      SELECT ae.*, p.display_name, p.email, p.manager_id
      FROM assignment_executors ae
      LEFT JOIN people p ON p.id = ae.person_id
      WHERE ae.assignment_id = ?
      ORDER BY CASE ae.role WHEN 'executor' THEN 1 WHEN 'coexecutor' THEN 2 WHEN 'controller' THEN 3 ELSE 4 END,
        ae.executor_raw
    `, assignmentId),
    reports: database.all(`
      SELECT ae.*, d.id AS document_id, d.title AS document_title, dv.original_name
      FROM assignment_evidence ae
      LEFT JOIN document_versions dv ON dv.id = ae.document_version_id
      LEFT JOIN documents d ON d.id = dv.document_id
      WHERE ae.assignment_id = ?
      ORDER BY ae.created_at DESC
    `, assignmentId).map((item) => ({ ...item, locator: parseJson(item.locator_json, {}) })),
    updates: database.all(`
      SELECT au.*, p.display_name AS actor_name
      FROM assignment_updates au
      LEFT JOIN people p ON p.id = au.actor_person_id
      WHERE au.assignment_id = ?
      ORDER BY au.created_at DESC
    `, assignmentId)
  };
}

function currentDocumentVersion(database, workspaceId, documentId) {
  return database.get(`
    SELECT dv.id, d.id AS document_id, d.title
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
}

function attachVersion(database, workspaceId, assignment, input, now) {
  let evidence = database.get(`
    SELECT * FROM assignment_evidence
    WHERE assignment_id = ? AND document_version_id = ? AND evidence_kind = 'report'
    ORDER BY created_at DESC LIMIT 1
  `, assignment.id, input.documentVersionId);
  let created = false;

  if (!evidence) {
    const evidenceId = newId('evidence');
    database.run(`
      INSERT INTO assignment_evidence(
        id, assignment_id, document_version_id, evidence_kind, note,
        locator_json, created_at, match_status, match_score,
        match_reasons_json, review_status
      ) VALUES (?, ?, ?, 'report', ?, ?, ?, ?, ?, ?, 'not_required')
    `, evidenceId, assignment.id, input.documentVersionId,
    input.note || null, JSON.stringify(input.locator || {}), now,
    input.matchStatus || 'attached', input.matchScore ?? null,
    JSON.stringify(input.matchReasons || {}));
    evidence = database.get('SELECT * FROM assignment_evidence WHERE id = ?', evidenceId);
    created = true;
  } else if (evidence.review_status === 'pending') {
    database.run(`
      UPDATE assignment_evidence
      SET review_status = 'not_required',
        match_status = CASE WHEN ? = 'accepted' THEN 'accepted' ELSE match_status END,
        match_score = COALESCE(?, match_score),
        match_reasons_json = CASE WHEN ? IS NOT NULL THEN ? ELSE match_reasons_json END
      WHERE id = ?
    `, input.matchStatus || null, input.matchScore ?? null,
    input.matchReasons ? 1 : null, JSON.stringify(input.matchReasons || {}), evidence.id);
    evidence = database.get('SELECT * FROM assignment_evidence WHERE id = ?', evidence.id);
  }

  const extraction = ensureReportFactExtraction(database, workspaceId, input.documentVersionId, now);
  if (extraction) {
    applyReportFactsToAssignment(database, workspaceId, assignment.id, evidence.id, extraction, now);
  }

  if (created) {
    const planFact = getAssignmentPlanFact(database, workspaceId, assignment.id, { ensure: false, now });
    database.run(`
      INSERT INTO assignment_updates(
        id, assignment_id, actor_person_id, status, progress_percent, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, newId('assignupd'), assignment.id, input.actorPersonId || null,
    assignment.status, planFact?.progressPercent ?? null,
    input.note || `Приложен подтверждающий материал «${input.documentTitle || 'Документ'}».`, now);
  }

  return {
    evidence,
    created,
    planFact: getAssignmentPlanFact(database, workspaceId, assignment.id, { ensure: false, now })
  };
}

export function attachOptionalAssignmentEvidence(
  database,
  workspaceId,
  assignmentId,
  body = {},
  now = new Date().toISOString()
) {
  const assignment = assignmentDetails(database, workspaceId, assignmentId);
  if (!assignment) return null;
  const version = currentDocumentVersion(database, workspaceId, body.documentId);
  if (!version) return null;

  return database.transaction(() => {
    const result = attachVersion(database, workspaceId, assignment, {
      documentVersionId: version.id,
      documentTitle: version.title,
      note: body.note || null,
      locator: body.locator || {},
      actorPersonId: body.actorPersonId || null,
      matchStatus: 'attached'
    }, now);
    return {
      ...assignmentDetails(database, workspaceId, assignmentId),
      attachedEvidenceId: result.evidence.id,
      evidenceCreated: result.created,
      planFact: result.planFact
    };
  });
}

export function acceptOptionalEvidenceMatch(
  database,
  workspaceId,
  matchId,
  body = {},
  now = new Date().toISOString()
) {
  const match = database.get(`
    SELECT rm.*, dv.document_id, doc.title AS document_title
    FROM report_match_candidates rm
    JOIN document_versions dv ON dv.id = rm.document_version_id
    JOIN documents doc ON doc.id = dv.document_id
    WHERE rm.workspace_id = ? AND rm.id = ?
  `, workspaceId, matchId);
  if (!match || match.status === 'rejected') return null;
  const assignment = assignmentDetails(database, workspaceId, match.assignment_id);
  if (!assignment) return null;

  return database.transaction(() => {
    const result = attachVersion(database, workspaceId, assignment, {
      documentVersionId: match.document_version_id,
      documentTitle: match.document_title,
      note: body.note || `Материал «${match.document_title}» связан системой с задачей.`,
      actorPersonId: body.personId || body.actorPersonId || null,
      matchStatus: 'accepted',
      matchScore: match.score,
      matchReasons: parseJson(match.reasons_json, [])
    }, now);
    database.run(`
      UPDATE report_match_candidates
      SET status = 'accepted', decided_at = ?, decided_by_person_id = ?
      WHERE workspace_id = ? AND id = ?
    `, now, body.personId || body.actorPersonId || null, workspaceId, matchId);
    return {
      match: { ...match, status: 'accepted', decided_at: now },
      assignment: assignmentDetails(database, workspaceId, assignment.id),
      evidenceId: result.evidence.id,
      evidenceCreated: result.created,
      planFact: result.planFact
    };
  });
}
