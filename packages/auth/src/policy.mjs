import { AppError } from '../../core/src/errors.mjs';

export function requireSession(context) {
  if (!context?.authenticated) {
    throw new AppError('authentication_required', 'Требуется вход в систему.', 401);
  }
  return context;
}

export function requireAuthenticated(context) {
  requireSession(context);
  if (context.mustChangePassword) {
    throw new AppError('password_change_required', 'Сначала смените временный пароль.', 403);
  }
  return context;
}

export function requireRole(context, allowed) {
  requireAuthenticated(context);
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  if (!roles.includes(context.role)) {
    throw new AppError('forbidden', 'Недостаточно прав для этого действия.', 403);
  }
  return context;
}

function directReport(database, workspaceId, managerId, personId) {
  if (!managerId || !personId) return false;
  return Boolean(database.get(`
    SELECT 1 AS present FROM people
    WHERE workspace_id = ? AND id = ? AND manager_id = ? AND status = 'active'
  `, workspaceId, personId, managerId));
}

export function assertPersonScope(database, workspaceId, context, personId) {
  requireAuthenticated(context);
  if (!personId) throw new AppError('person_id_required', 'Выберите сотрудника.', 400);
  if (!context.enabled || context.role === 'admin' || context.personId === personId) return true;
  if (context.role === 'manager' && directReport(database, workspaceId, context.personId, personId)) return true;
  throw new AppError('person_scope_forbidden', 'Нет доступа к данным этого сотрудника.', 403);
}

export function assertAssignmentScope(database, workspaceId, context, assignmentId) {
  requireAuthenticated(context);
  if (!context.enabled || context.role === 'admin') return true;
  const rows = database.all(`
    SELECT ae.person_id, ae.role, p.manager_id
    FROM assignments a
    LEFT JOIN assignment_executors ae ON ae.assignment_id = a.id
    LEFT JOIN people p ON p.id = ae.person_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, assignmentId);
  if (!rows.length) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
  const own = rows.some((row) => row.person_id === context.personId);
  if (own) return true;
  if (context.role === 'manager') {
    const controls = rows.some((row) => row.role === 'controller' && row.person_id === context.personId);
    const manages = rows.some((row) => row.manager_id === context.personId);
    if (controls || manages) return true;
  }
  throw new AppError('assignment_scope_forbidden', 'Нет доступа к этому поручению.', 403);
}

export function requireAssignmentCorrection(database, workspaceId, context, assignmentId) {
  requireRole(context, ['manager', 'admin']);
  return assertAssignmentScope(database, workspaceId, context, assignmentId);
}

export function scopePlanFactFilters(database, workspaceId, context, filters) {
  requireAuthenticated(context);
  if (!context.enabled || context.role === 'admin') return { ...filters };
  const scoped = { ...filters };
  if (context.role === 'staff') {
    scoped.ownerPersonId = context.personId;
    scoped.managerPersonId = '';
    return scoped;
  }
  if (scoped.ownerPersonId) assertPersonScope(database, workspaceId, context, scoped.ownerPersonId);
  if (scoped.managerPersonId && scoped.managerPersonId !== context.personId) {
    throw new AppError('manager_scope_forbidden', 'Руководитель может открыть только собственную зону контроля.', 403);
  }
  return scoped;
}

export function requireSharedViewPermission(context) {
  return requireRole(context, ['manager', 'admin']);
}

export function assertViewScope(database, workspaceId, context, viewId, { deleteMode = false } = {}) {
  requireAuthenticated(context);
  const row = database.get(`
    SELECT * FROM plan_fact_saved_views WHERE workspace_id = ? AND id = ?
  `, workspaceId, viewId);
  if (!row) throw new AppError('view_not_found', 'Сохранённое представление не найдено.', 404);
  if (!context.enabled || context.role === 'admin') return row;
  if (row.owner_person_id === context.personId) return row;
  if (!deleteMode && row.is_shared) return row;
  throw new AppError('view_forbidden', deleteMode
    ? 'Удалить это представление может только его владелец или администратор.'
    : 'Нет доступа к этому представлению.', 403);
}

export function authorizeApiRequest(context, path) {
  if (path === '/api/system/health' || path.startsWith('/api/auth/')) return true;
  return requireAuthenticated(context);
}
