import { AppError } from '../../../packages/core/src/errors.mjs';
import { assertPersonScope, requireRole } from '../../../packages/auth/src/policy.mjs';
import {
  createOrganizationPosition,
  createOrganizationUnit,
  createPersonAppointment,
  listPersonAppointments,
  organizationSnapshot,
  resolvePersonAppointment,
  setScientificAuthorAffiliation,
  updateOrganizationPosition,
  updateOrganizationUnit,
  updatePersonAppointment
} from '../../../packages/organization/src/service.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function organizationError(error) {
  if (error instanceof AppError) return error;
  const code = String(error?.code || error?.message || error);
  const messages = {
    organization_date_invalid: ['Проверьте дату начала или окончания периода.', 400],
    organization_period_invalid: ['Дата окончания не может быть раньше даты начала.', 400],
    organization_parent_period_mismatch: ['Период подразделения должен входить в период действия родительского подразделения.', 409],
    organization_unit_period_mismatch: ['Период назначения должен входить в период действия подразделения.', 409],
    organization_unit_children_period_mismatch: ['Сначала скорректируйте периоды дочерних подразделений.', 409],
    organization_unit_appointments_period_mismatch: ['Сначала скорректируйте назначения сотрудников этого подразделения.', 409],
    organization_unit_inactive: ['Это подразделение закрыто и недоступно для нового назначения.', 409],
    organization_position_inactive: ['Эта должность отключена и недоступна для нового назначения.', 409],
    organization_position_in_use: ['Должность используется в действующих назначениях.', 409],
    organization_status_invalid: ['Выберите корректное состояние записи.', 400],
    organization_unit_name_required: ['Укажите название подразделения.', 400],
    organization_unit_kind_invalid: ['Выберите вид подразделения.', 400],
    organization_unit_not_found: ['Подразделение не найдено.', 404],
    organization_unit_parent_not_found: ['Родительское подразделение не найдено.', 404],
    organization_unit_parent_self: ['Подразделение не может быть родителем самого себя.', 409],
    organization_unit_cycle: ['Такое перемещение создаст цикл в структуре.', 409],
    organization_unit_duplicate: ['Такое подразделение уже существует в выбранном периоде.', 409],
    organization_position_name_required: ['Укажите название должности.', 400],
    organization_position_not_found: ['Должность не найдена.', 404],
    organization_position_duplicate: ['Такая должность уже есть в справочнике.', 409],
    organization_person_not_found: ['Сотрудник не найден.', 404],
    organization_manager_not_found: ['Выбранный руководитель не найден.', 404],
    organization_manager_self: ['Сотрудник не может руководить сам собой.', 409],
    organization_manager_cycle: ['Такое назначение создаст цикл руководителей.', 409],
    organization_appointment_kind_invalid: ['Выберите основное или дополнительное назначение.', 400],
    organization_appointment_not_found: ['Назначение не найдено.', 404],
    organization_appointment_overlap: ['У сотрудника уже есть основное назначение на этот период.', 409],
    organization_source_document_not_found: ['Документ-основание не найден.', 404],
    organization_change_reason_required: ['Кратко укажите причину исправления периода или назначения.', 400],
    scientific_item_not_found: ['Научный материал не найден.', 404],
    scientific_author_not_found: ['Автор не найден в научной карточке.', 404]
  };
  const [message, status] = messages[code] || ['Не удалось сохранить организационную структуру.', 500];
  return new AppError(code, message, status, error?.details);
}

function admin(context) {
  if (!context?.enabled) return true;
  requireRole(context, 'admin');
  return true;
}

export function createOrganizationRouter({ database }) {
  return async function routeOrganization(request, response, url) {
    const path = url.pathname;
    const method = request.method || 'GET';
    const relevant = path.startsWith('/api/organization')
      || /^\/api\/people\/[^/]+\/(appointments|organization)$/u.test(path)
      || /^\/api\/appointments\/[^/]+$/u.test(path)
      || /^\/api\/science\/[^/]+\/authors\/[^/]+\/affiliation$/u.test(path);
    if (!relevant) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const context = request.auth || { enabled: false };
    const actorPersonId = context.personId || null;

    try {
      if (path === '/api/organization') {
        if (method !== 'GET') return false;
        return sendJson(response, 200, organizationSnapshot(database, workspace, {
          asOf: url.searchParams.get('asOf') || undefined,
          includeInactive: url.searchParams.get('includeInactive') === '1'
        }));
      }

      if (path === '/api/organization/units' && method === 'POST') {
        admin(context);
        return sendJson(response, 201, createOrganizationUnit(
          database, workspace, await readJson(request), actorPersonId
        ));
      }
      const unitMatch = path.match(/^\/api\/organization\/units\/([^/]+)$/u);
      if (unitMatch && method === 'PATCH') {
        admin(context);
        return sendJson(response, 200, updateOrganizationUnit(
          database, workspace, decodeURIComponent(unitMatch[1]), await readJson(request), actorPersonId
        ));
      }

      if (path === '/api/organization/positions' && method === 'POST') {
        admin(context);
        return sendJson(response, 201, createOrganizationPosition(
          database, workspace, await readJson(request), actorPersonId
        ));
      }
      const positionMatch = path.match(/^\/api\/organization\/positions\/([^/]+)$/u);
      if (positionMatch && method === 'PATCH') {
        admin(context);
        return sendJson(response, 200, updateOrganizationPosition(
          database, workspace, decodeURIComponent(positionMatch[1]), await readJson(request), actorPersonId
        ));
      }

      const peopleMatch = path.match(/^\/api\/people\/([^/]+)\/(appointments|organization)$/u);
      if (peopleMatch) {
        const personId = decodeURIComponent(peopleMatch[1]);
        if (method === 'GET') {
          if (context.enabled) assertPersonScope(database, workspace, context, personId);
          if (peopleMatch[2] === 'appointments') {
            return sendJson(response, 200, { items: listPersonAppointments(database, workspace, personId) });
          }
          return sendJson(response, 200, {
            asOf: url.searchParams.get('asOf') || new Date().toISOString().slice(0, 10),
            appointment: resolvePersonAppointment(
              database, workspace, personId, url.searchParams.get('asOf') || undefined, { kind: null }
            )
          });
        }
        if (method === 'POST' && peopleMatch[2] === 'appointments') {
          admin(context);
          return sendJson(response, 201, createPersonAppointment(
            database, workspace, personId, await readJson(request), actorPersonId
          ));
        }
        return false;
      }

      const appointmentMatch = path.match(/^\/api\/appointments\/([^/]+)$/u);
      if (appointmentMatch && method === 'PATCH') {
        admin(context);
        return sendJson(response, 200, updatePersonAppointment(
          database, workspace, decodeURIComponent(appointmentMatch[1]), await readJson(request), actorPersonId
        ));
      }

      const affiliationMatch = path.match(/^\/api\/science\/([^/]+)\/authors\/([^/]+)\/affiliation$/u);
      if (affiliationMatch && method === 'PUT') {
        admin(context);
        return sendJson(response, 200, {
          items: setScientificAuthorAffiliation(
            database,
            workspace,
            decodeURIComponent(affiliationMatch[1]),
            decodeURIComponent(affiliationMatch[2]),
            await readJson(request),
            actorPersonId
          )
        });
      }
      return false;
    } catch (error) {
      throw organizationError(error);
    }
  };
}
