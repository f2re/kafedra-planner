import { newId } from '../../core/src/ids.mjs';

function asIsoDateTime(value, fallbackHour = 9) {
  if (!value) return null;
  const text = String(value);
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${String(fallbackHour).padStart(2, '0')}:00:00`
    : text;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function importanceRank(value) {
  return { critical: 4, high: 3, normal: 2, low: 1 }[value] || 2;
}

export function listCalendarItems(database, workspaceId, {
  from = null,
  to = null,
  limit = 500,
  kind = null,
  status = null
} = {}) {
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
  if (kind === 'task') clauses.push("(item_kind = 'task' OR source_kind = 'decision')");
  if (kind === 'event') clauses.push("item_kind = 'event' AND source_kind <> 'decision'");
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  params.push(limit);
  return database.all(`
    SELECT * FROM calendar_items
    WHERE ${clauses.join(' AND ')}
    ORDER BY starts_at ASC,
      CASE importance WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
      created_at ASC
    LIMIT ?
  `, ...params);
}

export function createCalendarItem(database, workspaceId, body, now = new Date().toISOString()) {
  const id = newId('cal');
  const kind = body.kind === 'task' ? 'task' : 'event';
  const status = kind === 'task' ? (body.status || 'open') : (body.status || 'confirmed');
  const reminder = body.reminderMinutes === null || body.reminderMinutes === undefined || body.reminderMinutes === ''
    ? null
    : Math.max(0, Number(body.reminderMinutes));
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `, id, workspaceId, id, String(body.title).trim(), body.startsAt, body.endsAt ?? null,
  body.allDay === false ? 0 : 1, body.category || 'everyday', body.importance || 'normal',
  status, body.description || null, kind,
  Number.isFinite(reminder) ? reminder : null,
  now, now);
  return database.get('SELECT * FROM calendar_items WHERE id = ?', id);
}

export function updateCalendarItem(database, workspaceId, itemId, body, now = new Date().toISOString()) {
  const current = database.get('SELECT * FROM calendar_items WHERE id = ? AND workspace_id = ?', itemId, workspaceId);
  if (!current) return null;
  const kind = body.kind === 'task' || current.item_kind === 'task' ? 'task' : 'event';
  const requestedStatus = body.status || current.status;
  const completing = requestedStatus === 'completed' && current.status !== 'completed';
  const reopening = requestedStatus !== 'completed' && current.status === 'completed';
  const reminder = body.reminderMinutes === null
    ? null
    : body.reminderMinutes === undefined
      ? current.reminder_minutes
      : Math.max(0, Number(body.reminderMinutes));
  database.run(`
    UPDATE calendar_items SET
      title = ?, starts_at = ?, ends_at = ?, all_day = ?, category = ?,
      importance = ?, status = ?, description = ?, item_kind = ?,
      reminder_minutes = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `,
  String(body.title ?? current.title).trim(), body.startsAt ?? current.starts_at,
  body.endsAt === undefined ? current.ends_at : body.endsAt,
  body.allDay === undefined ? current.all_day : (body.allDay === false ? 0 : 1),
  body.category ?? current.category, body.importance ?? current.importance,
  requestedStatus, body.description === undefined ? current.description : body.description,
  kind, Number.isFinite(reminder) ? reminder : null,
  completing ? now : reopening ? null : current.completed_at,
  now, itemId, workspaceId);
  return database.get('SELECT * FROM calendar_items WHERE id = ? AND workspace_id = ?', itemId, workspaceId);
}

export function listTasks(database, workspaceId, { limit = 500 } = {}) {
  return database.all(`
    SELECT * FROM calendar_items
    WHERE workspace_id = ? AND (item_kind = 'task' OR source_kind = 'decision')
    ORDER BY
      CASE WHEN status = 'completed' THEN 1 ELSE 0 END,
      starts_at ASC,
      CASE importance WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC
    LIMIT ?
  `, workspaceId, limit);
}

export function listNotifications(database, workspaceId, {
  now = new Date(),
  limit = 50
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const from = new Date(nowDate.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(nowDate.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const items = listCalendarItems(database, workspaceId, { from, to, limit: 2000 });
  const states = new Map(database.all(`
    SELECT notification_key, read_at, dismissed_at
    FROM notification_states WHERE workspace_id = ?
  `, workspaceId).map((row) => [row.notification_key, row]));
  const today = nowDate.toISOString().slice(0, 10);
  const notifications = [];

  for (const item of items) {
    if (item.status === 'completed' || item.status === 'cancelled') continue;
    const start = asIsoDateTime(item.starts_at);
    if (!start) continue;
    const isTask = item.item_kind === 'task' || item.source_kind === 'decision';
    const dateKey = String(item.starts_at).slice(0, 10);

    if (isTask && dateKey < today) {
      const key = `calendar:${item.id}:overdue`;
      const state = states.get(key);
      if (!state?.dismissed_at) notifications.push({
        key,
        calendarItemId: item.id,
        kind: 'overdue',
        title: `Просрочено: ${item.title}`,
        body: item.description || 'Срок задачи уже прошёл.',
        notifyAt: item.starts_at,
        urgency: 'high',
        read: Boolean(state?.read_at)
      });
      continue;
    }

    if (item.reminder_minutes !== null && item.reminder_minutes !== undefined) {
      const reminderAt = new Date(start.getTime() - Number(item.reminder_minutes) * 60_000);
      if (reminderAt <= nowDate && start.getTime() >= nowDate.getTime() - 24 * 60 * 60 * 1000) {
        const key = `calendar:${item.id}:reminder:${item.reminder_minutes}`;
        const state = states.get(key);
        if (!state?.dismissed_at) notifications.push({
          key,
          calendarItemId: item.id,
          kind: 'reminder',
          title: item.title,
          body: item.description || (isTask ? 'Наступает срок задачи.' : 'Скоро начнётся событие.'),
          notifyAt: reminderAt.toISOString(),
          urgency: importanceRank(item.importance) >= 3 ? 'high' : 'normal',
          read: Boolean(state?.read_at)
        });
      }
    } else if (dateKey === today) {
      const key = `calendar:${item.id}:today`;
      const state = states.get(key);
      if (!state?.dismissed_at) notifications.push({
        key,
        calendarItemId: item.id,
        kind: 'today',
        title: item.title,
        body: isTask ? 'Задача запланирована на сегодня.' : 'Событие запланировано на сегодня.',
        notifyAt: item.starts_at,
        urgency: importanceRank(item.importance) >= 3 ? 'high' : 'normal',
        read: Boolean(state?.read_at)
      });
    }
  }

  return notifications
    .sort((a, b) => Number(a.read) - Number(b.read) || String(a.notifyAt).localeCompare(String(b.notifyAt)))
    .slice(0, limit);
}

export function setNotificationState(database, workspaceId, notificationKey, action, now = new Date().toISOString()) {
  if (!notificationKey) return false;
  const readAt = action === 'read' || action === 'dismiss' ? now : null;
  const dismissedAt = action === 'dismiss' ? now : null;
  database.run(`
    INSERT INTO notification_states(workspace_id, notification_key, read_at, dismissed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, notification_key) DO UPDATE SET
      read_at = COALESCE(excluded.read_at, notification_states.read_at),
      dismissed_at = COALESCE(excluded.dismissed_at, notification_states.dismissed_at)
  `, workspaceId, notificationKey, readAt, dismissedAt);
  return true;
}
