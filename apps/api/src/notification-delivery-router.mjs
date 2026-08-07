import { AppError } from '../../../packages/core/src/errors.mjs';
import { auditAction } from '../../../packages/auth/src/service.mjs';
import { requireAuthenticated, requireRole } from '../../../packages/auth/src/policy.mjs';
import {
  getDeliveryDiagnostics,
  getDeliveryProfile,
  retryNotificationDelivery,
  saveDeliveryProfile
} from '../../../packages/notifications/src/service.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function deliveryError(error) {
  const code = String(error?.message || error);
  const messages = {
    notification_email_invalid: ['Укажите корректный адрес электронной почты.', 400],
    notification_telegram_chat_required: ['Укажите идентификатор чата Telegram.', 400],
    notification_daily_time_invalid: ['Проверьте время ежедневной сводки.', 400],
    notification_weekly_time_invalid: ['Проверьте время еженедельной сводки.', 400],
    notification_quiet_time_invalid: ['Проверьте границы тихих часов.', 400],
    notification_timezone_invalid: ['Укажите корректный часовой пояс, например Europe/Moscow.', 400],
    notification_delivery_not_retryable: ['Повтор доступен только после завершения автоматических попыток доставки.', 409]
  };
  return messages[code] ? new AppError(code, messages[code][0], messages[code][1]) : error;
}

function workspaceId(request) {
  const id = request.auth?.workspaceId;
  if (!id) throw new AppError('workspace_not_found', 'Рабочее пространство не определено.', 404);
  return id;
}

function auditProfile(database, request, profile) {
  auditAction(database, {
    workspaceId: request.auth.workspaceId,
    accountId: request.auth.accountId,
    personId: request.auth.personId,
    action: 'notification.delivery_profile_updated',
    targetKind: 'person',
    targetId: request.auth.personId,
    details: {
      smtpEnabled: profile.smtpEnabled,
      telegramEnabled: profile.telegramEnabled,
      immediateEnabled: profile.immediateEnabled,
      dailyDigestEnabled: profile.dailyDigestEnabled,
      weeklyDigestEnabled: profile.weeklyDigestEnabled,
      quietHoursEnabled: profile.quietHoursEnabled,
      timezone: profile.timezone
    }
  });
}

export function createNotificationDeliveryRouter({ database, config }) {
  return async function routeNotificationDelivery(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const retryMatch = path.match(/^\/api\/admin\/notification-delivery\/([^/]+)\/retry$/);
    const recognized = path === '/api/notification-delivery/profile'
      || path === '/api/admin/notification-delivery'
      || Boolean(retryMatch);
    if (!recognized) return false;

    if (!request.auth?.enabled) {
      throw new AppError(
        'notification_delivery_requires_auth',
        'Персональная доставка доступна после включения локальных аккаунтов.',
        409
      );
    }
    requireAuthenticated(request.auth);
    const workspace = workspaceId(request);

    if (method === 'GET' && path === '/api/notification-delivery/profile') {
      const profile = getDeliveryProfile(database, workspace, request.auth.personId, config);
      if (!profile) throw new AppError('person_not_found', 'Сотрудник текущего аккаунта не найден.', 404);
      sendJson(response, 200, { profile, deliveryEnabled: Boolean(config.notificationDeliveryEnabled) });
      return true;
    }

    if (method === 'PUT' && path === '/api/notification-delivery/profile') {
      const body = await readJson(request);
      try {
        const profile = saveDeliveryProfile(database, workspace, request.auth.personId, body, config);
        if (!profile) throw new AppError('person_not_found', 'Сотрудник текущего аккаунта не найден.', 404);
        auditProfile(database, request, profile);
        sendJson(response, 200, { profile, deliveryEnabled: Boolean(config.notificationDeliveryEnabled) });
        return true;
      } catch (error) {
        throw deliveryError(error);
      }
    }

    requireRole(request.auth, 'admin');
    if (method === 'GET' && path === '/api/admin/notification-delivery') {
      sendJson(response, 200, getDeliveryDiagnostics(database, workspace, config));
      return true;
    }

    if (method === 'POST' && retryMatch) {
      if (!config.notificationDeliveryEnabled) {
        throw new AppError('notification_delivery_disabled', 'Внешняя доставка выключена в конфигурации сервера.', 409);
      }
      const deliveryId = decodeURIComponent(retryMatch[1]);
      let delivery;
      try {
        delivery = retryNotificationDelivery(database, workspace, deliveryId);
      } catch (error) {
        throw deliveryError(error);
      }
      if (!delivery) throw new AppError('notification_delivery_not_found', 'Доставка не найдена.', 404);
      auditAction(database, {
        workspaceId: workspace,
        accountId: request.auth.accountId,
        personId: request.auth.personId,
        action: 'notification.delivery_retry_requested',
        targetKind: 'notification_delivery',
        targetId: delivery.id,
        details: { channel: delivery.channel, retrySequence: delivery.retry_sequence }
      });
      sendJson(response, 200, { status: 'queued', deliveryId: delivery.id, retrySequence: delivery.retry_sequence });
      return true;
    }

    throw new AppError('method_not_allowed', 'Метод не поддерживается для этого маршрута.', 405);
  };
}