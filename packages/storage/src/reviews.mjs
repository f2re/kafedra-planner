export function listReviewItems(database, workspaceId, status = 'open', limit = 200) {
  return database.all(`
    SELECT * FROM review_items
    WHERE workspace_id = ? AND status = ?
    ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
    LIMIT ?
  `, workspaceId, status, limit);
}

export function resolveReviewItem(database, workspaceId, reviewId, resolution) {
  const now = new Date().toISOString();
  const result = database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE id = ? AND workspace_id = ? AND status = 'open'
  `, now, JSON.stringify(resolution ?? {}), reviewId, workspaceId);
  return result.changes > 0;
}
