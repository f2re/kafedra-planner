import { newId } from '../../core/src/ids.mjs';

export function syncDecisionCalendar(database, workspaceId, decision, agendaTitle, now = new Date().toISOString()) {
  if (!decision?.id) return null;
  const existing = database.get(`
    SELECT id FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'decision' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, decision.id);
  if (!decision.due_date) {
    if (existing) database.run('DELETE FROM calendar_items WHERE id = ?', existing.id);
    return null;
  }
  const title = `Срок: ${agendaTitle}`;
  if (existing) {
    database.run(`
      UPDATE calendar_items
      SET title = ?, starts_at = ?, description = ?, updated_at = ?
      WHERE id = ?
    `, title, decision.due_date, decision.text, now, existing.id);
    return existing.id;
  }
  const id = newId('cal');
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'decision', ?, ?, ?, NULL, 1, 'organizational', 'high', 'open', ?,
      'task', 1440, NULL, ?, ?)
  `, id, workspaceId, decision.id, title, decision.due_date, decision.text, now, now);
  return id;
}
