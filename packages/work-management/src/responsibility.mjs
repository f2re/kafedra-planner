import { newId } from '../../core/src/ids.mjs';

const EDITABLE_ROLES = ['executor', 'coexecutor', 'controller', 'observer'];

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function assignmentBase(database, workspaceId, assignmentId) {
  return database.get(`
    SELECT a.id, a.directive_id, d.issuer_raw AS delegator_raw, d.title AS directive_title
    FROM assignments a
    LEFT JOIN directives d ON d.id = a.directive_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, assignmentId) || null;
}

function currentRows(database, assignmentId) {
  return database.all(`
    SELECT ae.person_id, ae.executor_raw, ae.role, p.display_name
    FROM assignment_executors ae
    LEFT JOIN people p ON p.id = ae.person_id
    WHERE ae.assignment_id = ?
    ORDER BY CASE ae.role
      WHEN 'executor' THEN 1 WHEN 'coexecutor' THEN 2
      WHEN 'controller' THEN 3 WHEN 'observer' THEN 4 ELSE 5 END,
      COALESCE(p.display_name, ae.executor_raw)
  `, assignmentId);
}

function roleValue(rows, role) {
  return rows.find((row) => row.role === role) || null;
}

function roleValues(rows, role) {
  return rows.filter((row) => row.role === role);
}

function compactState(base, rows) {
  return {
    assignmentId: base.id,
    directiveId: base.directive_id,
    delegatorRaw: base.delegator_raw || null,
    executor: roleValue(rows, 'executor'),
    coexecutors: roleValues(rows, 'coexecutor'),
    controller: roleValue(rows, 'controller'),
    observers: roleValues(rows, 'observer')
  };
}

function history(database, workspaceId, assignmentId) {
  return database.all(`
    SELECT id, actor, details_json, created_at
    FROM audit_log
    WHERE workspace_id = ? AND subject_kind = 'assignment' AND subject_id = ?
      AND action = 'assignment.responsibility_changed'
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `, workspaceId, assignmentId).map((row) => ({
    id: row.id,
    actor: row.actor,
    createdAt: row.created_at,
    ...parseJson(row.details_json, {})
  }));
}

export function getAssignmentResponsibility(database, workspaceId, assignmentId) {
  const base = assignmentBase(database, workspaceId, assignmentId);
  if (!base) return null;
  return {
    ...compactState(base, currentRows(database, assignmentId)),
    history: history(database, workspaceId, assignmentId)
  };
}

function person(database, workspaceId, personId) {
  if (!personId) return null;
  return database.get(`
    SELECT id, display_name FROM people
    WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, personId) || null;
}

function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function resolveRequestedPeople(database, workspaceId, body) {
  const executor = body.executorPersonId ? person(database, workspaceId, body.executorPersonId) : null;
  if (body.executorPersonId && !executor) throw new Error('responsibility_person_invalid');
  const controller = body.controllerPersonId ? person(database, workspaceId, body.controllerPersonId) : null;
  if (body.controllerPersonId && !controller) throw new Error('responsibility_person_invalid');

  const resolveList = (ids) => uniqueIds(ids).map((id) => {
    const row = person(database, workspaceId, id);
    if (!row) throw new Error('responsibility_person_invalid');
    return row;
  });
  return {
    executor,
    coexecutors: resolveList(body.coexecutorPersonIds),
    controller,
    observers: resolveList(body.observerPersonIds)
  };
}

function insertRole(database, assignmentId, row, role, now) {
  if (!row) return;
  database.run(`
    INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, assignmentId, row.id, row.display_name, role, now);
}

function resolveExecutorReviews(database, workspaceId, assignmentId, now, actorPersonId) {
  database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE workspace_id = ? AND source_kind = 'assignment' AND source_id = ?
      AND status = 'open'
      AND (issue_code = 'executor_missing' OR issue_code = 'executor_unresolved')
  `, now, JSON.stringify({ action: 'responsibility_updated', actorPersonId: actorPersonId || null }),
  workspaceId, assignmentId);
}

function ensureMissingExecutorReview(database, workspaceId, assignmentId, now) {
  const exists = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_kind = 'assignment' AND source_id = ?
      AND issue_code = 'executor_missing' AND status = 'open'
  `, workspaceId, assignmentId);
  if (exists) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title, explanation,
      proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'assignment', ?, 'executor_missing',
      'У поручения не определён основной исполнитель',
      'Основной исполнитель был снят при изменении ответственности. Поручение сохранено.',
      'Назначьте основного исполнителя.', 'warning', 'open', '{}', ?)
  `, newId('review'), workspaceId, assignmentId, now);
}

export function updateAssignmentResponsibility(database, workspaceId, assignmentId, body, {
  actorPersonId = null,
  now = new Date().toISOString()
} = {}) {
  const base = assignmentBase(database, workspaceId, assignmentId);
  if (!base) return null;
  const reason = String(body.reason || '').trim();
  if (reason.length < 3) throw new Error('responsibility_reason_required');
  const requested = resolveRequestedPeople(database, workspaceId, body);
  const before = compactState(base, currentRows(database, assignmentId));

  database.transaction(() => {
    database.run(`
      DELETE FROM assignment_executors
      WHERE assignment_id = ? AND role IN (${EDITABLE_ROLES.map(() => '?').join(',')})
    `, assignmentId, ...EDITABLE_ROLES);
    insertRole(database, assignmentId, requested.executor, 'executor', now);
    for (const item of requested.coexecutors) insertRole(database, assignmentId, item, 'coexecutor', now);
    insertRole(database, assignmentId, requested.controller, 'controller', now);
    for (const item of requested.observers) insertRole(database, assignmentId, item, 'observer', now);

    if (requested.executor) resolveExecutorReviews(database, workspaceId, assignmentId, now, actorPersonId);
    else ensureMissingExecutorReview(database, workspaceId, assignmentId, now);

    const after = compactState(base, currentRows(database, assignmentId));
    database.run(`
      INSERT INTO audit_log(
        id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
      ) VALUES (?, ?, ?, 'assignment.responsibility_changed', 'assignment', ?, ?, ?)
    `, newId('audit'), workspaceId, actorPersonId ? `person:${actorPersonId}` : 'operator',
    assignmentId, JSON.stringify({ reason, before, after, actorPersonId }), now);
  });

  return getAssignmentResponsibility(database, workspaceId, assignmentId);
}
