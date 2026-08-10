import { newId } from '../../core/src/ids.mjs';

const PERIOD_KINDS = new Set(['semester', 'academic_year', 'calendar_year', 'quarter', 'custom']);

function categoryFor(direction) {
  if (direction === 'science') return 'science';
  if (direction === 'education') return 'education';
  return 'organizational';
}

function review(database, workspaceId, taskId, issueCode, title, explanation, action, now) {
  const exists = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_kind = 'periodic_task' AND source_id = ?
      AND issue_code = ? AND status = 'open'
  `, workspaceId, taskId, issueCode);
  if (exists) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'periodic_task', ?, ?, ?, ?, ?, 'warning', 'open', '{}', ?)
  `, newId('review'), workspaceId, taskId, issueCode, title, explanation, action, now);
}

function resolveReview(database, workspaceId, taskId, issueCode, now) {
  database.run(`
    UPDATE review_items SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE workspace_id = ? AND source_kind = 'periodic_task' AND source_id = ?
      AND issue_code = ? AND status = 'open'
  `, now, JSON.stringify({ action: 'periodic_task_updated' }), workspaceId, taskId, issueCode);
}

function person(database, workspaceId, id) {
  if (!id) return null;
  return database.get(`
    SELECT id, display_name, manager_id FROM people
    WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, id) || null;
}

function validateDates(startsAt, dueDate) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/u.test(String(dueDate))) throw new Error('periodic_task_due_required');
  if (startsAt && !/^\d{4}-\d{2}-\d{2}$/u.test(String(startsAt))) throw new Error('periodic_task_planned_invalid');
  if (startsAt && String(startsAt) > String(dueDate)) throw new Error('periodic_task_dates_invalid');
}

function snapshot(row) {
  return {
    ownerPersonId: row.owner_person_id,
    managerPersonId: row.manager_person_id,
    periodKind: row.period_kind,
    periodKey: row.period_key,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    dueDate: row.due_date,
    direction: row.direction,
    priority: row.priority,
    status: row.status,
    expectedResult: row.expected_result,
    reportRequired: Boolean(row.report_required)
  };
}

function taskRow(database, workspaceId, taskId) {
  const row = database.get(`
    SELECT pt.*, owner.display_name AS owner_name, manager.display_name AS manager_name
    FROM periodic_tasks pt
    LEFT JOIN people owner ON owner.id = pt.owner_person_id
    LEFT JOIN people manager ON manager.id = pt.manager_person_id
    WHERE pt.workspace_id = ? AND pt.id = ?
  `, workspaceId, taskId);
  if (!row) return null;
  return {
    ...row,
    history: database.all(`
      SELECT actor, details_json, created_at FROM audit_log
      WHERE workspace_id = ? AND subject_kind = 'periodic_task' AND subject_id = ?
        AND action = 'periodic_task.updated'
      ORDER BY created_at DESC, id DESC LIMIT 100
    `, workspaceId, taskId).map((entry) => {
      let details = {};
      try { details = JSON.parse(entry.details_json); } catch {}
      return { actor: entry.actor, createdAt: entry.created_at, ...details };
    })
  };
}

function calendarProjection(database, workspaceId, task, sourceKind) {
  return database.get(`
    SELECT * FROM calendar_items
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, sourceKind, task.id);
}

function upsertControlCalendar(database, workspaceId, task, now) {
  const existing = calendarProjection(database, workspaceId, task, 'periodic_task');
  if (!existing) {
    database.run(`
      INSERT INTO calendar_items(
        id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
        all_day, category, importance, status, description, item_kind,
        reminder_minutes, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, 'periodic_task', ?, ?, ?, NULL, 1, ?, ?, ?, ?, 'task', 10080, ?, 1, ?, ?)
    `, newId('cal'), workspaceId, task.id, task.title, task.due_date,
    categoryFor(task.direction), task.priority || 'normal', task.status,
    task.description || task.expected_result || null,
    task.completed_at || null, now, now);
    return;
  }
  database.run(`
    UPDATE calendar_items SET title = ?, starts_at = ?, category = ?, importance = ?,
      status = ?, description = ?, completed_at = ?, revision = revision + 1, updated_at = ?
    WHERE id = ?
  `, task.title, task.due_date, categoryFor(task.direction), task.priority || 'normal',
  task.status, task.description || task.expected_result || null, task.completed_at || null,
  now, existing.id);
}

function upsertPlanCalendar(database, workspaceId, task, now) {
  const existing = calendarProjection(database, workspaceId, task, 'periodic_task_plan');
  const planned = task.starts_at && task.starts_at !== task.due_date ? task.starts_at : null;
  if (!planned) {
    if (existing && existing.status !== 'cancelled') database.run(`
      UPDATE calendar_items SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE id = ?
    `, now, existing.id);
    return;
  }
  const status = task.status === 'cancelled' ? 'cancelled' : task.status === 'completed' ? 'completed' : 'confirmed';
  const title = `Плановый рубеж · ${task.title}`;
  if (!existing) {
    database.run(`
      INSERT INTO calendar_items(
        id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
        all_day, category, importance, status, description, item_kind,
        reminder_minutes, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, 'periodic_task_plan', ?, ?, ?, NULL, 1, ?, 'normal', ?, ?, 'event', NULL, ?, 1, ?, ?)
    `, newId('cal'), workspaceId, task.id, title, planned, categoryFor(task.direction),
    status, task.description || 'Плановый рубеж без отдельного уведомления.',
    task.completed_at || null, now, now);
    return;
  }
  database.run(`
    UPDATE calendar_items SET title = ?, starts_at = ?, category = ?, status = ?,
      description = ?, completed_at = ?, reminder_minutes = NULL,
      revision = revision + 1, updated_at = ? WHERE id = ?
  `, title, planned, categoryFor(task.direction), status,
  task.description || 'Плановый рубеж без отдельного уведомления.',
  task.completed_at || null, now, existing.id);
}

function syncCalendar(database, workspaceId, task, now) {
  upsertControlCalendar(database, workspaceId, task, now);
  upsertPlanCalendar(database, workspaceId, task, now);
}

function responsibility(database, workspaceId, ownerPersonId, requestedManagerId) {
  const owner = person(database, workspaceId, ownerPersonId);
  if (!owner) throw new Error('periodic_task_owner_invalid');
  const managerId = requestedManagerId === undefined || requestedManagerId === ''
    ? owner.manager_id || null
    : requestedManagerId || null;
  const manager = managerId ? person(database, workspaceId, managerId) : null;
  if (managerId && !manager) throw new Error('periodic_task_manager_invalid');
  return { owner, manager };
}

export function createPeriodicTaskV2(database, workspaceId, body, {
  actorPersonId = null,
  now = new Date().toISOString()
} = {}) {
  const title = String(body.title || '').trim();
  const periodKind = String(body.periodKind || '').trim();
  const periodKey = String(body.periodKey || '').trim();
  if (!title || !PERIOD_KINDS.has(periodKind) || !periodKey) throw new Error('periodic_task_fields_required');
  validateDates(body.startsAt || null, body.dueDate);
  const people = responsibility(database, workspaceId, body.ownerPersonId, body.managerPersonId);
  const id = newId('periodic');
  database.transaction(() => {
    database.run(`
      INSERT INTO periodic_tasks(
        id, workspace_id, owner_person_id, manager_person_id, period_kind, period_key,
        title, description, starts_at, due_date, direction, priority, status,
        expected_result, report_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `, id, workspaceId, people.owner.id, people.manager?.id || null,
    periodKind, periodKey, title, body.description || null, body.startsAt || null,
    body.dueDate, body.direction || 'organizational', body.priority || 'normal',
    body.expectedResult || null, body.reportRequired === false ? 0 : 1, now, now);
    const task = taskRow(database, workspaceId, id);
    syncCalendar(database, workspaceId, task, now);
    if (!people.manager) review(database, workspaceId, id, 'periodic_task_manager_missing',
      'У периодической задачи не определён руководитель',
      `Для сотрудника «${people.owner.display_name}» не найден контролирующий руководитель.`,
      'Укажите руководителя в карточке задачи или в справочнике сотрудников.', now);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, ?, 'periodic_task.created', 'periodic_task', ?, ?, ?)
    `, newId('audit'), workspaceId, actorPersonId ? `person:${actorPersonId}` : 'operator', id,
    JSON.stringify({ current: snapshot(task) }), now);
  });
  return taskRow(database, workspaceId, id);
}

export function updatePeriodicTaskV2(database, workspaceId, taskId, body, {
  actorPersonId = null,
  now = new Date().toISOString()
} = {}) {
  const current = taskRow(database, workspaceId, taskId);
  if (!current) return null;
  const reason = String(body.reason || '').trim();
  if (reason.length < 3) throw new Error('periodic_task_reason_required');
  const ownerPersonId = body.ownerPersonId === undefined ? current.owner_person_id : body.ownerPersonId;
  const managerRequest = body.managerPersonId === undefined
    ? (body.ownerPersonId !== undefined && body.ownerPersonId !== current.owner_person_id ? undefined : current.manager_person_id)
    : body.managerPersonId;
  const people = responsibility(database, workspaceId, ownerPersonId, managerRequest);
  const startsAt = body.startsAt === undefined ? current.starts_at : (body.startsAt || null);
  const dueDate = body.dueDate === undefined ? current.due_date : body.dueDate;
  validateDates(startsAt, dueDate);
  const periodKind = body.periodKind === undefined ? current.period_kind : String(body.periodKind || '');
  const periodKey = body.periodKey === undefined ? current.period_key : String(body.periodKey || '').trim();
  const title = body.title === undefined ? current.title : String(body.title || '').trim();
  if (!title || !PERIOD_KINDS.has(periodKind) || !periodKey) throw new Error('periodic_task_fields_required');
  const status = body.status === undefined ? current.status : String(body.status || 'open');
  const before = snapshot(current);

  database.transaction(() => {
    database.run(`
      UPDATE periodic_tasks SET owner_person_id = ?, manager_person_id = ?, period_kind = ?, period_key = ?,
        title = ?, description = ?, starts_at = ?, due_date = ?, direction = ?, priority = ?, status = ?,
        expected_result = ?, report_required = ?, completed_at = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, people.owner.id, people.manager?.id || null, periodKind, periodKey, title,
    body.description === undefined ? current.description : body.description || null,
    startsAt, dueDate,
    body.direction === undefined ? current.direction : body.direction || 'organizational',
    body.priority === undefined ? current.priority : body.priority || 'normal', status,
    body.expectedResult === undefined ? current.expected_result : body.expectedResult || null,
    body.reportRequired === undefined ? current.report_required : (body.reportRequired === false ? 0 : 1),
    status === 'completed' ? (current.completed_at || now) : null,
    now, workspaceId, taskId);
    const updated = taskRow(database, workspaceId, taskId);
    syncCalendar(database, workspaceId, updated, now);
    if (people.manager) resolveReview(database, workspaceId, taskId, 'periodic_task_manager_missing', now);
    else review(database, workspaceId, taskId, 'periodic_task_manager_missing',
      'У периодической задачи не определён руководитель',
      `Для сотрудника «${people.owner.display_name}» не найден контролирующий руководитель.`,
      'Укажите руководителя в карточке задачи или в справочнике сотрудников.', now);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, ?, 'periodic_task.updated', 'periodic_task', ?, ?, ?)
    `, newId('audit'), workspaceId, actorPersonId ? `person:${actorPersonId}` : 'operator', taskId,
    JSON.stringify({ reason, before, after: snapshot(updated), actorPersonId }), now);
  });
  return taskRow(database, workspaceId, taskId);
}

export function getPeriodicTaskV2(database, workspaceId, taskId) {
  return taskRow(database, workspaceId, taskId);
}

export function listPeriodicTasksV2(database, workspaceId, filters = {}) {
  const clauses = ['pt.workspace_id = ?'];
  const params = [workspaceId];
  if (filters.ownerPersonId) { clauses.push('pt.owner_person_id = ?'); params.push(filters.ownerPersonId); }
  if (filters.managerPersonId) { clauses.push('pt.manager_person_id = ?'); params.push(filters.managerPersonId); }
  if (filters.periodKind) { clauses.push('pt.period_kind = ?'); params.push(filters.periodKind); }
  if (filters.periodKey) { clauses.push('pt.period_key = ?'); params.push(filters.periodKey); }
  if (filters.status) { clauses.push('pt.status = ?'); params.push(filters.status); }
  if (filters.from) { clauses.push('pt.due_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('pt.due_date <= ?'); params.push(filters.to); }
  params.push(Math.min(1000, Math.max(1, Number(filters.limit || 500))));
  return database.all(`
    SELECT pt.id FROM periodic_tasks pt
    WHERE ${clauses.join(' AND ')}
    ORDER BY CASE WHEN pt.status IN ('completed','cancelled') THEN 1 ELSE 0 END,
      pt.due_date, pt.title LIMIT ?
  `, ...params).map((row) => taskRow(database, workspaceId, row.id));
}
