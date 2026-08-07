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

function normalizedCategories(value) {
  const allowed = new Set(['science', 'education', 'organizational', 'everyday']);
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((item) => String(item).trim()).filter((item) => allowed.has(item)))];
}

function snapshot(item) {
  return {
    title: item.title,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    all_day: item.all_day,
    category: item.category,
    importance: item.importance,
    status: item.status,
    description: item.description,
    item_kind: item.item_kind,
    reminder_minutes: item.reminder_minutes,
    completed_at: item.completed_at
  };
}

function sourceDocumentExpression() {
  return `CASE
    WHEN ci.source_kind = 'meeting' THEN (
      SELECT dv.document_id
      FROM meetings m
      JOIN document_versions dv ON dv.id = m.source_document_version_id
      WHERE m.id = ci.source_id
    )
    WHEN ci.source_kind = 'decision' THEN (
      SELECT dv.document_id
      FROM decisions d
      JOIN agenda_items ai ON ai.id = d.agenda_item_id
      JOIN meetings m ON m.id = ai.meeting_id
      JOIN document_versions dv ON dv.id = m.source_document_version_id
      WHERE d.id = ci.source_id
    )
    WHEN ci.source_kind = 'assignment' THEN (
      SELECT dv.document_id
      FROM assignments a
      JOIN directives d ON d.id = a.directive_id
      JOIN document_versions dv ON dv.id = d.source_document_version_id
      WHERE a.id = ci.source_id
    )
    ELSE NULL
  END`;
}

function audit(database, workspaceId, action, itemId, details, now) {
  database.run(`
    INSERT INTO audit_log(
      id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
    ) VALUES (?, ?, 'operator', ?, 'calendar_item', ?, ?, ?)
  `, newId('audit'), workspaceId, action, itemId, JSON.stringify(details || {}), now);
}

export function getCalendarItem(database, workspaceId, itemId) {
  return database.get(`
    SELECT ci.*,
      ${sourceDocumentExpression()} AS source_document_id,
      (
        SELECT id FROM calendar_item_revisions r
        WHERE r.calendar_item_id = ci.id AND r.undone_at IS NULL
        ORDER BY r.created_at DESC LIMIT 1
      ) AS undo_revision_id
    FROM calendar_items ci
    WHERE ci.id = ? AND ci.workspace_id = ?
  `, itemId, workspaceId);
}

export function listCalendarItems(database, workspaceId, {
  from = null,
  to = null,
  limit = 500,
  kind = null,
  status = null,
  categories = []
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
  } else {
    clauses.push("status <> 'cancelled'");
  }
  const selectedCategories = normalizedCategories(categories);
  if (selectedCategories.length) {
    clauses.push(`category IN (${selectedCategories.map(() => '?').join(', ')})`);
    params.push(...selectedCategories);
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
  database.transaction(() => {
    database.run(`
      INSERT INTO calendar_items(
        id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
        all_day, category, importance, status, description, item_kind,
        reminder_minutes, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
    `, id, workspaceId, id, String(body.title).trim(), body.startsAt, body.endsAt ?? null,
    body.allDay === false ? 0 : 1, body.category || 'everyday', body.importance || 'normal',
    status, body.description || null, kind,
    Number.isFinite(reminder) ? reminder : null,
    now, now);
    audit(database, workspaceId, 'calendar.created', id, { kind, startsAt: body.startsAt }, now);
  });
  return getCalendarItem(database, workspaceId, id);
}

export function updateCalendarItem(database, workspaceId, itemId, body, now = new Date().toISOString()) {
  const current = getCalendarItem(database, workspaceId, itemId);
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
  const action = body.action || (body.startsAt && body.startsAt !== current.starts_at ? 'reschedule' : 'update');

  return database.transaction(() => {
    database.run(`
      UPDATE calendar_items SET
        title = ?, starts_at = ?, ends_at = ?, all_day = ?, category = ?,
        importance = ?, status = ?, description = ?, item_kind = ?,
        reminder_minutes = ?, completed_at = ?, revision = revision + 1, updated_at = ?
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

    const updated = getCalendarItem(database, workspaceId, itemId);
    database.run(`
      INSERT INTO calendar_item_revisions(
        id, workspace_id, calendar_item_id, previous_json, current_json, action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, newId('calrev'), workspaceId, itemId, JSON.stringify(snapshot(current)),
    JSON.stringify(snapshot(updated)), action, now);
    audit(database, workspaceId, `calendar.${action}`, itemId, {
      previous: snapshot(current),
      current: snapshot(updated)
    }, now);
    return getCalendarItem(database, workspaceId, itemId);
  });
}

export function undoCalendarItem(database, workspaceId, itemId, now = new Date().toISOString()) {
  const current = getCalendarItem(database, workspaceId, itemId);
  if (!current) return null;
  const revision = database.get(`
    SELECT * FROM calendar_item_revisions
    WHERE workspace_id = ? AND calendar_item_id = ? AND undone_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `, workspaceId, itemId);
  if (!revision) return null;
  let previous;
  try { previous = JSON.parse(revision.previous_json); } catch { return null; }

  return database.transaction(() => {
    database.run(`
      UPDATE calendar_items SET
        title = ?, starts_at = ?, ends_at = ?, all_day = ?, category = ?,
        importance = ?, status = ?, description = ?, item_kind = ?,
        reminder_minutes = ?, completed_at = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `, previous.title, previous.starts_at, previous.ends_at, previous.all_day,
    previous.category, previous.importance, previous.status, previous.description,
    previous.item_kind, previous.reminder_minutes, previous.completed_at,
    now, itemId, workspaceId);
    database.run('UPDATE calendar_item_revisions SET undone_at = ? WHERE id = ?', now, revision.id);
    const restored = getCalendarItem(database, workspaceId, itemId);
    audit(database, workspaceId, 'calendar.undo', itemId, {
      revisionId: revision.id,
      restored: snapshot(restored)
    }, now);
    return restored;
  });
}

export function listTasks(database, workspaceId, { limit = 500, categories = [] } = {}) {
  const selectedCategories = normalizedCategories(categories);
  const clauses = ["workspace_id = ?", "(item_kind = 'task' OR source_kind = 'decision')"];
  const params = [workspaceId];
  if (selectedCategories.length) {
    clauses.push(`category IN (${selectedCategories.map(() => '?').join(', ')})`);
    params.push(...selectedCategories);
  }
  params.push(limit);
  return database.all(`
    SELECT * FROM calendar_items
    WHERE ${clauses.join(' AND ')}
    ORDER BY
      CASE WHEN status = 'completed' THEN 1 ELSE 0 END,
      starts_at ASC,
      CASE importance WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC
    LIMIT ?
  `, ...params);
}

function notificationAudience(database, item) {
  if (item.source_kind === 'assignment') {
    const rows = database.all(`
      SELECT ae.role, ae.person_id, ae.executor_raw, p.manager_id
      FROM assignment_executors ae
      LEFT JOIN people p ON p.id = ae.person_id
      WHERE ae.assignment_id = ?
    `, item.source_id);
    const executorPersonIds = [...new Set(rows.filter((row) => ['executor','coexecutor'].includes(row.role)).map((row) => row.person_id).filter(Boolean))];
    const managerPersonIds = [...new Set(rows.flatMap((row) => [
      row.role === 'controller' ? row.person_id : null,
      ['executor','coexecutor'].includes(row.role) ? row.manager_id : null
    ]).filter(Boolean))];
    return {
      personIds: [...new Set([...executorPersonIds, ...managerPersonIds])],
      executorPersonIds,
      managerPersonIds,
      executors: rows.filter((row) => ['executor','coexecutor'].includes(row.role)).map((row) => row.executor_raw),
      controllers: rows.filter((row) => row.role === 'controller').map((row) => row.executor_raw)
    };
  }
  if (item.source_kind === 'periodic_task') {
    const row = database.get('SELECT owner_person_id, manager_person_id FROM periodic_tasks WHERE id = ?', item.source_id);
    return {
      personIds: [row?.owner_person_id, row?.manager_person_id].filter(Boolean),
      executorPersonIds: [row?.owner_person_id].filter(Boolean),
      managerPersonIds: [row?.manager_person_id].filter(Boolean),
      executors: [], controllers: []
    };
  }
  return { personIds: [], executorPersonIds: [], managerPersonIds: [], executors: [], controllers: [] };
}

export function listNotifications(database, workspaceId, {
  now = new Date(),
  limit = 50,
  personId = null
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
    const isTask = item.item_kind === 'task' || ['decision', 'assignment', 'periodic_task'].includes(item.source_kind);
    const dateKey = String(item.starts_at).slice(0, 10);
    const audience = notificationAudience(database, item);
    if (personId && audience.personIds.length && !audience.personIds.includes(personId)) continue;

    if (item.source_kind === 'assignment' && item.status === 'submitted') {
      if (personId && audience.managerPersonIds.length && !audience.managerPersonIds.includes(personId)) continue;
      const key = `calendar:${item.id}:manager-review:r${item.revision || 1}`;
      const state = states.get(key);
      if (!state?.dismissed_at) notifications.push({
        key, calendarItemId: item.id, kind: 'manager_review',
        title: `Проверить отчёт: ${item.title}`,
        body: 'Исполнитель представил отчёт. Подтвердите результат или верните его на доработку.',
        notifyAt: item.updated_at || item.starts_at, urgency: 'high',
        read: Boolean(state?.read_at), audience: { ...audience, personIds: audience.managerPersonIds }
      });
      continue;
    }
    if (item.source_kind === 'assignment' && item.status === 'rework') {
      if (personId && audience.executorPersonIds.length && !audience.executorPersonIds.includes(personId)) continue;
      const key = `calendar:${item.id}:rework:r${item.revision || 1}`;
      const state = states.get(key);
      if (!state?.dismissed_at) notifications.push({
        key, calendarItemId: item.id, kind: 'rework',
        title: `Требуется доработка: ${item.title}`,
        body: 'Руководитель вернул отчёт. Откройте поручение и устраните замечания.',
        notifyAt: item.updated_at || item.starts_at, urgency: 'high',
        read: Boolean(state?.read_at), audience: { ...audience, personIds: audience.executorPersonIds }
      });
      continue;
    }

    if (isTask && dateKey < today) {
      const key = `calendar:${item.id}:overdue:${dateKey}:r${item.revision || 1}`;
      const state = states.get(key);
      if (!state?.dismissed_at) notifications.push({
        key,
        calendarItemId: item.id,
        kind: 'overdue',
        title: `Просрочено: ${item.title}`,
        body: item.description || 'Срок задачи уже прошёл.',
        notifyAt: item.starts_at,
        urgency: 'high',
        read: Boolean(state?.read_at),
        audience
      });
      continue;
    }

    if (item.reminder_minutes !== null && item.reminder_minutes !== undefined) {
      const reminderAt = new Date(start.getTime() - Number(item.reminder_minutes) * 60_000);
      if (reminderAt <= nowDate && start.getTime() >= nowDate.getTime() - 24 * 60 * 60 * 1000) {
        const key = `calendar:${item.id}:reminder:${dateKey}:${item.reminder_minutes}:r${item.revision || 1}`;
        const state = states.get(key);
        if (!state?.dismissed_at) notifications.push({
          key,
          calendarItemId: item.id,
          kind: 'reminder',
          title: item.title,
          body: item.description || (isTask ? 'Наступает срок задачи.' : 'Скоро начнётся событие.'),
          notifyAt: reminderAt.toISOString(),
          urgency: importanceRank(item.importance) >= 3 ? 'high' : 'normal',
          read: Boolean(state?.read_at),
          audience
        });
      }
    } else if (dateKey === today) {
      const key = `calendar:${item.id}:today:${dateKey}:r${item.revision || 1}`;
      const state = states.get(key);
      if (!state?.dismissed_at) notifications.push({
        key,
        calendarItemId: item.id,
        kind: 'today',
        title: item.title,
        body: isTask ? 'Задача запланирована на сегодня.' : 'Событие запланировано на сегодня.',
        notifyAt: item.starts_at,
        urgency: importanceRank(item.importance) >= 3 ? 'high' : 'normal',
        read: Boolean(state?.read_at),
        audience
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
