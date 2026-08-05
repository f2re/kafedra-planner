import { newId } from '../../core/src/ids.mjs';
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

  const reportDateMatch = String(document.extracted_text).match(/(?:от|дата\s*[:№]?)\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/iu);
  const date = reportDateMatch?.[1] || String(document.uploaded_at || '').slice(0, 10);
  const candidates = [];

  database.transaction(() => {
    for (const assignment of assignmentCandidates(database, workspaceId)) {
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
      doc.id AS document_id, doc.title AS document_title, dv.original_name
    FROM report_match_candidates rm
    JOIN assignments a ON a.id = rm.assignment_id
    LEFT JOIN directives d ON d.id = a.directive_id
    JOIN document_versions dv ON dv.id = rm.document_version_id
    JOIN documents doc ON doc.id = dv.document_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY rm.score DESC, rm.created_at DESC
    LIMIT ?
  `, ...params).map((row) => ({ ...row, reasons: parseJson(row.reasons_json, []) }));
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
  const match = candidate(database, workspaceId, matchId);
  if (!match || match.status === 'rejected') return null;
  return database.transaction(() => {
    const existing = database.get(`
      SELECT id FROM assignment_evidence
      WHERE assignment_id = ? AND document_version_id = ? AND evidence_kind = 'report'
    `, match.assignment_id, match.document_version_id);
    if (!existing) {
      database.run(`
        INSERT INTO assignment_evidence(
          id, assignment_id, document_version_id, evidence_kind, note,
          locator_json, created_at, match_status, match_score,
          match_reasons_json, review_status
        ) VALUES (?, ?, ?, 'report', ?, '{}', ?, 'accepted', ?, ?, 'pending')
      `, newId('evidence'), match.assignment_id, match.document_version_id,
      body.note || `Автоматически сопоставлен отчёт «${match.document_title}»`, now,
      match.score, match.reasons_json);
    }
    database.run(`
      UPDATE report_match_candidates SET status = 'accepted', decided_at = ?, decided_by_person_id = ?
      WHERE id = ?
    `, now, body.personId || null, matchId);
    database.run(`
      UPDATE assignments SET status = 'submitted', updated_at = ? WHERE id = ?
    `, now, match.assignment_id);
    database.run(`
      INSERT INTO assignment_updates(id, assignment_id, actor_person_id, status, note, created_at)
      VALUES (?, ?, ?, 'submitted', ?, ?)
    `, newId('assignupd'), match.assignment_id, body.personId || null,
    body.note || `Отчёт «${match.document_title}» предложен системой и принят исполнителем.`, now);
    database.run(`
      UPDATE calendar_items SET status = 'submitted', revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND source_kind = 'assignment' AND source_id = ?
    `, now, workspaceId, match.assignment_id);
    return listReportMatches(database, workspaceId, { assignmentId: match.assignment_id, status: 'accepted' })[0] || match;
  });
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

export function reviewAssignmentReport(database, workspaceId, assignmentId, body = {}, now = new Date().toISOString()) {
  const action = body.action;
  if (!['approve', 'return'].includes(action)) throw new Error('report_review_action_invalid');
  const assignment = database.get('SELECT * FROM assignments WHERE workspace_id = ? AND id = ?', workspaceId, assignmentId);
  if (!assignment) return null;
  const evidence = database.get(`
    SELECT * FROM assignment_evidence
    WHERE assignment_id = ? AND evidence_kind = 'report' AND review_status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `, assignmentId);
  if (!evidence) throw new Error('report_evidence_missing');

  return database.transaction(() => {
    const approved = action === 'approve';
    const status = approved ? 'completed' : 'rework';
    database.run(`
      UPDATE assignment_evidence SET review_status = ?, reviewed_by_person_id = ?,
        reviewed_at = ?, review_note = ? WHERE id = ?
    `, approved ? 'approved' : 'returned', body.personId || null, now, body.note || null, evidence.id);
    database.run(`
      UPDATE assignments SET status = ?, completed_at = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, status, approved ? now : null, now, workspaceId, assignmentId);
    database.run(`
      INSERT INTO assignment_updates(id, assignment_id, actor_person_id, status, progress_percent, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, newId('assignupd'), assignmentId, body.personId || null, status,
    approved ? 100 : null, body.note || (approved ? 'Результат подтверждён руководителем.' : 'Отчёт возвращён на доработку.'), now);
    database.run(`
      UPDATE calendar_items SET status = ?, completed_at = ?, revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND source_kind = 'assignment' AND source_id = ?
    `, approved ? 'completed' : 'open', approved ? now : null, now, workspaceId, assignmentId);
    return {
      assignmentId,
      status,
      evidenceId: evidence.id,
      reviewStatus: approved ? 'approved' : 'returned',
      reviewedAt: now
    };
  });
}
