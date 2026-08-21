import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { assertPersonScope, requireRole } from '../../../packages/auth/src/policy.mjs';
import {
  assignUnitManager, cancelAppointment, createAppointment, createOrganizationPosition,
  createOrganizationUnit, endAppointment, endUnitManager, getOrganizationUnit,
  listAppointments, listOrganizationPositions, listOrganizationUnits, listUnitManagers,
  organizationSnapshotAt, resolvePersonOrganizationAt, updateAppointment,
  updateOrganizationPosition, updateOrganizationUnit
} from '../../../packages/organization/src/service.mjs';
import {
  refreshDerivedScientificAffiliations, safelyClosePreviousPrimary,
  syncPersonCompatibility, syncUnitManagerCompatibility
} from '../../../packages/organization/src/compatibility.mjs';
import {
  listScientificAuthorAffiliations, setScientificAuthorAffiliation
} from '../../../packages/organization/src/affiliations.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (workspace) return workspace;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

function requireView(context) {
  if (!context?.enabled) return true;
  return requireRole(context, ['manager', 'admin']);
}

function requireManage(context) {
  if (!context?.enabled) return true;
  return requireRole(context, 'admin');
}

function boolParam(url, name) {
  return ['1', 'true', 'yes'].includes(String(url.searchParams.get(name) || '').toLowerCase());
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
    organization_manager_not_found: ['Назначение руководителя не найдено.', 404],
    organization_change_reason_required: ['Укажите причину исправления аффилиации.', 400],
    scientific_author_not_found: ['Автор не найден в научной карточке.', 404]
  };
  const [message, status] = messages[code] || ['Не удалось выполнить операцию с организационной структурой.', 500];
  return new AppError(code, message, status, cause?.details);
}

function scientificItemExists(database, workspaceId, itemId) {
  return database.get('SELECT id FROM scientific_items WHERE workspace_id = ? AND id = ?', workspaceId, itemId);
}

export function createOrganizationRouter({ database }) {
  return async function routeOrganization(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const personPath = /^\/api\/people\/[^/]+\/organization$/u.test(path);
    const sciencePath = /^\/api\/organization\/science\/[^/]+\/affiliations(?:\/[^/]+)?$/u.test(path);
    if (!path.startsWith('/api/organization') && !personPath && !sciencePath) return false;
    const workspace = workspaceOf(database, request);
    const context = request.auth;
    const actorPersonId = context?.personId || null;

    try {
      const personMatch = path.match(/^\/api\/people\/([^/]+)\/organization$/u);
      if (personMatch && method === 'GET') {
        const personId = decodeURIComponent(personMatch[1]);
        if (context?.enabled) assertPersonScope(database, workspace.id, context, personId);
        sendJson(response, 200, resolvePersonOrganizationAt(
          database, workspace.id, personId,
          url.searchParams.get('at') || new Date().toISOString().slice(0, 10)
        ));
        return true;
      }

      const affiliationMatch = path.match(/^\/api\/organization\/science\/([^/]+)\/affiliations(?:\/([^/]+))?$/u);
      if (affiliationMatch) {
        const scientificItemId = decodeURIComponent(affiliationMatch[1]);
        if (!scientificItemExists(database, workspace.id, scientificItemId)) {
          throw new AppError('scientific_item_not_found', 'Научный материал не найден.', 404);
        }
        assertObjectAccess(database, workspace.id, context, 'scientific_item', scientificItemId, method === 'GET' ? 'read' : 'edit');
        if (method === 'GET' && !affiliationMatch[2]) {
          sendJson(response, 200, { items: listScientificAuthorAffiliations(database, workspace.id, scientificItemId) });
          return true;
        }
        if (method === 'PUT' && affiliationMatch[2]) {
          requireManage(context);
          const body = await readJson(request);
          const items = database.transaction(() => setScientificAuthorAffiliation(
            database, workspace.id, scientificItemId, decodeURIComponent(affiliationMatch[2]), body, actorPersonId
          ));
          sendJson(response, 200, { items });
          return true;
        }
      }

      requireView(context);
      if (method === 'GET' && path === '/api/organization/units') {
        sendJson(response, 200, { items: listOrganizationUnits(database, workspace.id, { includeArchived: boolParam(url, 'includeArchived') }) });
        return true;
      }
      if (method === 'POST' && path === '/api/organization/units') {
        requireManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => createOrganizationUnit(database, workspace.id, body, actorPersonId));
        sendJson(response, 201, item, { location: `/api/organization/units/${item.id}` });
        return true;
      }
      const unitMatch = path.match(/^\/api\/organization\/units\/([^/]+)$/u);
      if (unitMatch && method === 'GET') {
        const item = getOrganizationUnit(database, workspace.id, decodeURIComponent(unitMatch[1]));
        if (!item) throw new AppError('organization_unit_not_found', 'Подразделение не найдено.', 404);
        sendJson(response, 200, item); return true;
      }
      if (unitMatch && method === 'PATCH') {
        requireManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => updateOrganizationUnit(database, workspace.id, decodeURIComponent(unitMatch[1]), body, actorPersonId));
        sendJson(response, 200, item); return true;
      }

      if (method === 'GET' && path === '/api/organization/positions') {
        sendJson(response, 200, { items: listOrganizationPositions(database, workspace.id, { includeArchived: boolParam(url, 'includeArchived') }) });
        return true;
      }
      if (method === 'POST' && path === '/api/organization/positions') {
        requireManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => createOrganizationPosition(database, workspace.id, body, actorPersonId));
        sendJson(response, 201, item, { location: `/api/organization/positions/${item.id}` }); return true;
      }
      const positionMatch = path.match(/^\/api\/organization\/positions\/([^/]+)$/u);
      if (positionMatch && method === 'PATCH') {
        requireManage(context);
        const body = await readJson(request);
        const item = database.transaction(() => updateOrganizationPosition(database, workspace.id, decodeURIComponent(positionMatch[1]), body, actorPersonId));
        sendJson(response, 200, item); return true;
      }

      if (method === 'GET' && path === '/api/organization/appointments') {
        sendJson(response, 200, { items: listAppointments(database, workspace.id, {
          personId: url.searchParams.get('personId'), organizationUnitId: url.searchParams.get('organizationUnitId'),
          at: url.searchParams.get('at'), includeEnded: boolParam(url, 'includeEnded')
        }) });
        return true;
      }
      if (method === 'POST' && path === '/api/organization/appointments') {
        requireManage(context);
        const body = await readJson(request);
        const now = new Date().toISOString();
        const item = database.transaction(() => {
          safelyClosePreviousPrimary(database, workspace.id, body, now);
          const created = createAppointment(database, workspace.id, body, actorPersonId, now);
          syncPersonCompatibility(database, workspace.id, created.person_id, now);
          refreshDerivedScientificAffiliations(database, workspace.id, created.person_id, now);
          return created;
        });
        sendJson(response, 201, item, { location: `/api/organization/appointments/${item.id}` }); return true;
      }
      const appointmentMatch = path.match(/^\/api\/organization\/appointments\/([^/]+)$/u);
      if (appointmentMatch && method === 'PATCH') {
        requireManage(context);
        const body = await readJson(request);
        const now = new Date().toISOString();
        const item = database.transaction(() => {
          const updated = updateAppointment(database, workspace.id, decodeURIComponent(appointmentMatch[1]), body, actorPersonId, now);
          syncPersonCompatibility(database, workspace.id, updated.person_id, now);
          refreshDerivedScientificAffiliations(database, workspace.id, updated.person_id, now);
          return updated;
        });
        sendJson(response, 200, item); return true;
      }
      const endAppointmentMatch = path.match(/^\/api\/organization\/appointments\/([^/]+)\/end$/u);
      if (endAppointmentMatch && method === 'POST') {
        requireManage(context);
        const body = await readJson(request);
        const now = new Date().toISOString();
        const item = database.transaction(() => {
          const ended = endAppointment(database, workspace.id, decodeURIComponent(endAppointmentMatch[1]), body, actorPersonId, now);
          syncPersonCompatibility(database, workspace.id, ended.person_id, now);
          refreshDerivedScientificAffiliations(database, workspace.id, ended.person_id, now);
          return ended;
        });
        sendJson(response, 200, item); return true;
      }
      const cancelAppointmentMatch = path.match(/^\/api\/organization\/appointments\/([^/]+)\/cancel$/u);
      if (cancelAppointmentMatch && method === 'POST') {
        requireManage(context);
        const body = await readJson(request);
        const now = new Date().toISOString();
        const item = database.transaction(() => {
          const cancelled = cancelAppointment(database, workspace.id, decodeURIComponent(cancelAppointmentMatch[1]), body, actorPersonId, now);
          syncPersonCompatibility(database, workspace.id, cancelled.person_id, now);
          refreshDerivedScientificAffiliations(database, workspace.id, cancelled.person_id, now);
          return cancelled;
        });
        sendJson(response, 200, item); return true;
      }

      if (method === 'GET' && path === '/api/organization/managers') {
        sendJson(response, 200, { items: listUnitManagers(database, workspace.id, {
          organizationUnitId: url.searchParams.get('organizationUnitId'), personId: url.searchParams.get('personId'),
          at: url.searchParams.get('at'), includeEnded: boolParam(url, 'includeEnded')
        }) });
        return true;
      }
      if (method === 'POST' && path === '/api/organization/managers') {
        requireManage(context);
        const body = await readJson(request);
        const now = new Date().toISOString();
        const item = database.transaction(() => {
          const created = assignUnitManager(database, workspace.id, body, actorPersonId, now);
          syncUnitManagerCompatibility(database, workspace.id, created.organization_unit_id, null, now);
          return created;
        });
        sendJson(response, 201, item, { location: `/api/organization/managers/${item.id}` }); return true;
      }
      const endManagerMatch = path.match(/^\/api\/organization\/managers\/([^/]+)\/end$/u);
      if (endManagerMatch && method === 'POST') {
        requireManage(context);
        const body = await readJson(request);
        const id = decodeURIComponent(endManagerMatch[1]);
        const before = listUnitManagers(database, workspace.id, { includeEnded: true }).find((item) => item.id === id);
        const now = new Date().toISOString();
        const item = database.transaction(() => {
          const ended = endUnitManager(database, workspace.id, id, body, actorPersonId, now);
          syncUnitManagerCompatibility(database, workspace.id, ended.organization_unit_id, before?.person_id || null, now);
          return ended;
        });
        sendJson(response, 200, item); return true;
      }

      if (method === 'GET' && path === '/api/organization/snapshot') {
        sendJson(response, 200, organizationSnapshotAt(database, workspace.id,
          url.searchParams.get('at') || new Date().toISOString().slice(0, 10)));
        return true;
      }
      return false;
    } catch (cause) {
      throw mappedError(cause);
    }
  };
}
