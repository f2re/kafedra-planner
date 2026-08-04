export function getOverview(database, workspaceId) {
  const scalar = (sql, ...params) => Number(Object.values(database.get(sql, ...params) ?? { value: 0 })[0] ?? 0);
  return {
    documents: scalar('SELECT COUNT(*) AS value FROM documents WHERE workspace_id = ?', workspaceId),
    queuedJobs: scalar("SELECT COUNT(*) AS value FROM jobs WHERE status IN ('queued', 'retry', 'running')"),
    reviewOpen: scalar("SELECT COUNT(*) AS value FROM review_items WHERE workspace_id = ? AND status = 'open'", workspaceId),
    upcoming: scalar("SELECT COUNT(*) AS value FROM calendar_items WHERE workspace_id = ? AND starts_at >= date('now')", workspaceId),
    meetings: scalar('SELECT COUNT(*) AS value FROM meetings WHERE workspace_id = ?', workspaceId),
    failedJobs: scalar("SELECT COUNT(*) AS value FROM jobs WHERE status = 'failed'")
  };
}
