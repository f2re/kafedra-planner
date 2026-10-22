export function listReviewItems(database, workspaceId, status = 'open', limit = 200) {
  return database.all(`
    SELECT * FROM review_items
    WHERE workspace_id = ? AND status = ?
    ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
    LIMIT ?
  `, workspaceId, status, limit);
}

export function resolveReviewItem(database, workspaceId, reviewId, resolution = {}) {
  const now = new Date().toISOString();
  const review = database.get('SELECT * FROM review_items WHERE id = ? AND workspace_id = ? AND status = \'open\'', reviewId, workspaceId);
  if (!review) return false;

  if (resolution && resolution.appliedValue && typeof resolution.appliedValue === 'string') {
    const val = resolution.appliedValue.trim();
    const code = String(review.issue_code || '');
    if (code.includes('date')) {
      if (review.source_kind === 'meeting') {
        database.run('UPDATE meetings SET meeting_date = ?, updated_at = ? WHERE id = ? AND workspace_id = ?', val, now, review.source_id, workspaceId);
      } else if (review.source_kind === 'document_version') {
        database.run('UPDATE meetings SET meeting_date = ?, updated_at = ? WHERE source_document_version_id = ? AND workspace_id = ?', val, now, review.source_id, workspaceId);
      }
    } else if (code.includes('number') || code.includes('protocol')) {
      if (review.source_kind === 'meeting') {
        database.run('UPDATE meetings SET protocol_number = ?, updated_at = ? WHERE id = ? AND workspace_id = ?', val, now, review.source_id, workspaceId);
      } else if (review.source_kind === 'document_version') {
        database.run('UPDATE meetings SET protocol_number = ?, updated_at = ? WHERE source_document_version_id = ? AND workspace_id = ?', val, now, review.source_id, workspaceId);
      }
    }
  }

  const result = database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE id = ? AND workspace_id = ? AND status = 'open'
  `, now, JSON.stringify(resolution ?? {}), reviewId, workspaceId);
  return result.changes > 0;
}
