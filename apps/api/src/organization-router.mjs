import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  assignUnitManager,
  cancelAppointment,
  createAppointment,
  createOrganizationPosition,
  createOrganizationUnit,
  endAppointment,
  endUnitManager,
  getOrganizationUnit,
  listAppointments,
  listOrganizationPositions,
  listOrganizationUnits,
  listUnitManagers,
  organizationSnapshotAt,
  resolvePersonOrganizationAt,
  updateAppointment,
  updateOrganizationPosition,
  updateOrganizationUnit
} from '../../../packages/organization/src/service.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const item = database.get('SELECT * FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (item) return item;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const item = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (item) return item;
  }
  const item = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!item) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return item;
}

function assertRead(context) {
  if (context?.enabled && !context.authenticated) {
    throw new AppError('organization_access_forbidden', 'Войдите в систему, чтобы открыть структуру.', 401);
  }
}

function assertManage(context) {
  if (!context?.enabled) return;
  if (!context.authenticated) {
    throw new AppError('organization_access_forbidden', 'Войдите в систему, чтобы изменить структуру.', 401);
  }
  if (!['admin', 'manager'].includes(context.role)) {
    throw new AppError('organization_access_forbidden', 'Изменять структуру может администратор или руководитель.', 403);
  }
}

function mappedError(cause) {
  if (cause instanceof AppError) return cause;
  const code = String(cause?.code || cause?.message || cause);
  const messages = {
    organization_code_required: ['Укажите короткий код.', 400],
    organization_date_required: ['Укажите дату начала периода.', 400],
    organization_date_invalid: ['Проверьте указанную дату.', 400],
    organization_period_invalid: ['Дата окончания не может быть раньше даты начала.', 400],
    organization_person_not_found: ['Сотрудник не найден.', 404],
    organization_unit_not_found: ['Подразделение не найдено или архивировано.', 404],
    organization_position_not_found: ['Должность не найдена или архивирована.', 404],
    organization_unit_cycle: ['Нельзя переместить подразделение внутрь самого себя или дочернего подразделения.', 409],
    organization_unit_name_required: ['Укажите название подразделения.', 400],
    organization_unit_code_exists: ['Подразделение с таким кодом уже существует.', 409],
    organization_unit_has_active_children: ['Сначала перенесите или архивируйте дочерние подразделения.', 409],
    organization_unit_has_active_appointments: ['Сначала завершите действующие назначения сотрудников.', 409],
    organization_position_name_required: ['Укажите название должности.', 400],
    organization_position_code_exists: ['Должность с таким кодом уже существует.', 409],
    organization_position_has_active_appointments: ['Сначала завершите назначения на эту должность.', 409],
    organization_appointment_position_required: ['Выберите должность или укажите её название.', 400],
    organization_workload_invalid: ['Ставка должна быть больше нуля и не превышать 1,5.', 400],
    organization_primary_appointment_overlap: ['У сотрудника уже есть основное назначение в этот период.', 409],
    organization_appointment_not_found: ['Назначение не найдено.', 404],
    organization_appointment_cancelled: ['Отменённое назначение нельзя изменить.', 409],
    organization_manager_period_overlap: ['В этот период у подразделения уже назначен руководитель.', 409],
    organization_manager_appointment_invalid: ['Назначение относится к другому сотруднику или подразделению.', 409],
    organization_manager_not_found: ['Назначение руководителя не найдено.', 404]
  };
  const [message, status] = messages[code] || ['Не удалось выполнить операцию с организационной структурой.', 500];
  return new AppError(code, message, status, cause?.details);
}

function boolParam(url, name) {
  return ['1', 'true', 'yes'].includes(String(url.searchParams.get(name) || '').toLowerCase());
}

export function createOrganizationRouter({ database }) {
  return async function routeOrganization(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const personPath = /^\/api\/people\/[^/]+\/organization$/u.test(path);
    if (!path.startsWith('/api/organization') && !personPath) return false;

    const workspace = workspaceOf(database, request);
    const context = request.auth;
    const actorPersonId = context?.personId || null;

    try {
      if (method === 'GET' && path === '/api/organization/units') {
        assertRead(context);
        return sendJson(response, 200, { items: listOrganizationUnits(database, workspace.id, {
          includeArchived: boolParam(url, 'includeArchived')
        }) });
      }
      if (method === 'POST' && path === '/api/organization/units') {
        assertManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => createOrganizationUnit(database, workspace.id, body, actorPersonId));
        return sendJson(response, 201, item, { location: `/api/organization/units/${item.id}` });
      }
      const unitMatch = path.match(/^\/api\/organization\/units\/([^/]+)$/u);
      if (unitMatch && method === 'GET') {
        assertRead(context);
        const item = getOrganizationUnit(database, workspace.id, decodeURIComponent(unitMatch[1]));
        if (!item) throw new AppError('organization_unit_not_found', 'Подразделение не найдено.', 404);
        return sendJson(response, 200, item);
      }
      if (unitMatch && method === 'PATCH') {
        assertManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => updateOrganizationUnit(
          database, workspace.id, decodeURIComponent(unitMatch[1]), body, actorPersonId
        ));
        return sendJson(response, 200, item);
      }

      if (method === 'GET' && path === '/api/organization/positions') {
        assertRead(context);
        return sendJson(response, 200, { items: listOrganizationPositions(database, workspace.id, {
          includeArchived: boolParam(url, 'includeArchived')
        }) });
      }
      if (method === 'POST' && path === '/api/organization/positions') {
        assertManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => createOrganizationPosition(database, workspace.id, body, actorPersonId));
        return sendJson(response, 201, item, { location: `/api/organization/positions/${item.id}` });
      }
      const positionMatch = path.match(/^\/api\/organization\/positions\/([^/]+)$/u);
      if (positionMatch && method === 'PATCH') {
        assertManage(context);
        const body = await readJson(request);
        return sendJson(response, 200, database.transaction(() => updateOrganizationPosition(
          database, workspace.id, decodeURIComponent(positionMatch[1]), body, actorPersonId
        )));
      }

      if (method === 'GET' && path === '/api/organization/appointments') {
        assertRead(context);
        return sendJson(response, 200, { items: listAppointments(database, workspace.id, {
          personId: url.searchParams.get('personId'),
          organizationUnitId: url.searchParams.get('organizationUnitId'),
          at: url.searchParams.get('at'),
          includeEnded: boolParam(url, 'includeEnded')
        }) });
      }
      if (method === 'POST' && path === '/api/organization/appointments') {
        assertManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => createAppointment(database, workspace.id, body, actorPersonId));
        return sendJson(response, 201, item, { location: `/api/organization/appointments/${item.id}` });
      }
      const appointmentMatch = path.match(/^\/api\/organization\/appointments\/([^/]+)$/u);
      if (appointmentMatch && method === 'PATCH') {
        assertManage(context);
        const body = await readJson(request);
        return sendJson(response, 200, database.transaction(() => updateAppointment(
          database, workspace.id, decodeURIComponent(appointmentMatch[1]), body, actorPersonId
        )));
      }
      const endAppointmentMatch = path.match(/^\/api\/organization\/appointments\/([^/]+)\/end$/u);
      if (endAppointmentMatch && method === 'POST') {
        assertManage(context);
        const body = await readJson(request);
        return sendJson(response, 200, database.transaction(() => endAppointment(
          database, workspace.id, decodeURIComponent(endAppointmentMatch[1]), body, actorPersonId
        )));
      }
      const cancelAppointmentMatch = path.match(/^\/api\/organization\/appointments\/([^/]+)\/cancel$/u);
      if (cancelAppointmentMatch && method === 'POST') {
        assertManage(context);
        const body = await readJson(request);
        return sendJson(response, 200, database.transaction(() => cancelAppointment(
          database, workspace.id, decodeURIComponent(cancelAppointmentMatch[1]), body, actorPersonId
        )));
      }

      if (method === 'GET' && path === '/api/organization/managers') {
        assertRead(context);
        return sendJson(response, 200, { items: listUnitManagers(database, workspace.id, {
          organizationUnitId: url.searchParams.get('organizationUnitId'),
          personId: url.searchParams.get('personId'),
          at: url.searchParams.get('at'),
          includeEnded: boolParam(url, 'includeEnded')
        }) });
      }
      if (method === 'POST' && path === '/api/organization/managers') {
        assertManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => assignUnitManager(database, workspace.id, body, actorPersonId));
        return sendJson(response, 201, item, { location: `/api/organization/managers/${item.id}` });
      }
      const endManagerMatch = path.match(/^\/api\/organization\/managers\/([^/]+)\/end$/u);
      if (endManagerMatch && method === 'POST') {
        assertManage(context);
        const body = await readJson(request);
        return sendJson(response, 200, database.transaction(() => endUnitManager(
          database, workspace.id, decodeURIComponent(endManagerMatch[1]), body, actorPersonId
        )));
      }

      if (method === 'GET' && path === '/api/organization/snapshot') {
        assertRead(context);
        return sendJson(response, 200, organizationSnapshotAt(
          database, workspace.id, url.searchParams.get('at') || new Date().toISOString().slice(0, 10)
        ));
      }
      const personMatch = path.match(/^\/api\/people\/([^/]+)\/organization$/u);
      if (personMatch && method === 'GET') {
        assertRead(context);
        return sendJson(response, 200, resolvePersonOrganizationAt(
          database, workspace.id, decodeURIComponent(personMatch[1]),
          url.searchParams.get('at') || new Date().toISOString().slice(0, 10)
        ));
      }
      return false;
    } catch (cause) {
      throw mappedError(cause);
    }
  };
}
