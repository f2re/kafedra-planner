import { AppError } from '../../../packages/core/src/errors.mjs';
import { requireRole } from '../../../packages/auth/src/policy.mjs';
import {
  DocomatorIntegrationError,
  checkDocomatorConnection,
  getDocomatorSettings,
  recordDocomatorCheck,
  recordDocomatorFailure,
  saveDocomatorSettings
} from '../../../packages/integrations/src/docomator.mjs';
import {
  discoverDocomatorFields,
  getDocomatorFieldMapping,
  importDocomatorPeopleWithFields,
  listDocomatorPersonFields,
  saveDocomatorFieldMapping
} from '../../../packages/integrations/src/docomator-fields.mjs';
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
    docomator_property_key_invalid: ['В Оформляторе обнаружен некорректный ключ поля.', 422],
    docomator_extra_fields_invalid: ['Выбран некорректный набор дополнительных полей.', 400],
    docomator_property_not_found: ['Одно из выбранных полей больше не существует в Оформляторе. Обновите список полей.', 409],
    docomator_unreachable: ['Оформлятор не отвечает по указанному адресу и порту.', 502],
    docomator_remote_error: ['Оформлятор ответил ошибкой. Проверьте его состояние и выбранные данные.', 502],
    docomator_protocol_error: ['Оформлятор ответил в неожиданном формате. Проверьте совместимость версий.', 502]
  };
  const [message, status] = messages[error.code] || ['Не удалось выполнить обмен с Оформлятором.', 500];
  return new AppError(error.code, message, status, error.details);
}

function combinedSettings(database, workspace) {
  return {
    ...getDocomatorSettings(database, workspace),
    ...getDocomatorFieldMapping(database, workspace)
  };
}

function effectiveInput(saved, body = {}) {
  return {
    scheme: body.scheme ?? saved.scheme,
    host: body.host ?? saved.host,
    port: body.port ?? saved.port,
    spaceId: body.spaceId ?? saved.spaceId,
    groupId: Object.hasOwn(body, 'groupId') ? body.groupId : saved.groupId,
    includeInactive: Object.hasOwn(body, 'includeInactive') ? Boolean(body.includeInactive) : saved.includeInactive,
    emailPropertyKey: Object.hasOwn(body, 'emailPropertyKey') ? body.emailPropertyKey : saved.emailPropertyKey,
    positionPropertyKey: Object.hasOwn(body, 'positionPropertyKey') ? body.positionPropertyKey : saved.positionPropertyKey,
    extraPropertyKeys: Object.hasOwn(body, 'extraPropertyKeys') ? body.extraPropertyKeys : saved.extraPropertyKeys,
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
        return sendJson(response, 200, combinedSettings(database, workspace));
      }
      if (path === '/api/integrations/docomator' && method === 'PUT') {
        const body = await readJson(request);
        const input = effectiveInput(combinedSettings(database, workspace), body);
        saveDocomatorSettings(database, workspace, input);
        saveDocomatorFieldMapping(database, workspace, input);
        return sendJson(response, 200, combinedSettings(database, workspace));
      }
      if (path === '/api/integrations/docomator/check' && method === 'POST') {
        const body = await readJson(request);
        const input = effectiveInput(combinedSettings(database, workspace), body);
        try {
          const result = await checkDocomatorConnection(input);
          let fieldInfo = { properties: [], suggestedMappings: { emailPropertyKey: null, positionPropertyKey: null } };
          if (!result.authRequired && input.spaceId) fieldInfo = await discoverDocomatorFields(input);
          recordDocomatorCheck(database, workspace, input, result);
          saveDocomatorFieldMapping(database, workspace, input);
          return sendJson(response, 200, {
            ...result,
            ...fieldInfo,
            settings: combinedSettings(database, workspace)
          });
        } catch (error) {
          recordDocomatorFailure(database, workspace, input, error);
          throw error;
        }
      }
      if (path === '/api/integrations/docomator/fields/discover' && method === 'POST') {
        const body = await readJson(request);
        const input = effectiveInput(combinedSettings(database, workspace), body);
        return sendJson(response, 200, await discoverDocomatorFields(input));
      }
      if (path === '/api/integrations/docomator/import' && method === 'POST') {
        const body = await readJson(request);
        const input = effectiveInput(combinedSettings(database, workspace), body);
        const result = await importDocomatorPeopleWithFields(database, workspace, input, {
          actorPersonId: context.personId || null
        });
        return sendJson(response, 200, {
          ...result,
          settings: combinedSettings(database, workspace)
        });
      }
      const personFields = path.match(/^\/api\/integrations\/docomator\/people\/([^/]+)\/fields$/u);
      if (personFields && method === 'GET') {
        return sendJson(response, 200, {
          items: listDocomatorPersonFields(database, workspace, decodeURIComponent(personFields[1]))
        });
      }
      return false;
    } catch (error) {
      throw integrationError(error);
    }
  };
}
