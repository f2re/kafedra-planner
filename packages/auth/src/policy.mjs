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

export function listManagedPeople(database, workspaceId, managerId) {
  if (!managerId) return [];
  return database.all(`
    WITH RECURSIVE managed(id, display_name, email, position, manager_id, depth, path) AS (
      SELECT p.id, p.display_name, p.email, p.position, p.manager_id, 1,
        ',' || p.id || ','
      FROM people p
      WHERE p.workspace_id = ? AND p.manager_id = ? AND p.status = 'active'
      UNION ALL
      SELECT p.id, p.display_name, p.email, p.position, p.manager_id,
        managed.depth + 1, managed.path || p.id || ','
      FROM people p
      JOIN managed ON p.manager_id = managed.id
      WHERE p.workspace_id = ? AND p.status = 'active'
        AND managed.depth < 32
        AND instr(managed.path, ',' || p.id || ',') = 0
    )
    SELECT id, display_name, email, position, manager_id, depth
    FROM managed
    ORDER BY depth, display_name
  `, workspaceId, managerId, workspaceId);
}

export function managesPerson(database, workspaceId, managerId, personId) {
  if (!managerId || !personId || managerId === personId) return false;
  return listManagedPeople(database, workspaceId, managerId)
    .some((item) => item.id === personId);
}

export function assertPersonScope(database, workspaceId, context, personId) {
  requireAuthenticated(context);
  if (!personId) throw new AppError('person_id_required', 'Выберите сотрудника.', 400);
  if (!context.enabled || context.role === 'admin' || context.personId === personId) return true;
  if (
    context.role === 'manager'
    && managesPerson(database, workspaceId, context.personId, personId)
  ) return true;
  throw new AppError('person_scope_forbidden', 'Нет доступа к данным этого сотрудника.', 403);
}

export function assertAssignmentScope(database, workspaceId, context, assignmentId) {
  requireAuthenticated(context);
  if (!context.enabled || context.role === 'admin') return true;
  const rows = database.all(`
    SELECT ae.person_id, ae.role
    FROM assignments a
    LEFT JOIN assignment_executors ae ON ae.assignment_id = a.id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, assignmentId);
  if (!rows.length) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
  if (rows.some((row) => row.person_id === context.personId)) return true;
  if (context.role === 'manager') {
    const controls = rows.some(
      (row) => row.role === 'controller' && row.person_id === context.personId
    );
    const managesExecutor = rows.some(
      (row) => row.person_id
        && managesPerson(database, workspaceId, context.personId, row.person_id)
    );
    if (controls || managesExecutor) return true;
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
  if (scoped.ownerPersonId) {
    assertPersonScope(database, workspaceId, context, scoped.ownerPersonId);
  }
  if (scoped.managerPersonId && scoped.managerPersonId !== context.personId) {
    throw new AppError(
      'manager_scope_forbidden',
      'Руководитель может открыть только собственную зону контроля.',
      403
    );
  }
  if (!scoped.ownerPersonId && !scoped.managerPersonId) {
    scoped.managerPersonId = context.personId;
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
  throw new AppError(
    'view_forbidden',
    deleteMode
      ? 'Удалить это представление может только его владелец или администратор.'
      : 'Нет доступа к этому представлению.',
    403
  );
}

export function authorizeApiRequest(context, path) {
  if (path === '/api/system/health' || path.startsWith('/api/auth/')) return true;
  return requireAuthenticated(context);
}
