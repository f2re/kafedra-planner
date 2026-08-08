import { listNotifications } from '../../calendar/src/service.mjs';
import { listPlanFact } from './service.mjs';

function states(database, workspaceId, personId) {
  return new Map(database.all(`
    SELECT notification_key, read_at, dismissed_at
    FROM person_notification_states
    WHERE workspace_id = ? AND person_id = ?
  `, workspaceId, personId).map((row) => [row.notification_key, row]));
}

function riskNotification(item, personId, stateMap) {
  if (!['at_risk', 'overdue', 'rework'].includes(item.risk.code)) return null;
  const manager = item.managerPersonIds.includes(personId);
  const owner = item.ownerPersonIds.includes(personId);
  if (!manager && !owner) return null;
  const key = `planfact:${item.sourceKind}:${item.id}:${item.risk.code}:${item.dueDate || 'none'}:${item.progressPercent}:${item.progressRevision || '1'}`;
  const state = stateMap.get(key);
  if (state?.dismissed_at) return null;
  const title = manager
    ? item.risk.code === 'overdue'
      ? `Просрочено у сотрудника: ${item.title}`
      : item.risk.code === 'rework'
        ? `Отчёт возвращён: ${item.title}`
        : `Риск срыва: ${item.title}`
    : item.risk.code === 'overdue'
      ? `Просрочено: ${item.title}`
      : item.risk.code === 'rework'
        ? `Требуется доработка: ${item.title}`
        : `Нужно ускорить: ${item.title}`;
  const body = manager
    ? `Текущий прогресс ${item.progressPercent}%. ${item.risk.label}. Проверьте причину и согласуйте действие.`
    : `Текущий прогресс ${item.progressPercent}%. ${item.risk.label}. Обновите результат или сообщите о препятствии.`;
  return {
    key,
    calendarItemId: null,
    sourceKind: item.sourceKind,
    sourceId: item.id,
    kind: manager ? 'manager_risk' : 'executor_risk',
    title,
    body,
    notifyAt: item.progressRevision || item.dueDate,
    urgency: item.risk.code === 'overdue' ? 'critical' : 'high',
    read: Boolean(state?.read_at),
    audience: { personIds: [personId], role: manager ? 'manager' : 'executor' }
  };
}

function periodicActionNotifications(database, workspaceId, personId, stateMap) {
  const rows = database.all(`
    SELECT pt.id, pt.title, pt.status, pt.owner_person_id, pt.manager_person_id, pt.updated_at,
      pe.id AS evidence_id, pe.review_status, pe.reviewed_at, pe.review_note
    FROM periodic_tasks pt
    LEFT JOIN periodic_task_evidence pe ON pe.id = (
      SELECT x.id FROM periodic_task_evidence x
      WHERE x.periodic_task_id = pt.id AND x.evidence_kind = 'report'
      ORDER BY x.created_at DESC, x.id DESC LIMIT 1
    )
    WHERE pt.workspace_id = ?
      AND (pt.owner_person_id = ? OR pt.manager_person_id = ?)
      AND pt.status IN ('submitted','rework')
    ORDER BY pt.updated_at DESC
  `, workspaceId, personId, personId);
  const result = [];
  for (const row of rows) {
    if (row.status === 'submitted' && row.manager_person_id === personId && row.review_status === 'pending') {
      const key = `periodic:${row.id}:manager-review:${row.evidence_id || row.updated_at}`;
      const state = stateMap.get(key);
      if (!state?.dismissed_at) result.push({
        key,
        calendarItemId: null,
        sourceKind: 'periodic_task',
        sourceId: row.id,
        kind: 'manager_review',
        title: `Проверить отчёт: ${row.title}`,
        body: 'Сотрудник представил результат периодической задачи. Подтвердите его или верните на доработку.',
        notifyAt: row.updated_at,
        urgency: 'high',
        read: Boolean(state?.read_at),
        audience: { personIds: [personId], role: 'manager' }
      });
    }
    if (row.status === 'rework' && row.owner_person_id === personId && row.review_status === 'returned') {
      const key = `periodic:${row.id}:rework:${row.evidence_id || row.reviewed_at || row.updated_at}`;
      const state = stateMap.get(key);
      if (!state?.dismissed_at) result.push({
        key,
        calendarItemId: null,
        sourceKind: 'periodic_task',
        sourceId: row.id,
        kind: 'rework',
        title: `Требуется доработка: ${row.title}`,
        body: row.review_note || 'Руководитель вернул отчёт. Уточните результат и приложите новую версию.',
        notifyAt: row.reviewed_at || row.updated_at,
        urgency: 'high',
        read: Boolean(state?.read_at),
        audience: { personIds: [personId], role: 'executor' }
      });
    }
  }
  return result;
}

function baseNotification(database, workspaceId, item, stateMap) {
  const source = item.calendarItemId
    ? database.get('SELECT source_kind, source_id FROM calendar_items WHERE workspace_id = ? AND id = ?', workspaceId, item.calendarItemId)
    : null;
  if (source?.source_kind === 'periodic_task') {
    const taskStatus = database.get('SELECT status FROM periodic_tasks WHERE workspace_id = ? AND id = ?', workspaceId, source.source_id)?.status;
    if (['submitted', 'rework'].includes(taskStatus)) return null;
  }
  return {
    ...item,
    sourceKind: item.sourceKind || source?.source_kind || null,
    sourceId: item.sourceId || source?.source_id || null,
    read: Boolean(stateMap.get(item.key)?.read_at)
  };
}

export function listPersonalNotifications(database, workspaceId, {
  personId,
  now = new Date(),
  limit = 100
} = {}) {
  if (!personId) return { items: [], unread: 0 };
  const person = database.get('SELECT * FROM people WHERE workspace_id = ? AND id = ? AND status = ?', workspaceId, personId, 'active');
  if (!person) return null;
  const stateMap = states(database, workspaceId, personId);
  const base = listNotifications(database, workspaceId, { personId, now, limit: 500 })
    .filter((item) => !stateMap.get(item.key)?.dismissed_at)
    .map((item) => baseNotification(database, workspaceId, item, stateMap))
    .filter(Boolean);
  const dashboard = listPlanFact(database, workspaceId, {
    ownerPersonId: personId,
    limit: 2000
  }, now);
  const managed = listPlanFact(database, workspaceId, {
    managerPersonId: personId,
    limit: 2000
  }, now);
  const unique = new Map([...dashboard.items, ...managed.items].map((item) => [`${item.sourceKind}:${item.id}`, item]));
  const risks = [...unique.values()].map((item) => riskNotification(item, personId, stateMap)).filter(Boolean);
  const periodicActions = periodicActionNotifications(database, workspaceId, personId, stateMap);
  const byKey = new Map([...base, ...periodicActions, ...risks].map((item) => [item.key, item]));
  const items = [...byKey.values()]
    .sort((a, b) => Number(a.read) - Number(b.read)
      || ({ critical: 0, high: 1, normal: 2 }[a.urgency] ?? 3) - ({ critical: 0, high: 1, normal: 2 }[b.urgency] ?? 3)
      || String(a.notifyAt || '').localeCompare(String(b.notifyAt || '')))
    .slice(0, Math.min(500, Math.max(1, Number(limit || 100))));
  return { person, items, unread: items.filter((item) => !item.read).length };
}

export function setPersonalNotificationState(database, workspaceId, personId, notificationKey, action, now = new Date().toISOString()) {
  const person = database.get('SELECT id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, personId);
  if (!person || !notificationKey) return false;
  const readAt = ['read', 'dismiss'].includes(action) ? now : null;
  const dismissedAt = action === 'dismiss' ? now : null;
  database.transaction(() => {
    database.run(`
      INSERT INTO person_notification_states(
        workspace_id, person_id, notification_key, read_at, dismissed_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, person_id, notification_key) DO UPDATE SET
        read_at = COALESCE(excluded.read_at, person_notification_states.read_at),
        dismissed_at = COALESCE(excluded.dismissed_at, person_notification_states.dismissed_at)
    `, workspaceId, personId, notificationKey, readAt, dismissedAt);
    if (readAt) {
      database.run(`
        UPDATE notification_deliveries
        SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
        WHERE workspace_id = ? AND person_id = ? AND notification_key = ?
          AND status IN ('sent', 'delivered')
      `, now, now, workspaceId, personId, notificationKey);
    }
  });
  return true;
}
