export function listCalendarItems(database, workspaceId, { from = null, to = null, limit = 500 } = {}) {
  const clauses = ['workspace_id = ?'];
  const params = [workspaceId];
  if (from) {
    clauses.push('(ends_at IS NULL OR ends_at >= ?)');
    params.push(from);
  }
  if (to) {
    clauses.push('starts_at <= ?');
    params.push(to);
  }
  params.push(limit);
  return database.all(`
    SELECT * FROM calendar_items
    WHERE ${clauses.join(' AND ')}
    ORDER BY starts_at ASC, importance DESC
    LIMIT ?
  `, ...params);
}
