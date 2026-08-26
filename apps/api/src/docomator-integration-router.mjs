import { AppError } from '../../../packages/core/src/errors.mjs';
import { requireRole } from '../../../packages/auth/src/policy.mjs';
import {
  DocomatorIntegrationError,
  checkDocomatorConnection,
  getDocomatorSettings,
  importDocomatorPeople,
  recordDocomatorCheck,
  recordDocomatorFailure,
  saveDocomatorSettings
} from '../../../packages/integrations/src/docomator.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceId(database, request) {
  if (request.auth?.workspaceId) return request.auth.workspaceId;
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    return database.get('SELECT id FROM workspaces WHERE id = ? OR code = ?', requested, requested)?.id || null;
  }
  return database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')?.id || null;
}

function admin(context) {
  if (!context?.enabled) return true;
  requireRole(context, 'admin');
  return true;
}

function integrationError(error) {
  if (error instanceof AppError) return error;
  if (!(error instanceof DocomatorIntegrationError)) {
    return new AppError('docomator_integration_failed', 'Не удалось выполнить обмен с Оформлятором.', 500);
  }
  const messages = {
    docomator_scheme_invalid: ['Выберите HTTP или HTTPS.', 400],
    docomator_host_required: ['Укажите адрес сервера Оформлятора.', 400],
    docomator_host_invalid: ['Проверьте адрес сервера. Укажите только имя хоста или IP без пути.', 400],
    docomator_port_invalid: ['Порт должен быть целым числом от 1 до 65535.', 400],
    docomator_value_too_long: ['Одно из значений настройки слишком длинное.', 400],
    docomator_remote_id_required: ['Выберите пространство Оформлятора для импорта.', 400],
    docomator_access_code_invalid: ['Код доступа Оформлятора должен состоять из 4 цифр.', 400],
    docomator_auth_required: ['Оформлятор доступен, но для чтения сотрудников нужен код доступа.', 401],
    docomator_access_denied: ['Код доступа Оформлятора не подошёл.', 401],
    docomator_space_not_found: ['Выбранное пространство больше не найдено в Оформляторе. Обновите список.', 404],
    docomator_unreachable: ['Оформлятор не отвечает по указанному адресу и порту.', 502],
    docomator_remote_error: ['Оформлятор ответил ошибкой. Проверьте его состояние и выбранные данные.', 502],
    docomator_protocol_error: ['Оформлятор ответил в неожиданном формате. Проверьте совместимость версий.', 502]
  };
  const [message, status] = messages[error.code] || ['Не удалось выполнить обмен с Оформлятором.', 500];
  return new AppError(error.code, message, status, error.details);
}

function effectiveInput(saved, body = {}) {
  return {
    scheme: body.scheme ?? saved.scheme,
    host: body.host ?? saved.host,
    port: body.port ?? saved.port,
    spaceId: body.spaceId ?? saved.spaceId,
    groupId: Object.hasOwn(body, 'groupId') ? body.groupId : saved.groupId,
    includeInactive: Object.hasOwn(body, 'includeInactive') ? Boolean(body.includeInactive) : saved.includeInactive,
    accessCode: body.accessCode
  };
}

export function createDocomatorIntegrationRouter({ database }) {
  return async function routeDocomatorIntegration(request, response, url) {
    const path = url.pathname;
    const method = request.method || 'GET';
    if (!path.startsWith('/api/integrations/docomator')) return false;
    const workspace = workspaceId(database, request);
    if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
    const context = request.auth || { enabled: false };
    admin(context);

    try {
      if (path === '/api/integrations/docomator' && method === 'GET') {
        return sendJson(response, 200, getDocomatorSettings(database, workspace));
      }
      if (path === '/api/integrations/docomator' && method === 'PUT') {
        const body = await readJson(request);
        return sendJson(response, 200, saveDocomatorSettings(database, workspace, body));
      }
      if (path === '/api/integrations/docomator/check' && method === 'POST') {
        const body = await readJson(request);
        const input = effectiveInput(getDocomatorSettings(database, workspace), body);
        try {
          const result = await checkDocomatorConnection(input);
          const settings = recordDocomatorCheck(database, workspace, input, result);
          return sendJson(response, 200, { ...result, settings });
        } catch (error) {
          recordDocomatorFailure(database, workspace, input, error);
          throw error;
        }
      }
      if (path === '/api/integrations/docomator/import' && method === 'POST') {
        const body = await readJson(request);
        const input = effectiveInput(getDocomatorSettings(database, workspace), body);
        const result = await importDocomatorPeople(database, workspace, input, {
          actorPersonId: context.personId || null
        });
        return sendJson(response, 200, result);
      }
      return false;
    } catch (error) {
      throw integrationError(error);
    }
  };
}
