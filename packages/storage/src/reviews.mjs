import { newId } from '../../core/src/ids.mjs';

export function listReviewItems(database, workspaceId, status = 'open', limit = 200) {
  const actualStatus = (typeof status === 'object' && status !== null) ? (status.status || 'open') : (status || 'open');
  const actualLimit = (typeof status === 'object' && status !== null) ? (status.limit || limit || 200) : (limit || 200);
  return database.all(`
    SELECT r.*,
      CASE
        WHEN r.source_kind = 'document_version' THEN (
          SELECT d.id FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE dv.id = r.source_id
        )
        WHEN r.source_kind = 'meeting' THEN (
          SELECT d.id FROM meetings m JOIN document_versions dv ON dv.id = m.source_document_version_id JOIN documents d ON d.id = dv.document_id WHERE m.id = r.source_id
        )
        ELSE NULL
      END AS document_id,
      CASE
        WHEN r.source_kind = 'document_version' THEN (
          SELECT COALESCE(dv.original_name, d.title) FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE dv.id = r.source_id
        )
        WHEN r.source_kind = 'meeting' THEN (
          SELECT COALESCE(m.title, 'Заседание кафедры') FROM meetings m WHERE m.id = r.source_id
        )
        ELSE NULL
      END AS document_name,
      CASE
        WHEN r.source_kind = 'document_version' THEN (
          SELECT substr(dv.extracted_text, 1, 1500) FROM document_versions dv WHERE dv.id = r.source_id
        )
        WHEN r.source_kind = 'meeting' THEN (
          SELECT substr(dv.extracted_text, 1, 1500) FROM meetings m JOIN document_versions dv ON dv.id = m.source_document_version_id WHERE m.id = r.source_id
        )
        ELSE NULL
      END AS source_excerpt,
      CASE
        WHEN r.source_kind = 'document_version' THEN (
          SELECT dv.preview_status FROM document_versions dv WHERE dv.id = r.source_id
        )
        WHEN r.source_kind = 'meeting' THEN (
          SELECT dv.preview_status FROM meetings m JOIN document_versions dv ON dv.id = m.source_document_version_id WHERE m.id = r.source_id
        )
        ELSE NULL
      END AS preview_status,
      CASE
        WHEN r.source_kind = 'meeting' THEN r.source_id
        WHEN r.source_kind = 'document_version' THEN (
          SELECT m.id FROM meetings m WHERE m.source_document_version_id = r.source_id AND m.workspace_id = r.workspace_id LIMIT 1
        )
        ELSE NULL
      END AS meeting_id
    FROM review_items r
    WHERE r.workspace_id = ? AND r.status = ?
    ORDER BY CASE r.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, r.created_at DESC
    LIMIT ?
  `, workspaceId, actualStatus, actualLimit);
}

export function resolveReviewItem(database, workspaceId, reviewId, resolution = {}) {
  const now = new Date().toISOString();
  const review = database.get('SELECT * FROM review_items WHERE id = ? AND workspace_id = ? AND status = \'open\'', reviewId, workspaceId);
  if (!review) return false;

  let targetMeetingId = null;
  if (review.source_kind === 'meeting') {
    targetMeetingId = review.source_id;
  } else if (review.source_kind === 'document_version') {
    const existingMeeting = database.get('SELECT id FROM meetings WHERE source_document_version_id = ? AND workspace_id = ?', review.source_id, workspaceId);
    if (existingMeeting) {
      targetMeetingId = existingMeeting.id;
    } else {
      const docRow = database.get(`
        SELECT d.id AS doc_id, d.title FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE dv.id = ?
      `, review.source_id);
      const meetingId = newId('meeting');
      database.run(`
        INSERT INTO meetings(id, workspace_id, source_document_version_id, title, status, confidence, evidence_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'confirmed_auto', 1.0, '{}', ?, ?)
      `, meetingId, workspaceId, review.source_id, docRow?.title || 'Заседание кафедры', now, now);
      database.run("UPDATE document_versions SET processing_status = 'processed', extraction_error = NULL WHERE id = ?", review.source_id);
      if (docRow?.doc_id) {
        database.run("UPDATE documents SET status = 'processed', document_type = 'department_protocol', updated_at = ? WHERE id = ?", now, docRow.doc_id);
      }
      targetMeetingId = meetingId;
    }
  }

  if (targetMeetingId && resolution && resolution.appliedValue && typeof resolution.appliedValue === 'string') {
    const val = resolution.appliedValue.trim();
    const code = String(review.issue_code || '');
    if (code.includes('date')) {
      database.run('UPDATE meetings SET meeting_date = ?, updated_at = ? WHERE id = ? AND workspace_id = ?', val, now, targetMeetingId, workspaceId);
    } else if (code.includes('number') || code.includes('protocol')) {
      database.run('UPDATE meetings SET protocol_number = ?, updated_at = ? WHERE id = ? AND workspace_id = ?', val, now, targetMeetingId, workspaceId);
    }
  }

  const result = database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE id = ? AND workspace_id = ? AND status = 'open'
  `, now, JSON.stringify(resolution ?? {}), reviewId, workspaceId);
  return result.changes > 0;
}
