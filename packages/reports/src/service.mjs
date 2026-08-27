import { newId } from '../../core/src/ids.mjs';
import {
  ensureAssignmentPlanMetrics,
  ensureReportFactExtraction
} from '../../plan-fact/src/service.mjs';
import { acceptOptionalEvidenceMatch } from '../../work-management/src/optional-evidence.mjs';
import { scoreReportCandidate } from './matcher.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function documentForMatching(database, workspaceId, documentVersionId) {
  return database.get(`
    SELECT dv.id AS version_id, dv.document_id, dv.extracted_text,
      dv.uploaded_at, d.title, d.document_type, d.status
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, documentVersionId);
}

function assignmentCandidates(database, workspaceId) {
  return database.all(`
    SELECT a.*, d.document_number, d.issued_at, d.title AS directive_title
    FROM assignments a
    LEFT JOIN directives d ON d.id = a.directive_id
    WHERE a.workspace_id = ?
      AND a.status NOT IN ('completed', 'cancelled')
    ORDER BY COALESCE(a.due_date, '9999-12-31'), a.created_at
    LIMIT 2000
  `, workspaceId).map((row) => ({
    ...row,
    executors: database.all(`
      SELECT ae.executor_raw AS raw, p.display_name AS displayName
      FROM assignment_executors ae
      LEFT JOIN people p ON p.id = ae.person_id
      WHERE ae.assignment_id = ? AND ae.role IN ('executor','coexecutor')
    `, row.id)
  }));
}

export function generateReportMatchCandidates(database, workspaceId, documentVersionId, now = new Date().toISOString()) {
  const document = documentForMatching(database, workspaceId, documentVersionId);
  if (!document?.extracted_text) return [];
  if (['directive', 'order', 'decree', 'department_protocol'].includes(document.document_type)) return [];

  ensureReportFactExtraction(database, workspaceId, documentVersionId, now);
  const reportDateMatch = String(document.extracted_text).match(/(?:от|дата\s*[:№]?)\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/iu);
  const date = reportDateMatch?.[1] || String(document.uploaded_at || '').slice(0, 10);

  database.transaction(() => {
    for (const assignment of assignmentCandidates(database, workspaceId)) {
      ensureAssignmentPlanMetrics(database, workspaceId, assignment.id, now);
      const result = scoreReportCandidate({
        document: { title: document.title, text: document.extracted_text, date },
        assignment: {
          title: assignment.title,
          instructionText: assignment.instruction_text,
          expectedResult: assignment.expected_result,
          documentNumber: assignment.document_number,
          dueDate: assignment.due_date,
          direction: assignment.direction,
          executors: assignment.executors
        }
      });
      if (result.score < 0.28) continue;
      const id = newId('reportmatch');
      database.run(`
        INSERT INTO report_match_candidates(
          id, workspace_id, assignment_id, document_version_id, score,
          reasons_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?)
        ON CONFLICT(assignment_id, document_version_id) DO UPDATE SET
          score = excluded.score,
          reasons_json = excluded.reasons_json,
          status = CASE
            WHEN report_match_candidates.status IN ('accepted','rejected') THEN report_match_candidates.status
            ELSE 'suggested'
          END
      `, id, workspaceId, assignment.id, documentVersionId,
      result.score, JSON.stringify(result.reasons), now);
    }
  });

  return listReportMatches(database, workspaceId, { documentVersionId, status: 'suggested' });
}

export function listReportMatches(database, workspaceId, filters = {}) {
  const clauses = ['rm.workspace_id = ?'];
  const params = [workspaceId];
  if (filters.documentVersionId) { clauses.push('rm.document_version_id = ?'); params.push(filters.documentVersionId); }
  if (filters.documentId) {
    clauses.push('dv.document_id = ?'); params.push(filters.documentId);
  }
  if (filters.assignmentId) { clauses.push('rm.assignment_id = ?'); params.push(filters.assignmentId); }
  if (filters.status) { clauses.push('rm.status = ?'); params.push(filters.status); }
  params.push(Math.min(500, Math.max(1, Number(filters.limit || 100))));
  return database.all(`
    SELECT rm.*, a.title AS assignment_title, a.instruction_text, a.due_date,
      a.status AS assignment_status, a.direction, d.document_number,
      doc.id AS document_id, doc.title AS document_title, dv.original_name,
      rfe.result_state, rfe.summary AS result_summary,
      rfe.progress_percent, rfe.metrics_json AS report_metrics_json,
      rfe.confidence AS report_confidence
    FROM report_match_candidates rm
    JOIN assignments a ON a.id = rm.assignment_id
    LEFT JOIN directives d ON d.id = a.directive_id
    JOIN document_versions dv ON dv.id = rm.document_version_id
    JOIN documents doc ON doc.id = dv.document_id
    LEFT JOIN report_fact_extractions rfe ON rfe.document_version_id = rm.document_version_id
      AND rfe.workspace_id = rm.workspace_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY rm.score DESC, rm.created_at DESC
    LIMIT ?
  `, ...params).map((row) => ({
    ...row,
    reasons: parseJson(row.reasons_json, []),
    reportMetrics: parseJson(row.report_metrics_json, [])
  }));
}

function candidate(database, workspaceId, matchId) {
  return database.get(`
    SELECT rm.*, dv.document_id, doc.title AS document_title
    FROM report_match_candidates rm
    JOIN document_versions dv ON dv.id = rm.document_version_id
    JOIN documents doc ON doc.id = dv.document_id
    WHERE rm.workspace_id = ? AND rm.id = ?
  `, workspaceId, matchId);
}

export function acceptReportMatch(database, workspaceId, matchId, body = {}, now = new Date().toISOString()) {
  const accepted = acceptOptionalEvidenceMatch(database, workspaceId, matchId, body, now);
  if (!accepted) return null;
  return {
    ...(listReportMatches(database, workspaceId, {
      assignmentId: accepted.assignment.id,
      status: 'accepted'
    })[0] || accepted.match),
    assignmentStatus: accepted.assignment.status,
    evidenceId: accepted.evidenceId,
    evidenceCreated: accepted.evidenceCreated,
    planFact: accepted.planFact
  };
}

export function rejectReportMatch(database, workspaceId, matchId, body = {}, now = new Date().toISOString()) {
  const match = candidate(database, workspaceId, matchId);
  if (!match) return null;
  database.run(`
    UPDATE report_match_candidates SET status = 'rejected', decided_at = ?, decided_by_person_id = ?
    WHERE workspace_id = ? AND id = ?
  `, now, body.personId || null, workspaceId, matchId);
  return { ...match, status: 'rejected', decided_at: now };
}

export function reviewAssignmentReport(database, workspaceId, assignmentId) {
  const assignment = database.get(
    'SELECT id FROM assignments WHERE workspace_id = ? AND id = ?',
    workspaceId,
    assignmentId
  );
  if (!assignment) return null;
  const error = new Error('report_review_removed');
  error.code = 'report_review_removed';
  throw error;
}
