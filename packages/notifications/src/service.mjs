import { newId } from '../../core/src/ids.mjs';
import { enqueueJob } from '../../storage/src/jobs.mjs';
import { listPersonalNotifications } from '../../plan-fact/src/notifications.mjs';
import { sendSmtpMessage } from './smtp.mjs';
import { sendTelegramMessage } from './telegram.mjs';

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DELIVERY_JOB_PRIORITY = 5;

function flag(value) {
  return value === true || value === 1 || value === '1';
}

function validateTimezone(value) {
  const timezone = String(value || '').trim();
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new Error('notification_timezone_invalid');
  }
}

function validateTime(value, code) {
  const text = String(value || '').trim();
  if (!TIME_RE.test(text)) throw new Error(code);
  return text;
}

function profileRow(database, workspaceId, personId) {
  return database.get(`
    SELECT ndp.*, p.display_name, p.email AS person_email
    FROM people p
    LEFT JOIN notification_delivery_profiles ndp
      ON ndp.workspace_id = p.workspace_id AND ndp.person_id = p.id
    WHERE p.workspace_id = ? AND p.id = ? AND p.status = 'active'
  `, workspaceId, personId);
}

function profilePayload(row, config = {}) {
  if (!row) return null;
  return {
    personId: row.person_id || row.id,
    personName: row.display_name,
    smtpEnabled: flag(row.smtp_enabled),
    emailAddress: row.email_address || row.person_email || '',
    telegramEnabled: flag(row.telegram_enabled),
    telegramChatId: row.telegram_chat_id || '',
    immediateEnabled: row.immediate_enabled === null || row.immediate_enabled === undefined ? true : flag(row.immediate_enabled),
    dailyDigestEnabled: flag(row.daily_digest_enabled),
    dailyDigestTime: row.daily_digest_time || '08:00',
    weeklyDigestEnabled: flag(row.weekly_digest_enabled),
    weeklyDigestDay: Number(row.weekly_digest_day || 1),
    weeklyDigestTime: row.weekly_digest_time || '08:00',
    quietHoursEnabled: row.quiet_hours_enabled === null || row.quiet_hours_enabled === undefined ? true : flag(row.quiet_hours_enabled),
    quietStart: row.quiet_start || '22:00',
    quietEnd: row.quiet_end || '07:00',
    timezone: row.timezone || config.notificationDefaultTimezone || 'Europe/Moscow',
    availability: {
      smtp: Boolean(config.smtpHost && config.smtpFrom),
      telegram: Boolean(config.telegramBotToken)
    }
  };
}

export function getDeliveryProfile(database, workspaceId, personId, config = {}) {
  const row = profileRow(database, workspaceId, personId);
  if (!row) return null;
  if (!row.person_id) row.person_id = personId;
  return profilePayload(row, config);
}

export function saveDeliveryProfile(database, workspaceId, personId, body, config = {}, now = new Date().toISOString()) {
  const person = database.get(`SELECT id, email FROM people WHERE workspace_id = ? AND id = ? AND status = 'active'`, workspaceId, personId);
  if (!person) return null;
  const smtpEnabled = body.smtpEnabled === true;
  const telegramEnabled = body.telegramEnabled === true;
  const emailAddress = String(body.emailAddress ?? person.email ?? '').trim() || null;
  const telegramChatId = String(body.telegramChatId ?? '').trim() || null;
  if (smtpEnabled && (!emailAddress || !/^[^\s@]+@[^\s@]+$/u.test(emailAddress))) throw new Error('notification_email_invalid');
  if (telegramEnabled && !telegramChatId) throw new Error('notification_telegram_chat_required');
  const dailyTime = validateTime(body.dailyDigestTime || '08:00', 'notification_daily_time_invalid');
  const weeklyTime = validateTime(body.weeklyDigestTime || '08:00', 'notification_weekly_time_invalid');
  const quietStart = validateTime(body.quietStart || '22:00', 'notification_quiet_time_invalid');
  const quietEnd = validateTime(body.quietEnd || '07:00', 'notification_quiet_time_invalid');
  const timezone = validateTimezone(body.timezone || config.notificationDefaultTimezone || 'Europe/Moscow');
  const weeklyDay = Math.max(1, Math.min(7, Number(body.weeklyDigestDay || 1)));
  database.run(`
    INSERT INTO notification_delivery_profiles(
      workspace_id, person_id, smtp_enabled, email_address, telegram_enabled, telegram_chat_id,
      immediate_enabled, daily_digest_enabled, daily_digest_time,
      weekly_digest_enabled, weekly_digest_day, weekly_digest_time,
      quiet_hours_enabled, quiet_start, quiet_end, timezone, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, person_id) DO UPDATE SET
      smtp_enabled = excluded.smtp_enabled,
      email_address = excluded.email_address,
      telegram_enabled = excluded.telegram_enabled,
      telegram_chat_id = excluded.telegram_chat_id,
      immediate_enabled = excluded.immediate_enabled,
      daily_digest_enabled = excluded.daily_digest_enabled,
      daily_digest_time = excluded.daily_digest_time,
      weekly_digest_enabled = excluded.weekly_digest_enabled,
      weekly_digest_day = excluded.weekly_digest_day,
      weekly_digest_time = excluded.weekly_digest_time,
      quiet_hours_enabled = excluded.quiet_hours_enabled,
      quiet_start = excluded.quiet_start,
      quiet_end = excluded.quiet_end,
      timezone = excluded.timezone,
      updated_at = excluded.updated_at
  `, workspaceId, personId, smtpEnabled ? 1 : 0, emailAddress, telegramEnabled ? 1 : 0, telegramChatId,
  body.immediateEnabled === false ? 0 : 1, body.dailyDigestEnabled === true ? 1 : 0, dailyTime,
  body.weeklyDigestEnabled === true ? 1 : 0, weeklyDay, weeklyTime,
  body.quietHoursEnabled === false ? 0 : 1, quietStart, quietEnd, timezone, now, now);
  return getDeliveryProfile(database, workspaceId, personId, config);
}

function localParts(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday] || 1,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function minutesOf(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function nextAllowedAt(now, profile) {
  if (!profile.quietHoursEnabled) return now.toISOString();
  const local = localParts(now, profile.timezone);
  const start = minutesOf(profile.quietStart);
  const end = minutesOf(profile.quietEnd);
  if (start === end) return now.toISOString();
  const quiet = start < end
    ? local.minutes >= start && local.minutes < end
    : local.minutes >= start || local.minutes < end;
  if (!quiet) return now.toISOString();
  const waitMinutes = (end - local.minutes + 1440) % 1440 || 1440;
  return new Date(now.getTime() + waitMinutes * 60000).toISOString();
}

function mondayKey(local) {
  const date = new Date(`${local.dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (local.weekday - 1));
  return date.toISOString().slice(0, 10);
}

function dueDigest(profile, kind, now) {
  const local = localParts(now, profile.timezone);
  if (kind === 'daily_digest') {
    return local.minutes >= minutesOf(profile.dailyDigestTime)
      ? `digest:daily:${local.dateKey}` : null;
  }
  const target = profile.weeklyDigestDay;
  const due = local.weekday > target
    || (local.weekday === target && local.minutes >= minutesOf(profile.weeklyDigestTime));
  return due ? `digest:weekly:${mondayKey(local)}` : null;
}

function audienceRole(item, personId) {
  if (item.audience?.role) return item.audience.role;
  if (item.audience?.executorPersonIds?.includes(personId)) return 'executor';
  if (item.audience?.managerPersonIds?.includes(personId)) return 'manager';
  return null;
}

function eligibleImmediate(items, personId) {
  const risks = new Set(items.filter((item) => ['executor_risk', 'manager_risk'].includes(item.kind))
    .map((item) => `${item.sourceKind}:${item.sourceId}:${audienceRole(item, personId)}`));
  return items.filter((item) => {
    if (item.read) return false;
    const role = audienceRole(item, personId);
    if (!role) return false;
    if (['overdue', 'rework'].includes(item.kind)
      && item.sourceKind && item.sourceId
      && risks.has(`${item.sourceKind}:${item.sourceId}:${role}`)) return false;
    if (role === 'manager') return ['manager_review', 'manager_risk'].includes(item.kind);
    return ['reminder', 'today', 'overdue', 'rework', 'executor_risk'].includes(item.kind);
  });
}

function destinationHint(channel, destination) {
  const value = String(destination || '');
  if (channel === 'smtp') {
    const [local, domain] = value.split('@');
    return domain ? `${(local || '').slice(0, 1)}***@${domain}` : '***';
  }
  return value.length > 4 ? `***${value.slice(-4)}` : '***';
}

function channels(profile, config) {
  const result = [];
  if (profile.smtpEnabled && profile.emailAddress && config.smtpHost && config.smtpFrom) {
    result.push(['smtp', profile.emailAddress]);
  }
  if (profile.telegramEnabled && profile.telegramChatId && config.telegramBotToken) {
    result.push(['telegram', profile.telegramChatId]);
  }
  return result;
}

function audit(database, workspaceId, action, delivery, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, 'system', ?, 'notification_delivery', ?, ?, ?)
  `, newId('audit'), workspaceId, action, delivery.id, JSON.stringify(details || {}), now);
}

function createDelivery(database, { workspaceId, personId, notificationKey, channel, deliveryKind, destination, title, body, availableAt }, now) {
  return database.transaction(() => {
    const existing = database.get(`
      SELECT * FROM notification_deliveries
      WHERE workspace_id = ? AND person_id = ? AND notification_key = ? AND channel = ?
    `, workspaceId, personId, notificationKey, channel);
    if (existing) return { delivery: existing, created: false };
    const delivery = {
      id: newId('delivery'), workspace_id: workspaceId, person_id: personId,
      notification_key: notificationKey, channel, delivery_kind: deliveryKind,
      destination, title, body, status: 'created', retry_sequence: 0,
      attempt_count: 0, available_at: availableAt, provider_message_id: null,
      last_error: null, created_at: now, updated_at: now, sent_at: null,
      delivered_at: null, confirmed_at: null
    };
    database.run(`
      INSERT INTO notification_deliveries(
        id, workspace_id, person_id, notification_key, channel, delivery_kind,
        destination, title, body, status, retry_sequence, attempt_count, available_at,
        provider_message_id, last_error, created_at, updated_at, sent_at, delivered_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ...Object.values(delivery));
    enqueueJob(database, {
      kind: 'deliver_notification', payload: { deliveryId: delivery.id }, priority: DELIVERY_JOB_PRIORITY,
      maxAttempts: 5, availableAt,
      idempotencyKey: `notification-delivery:${delivery.id}:r0`
    });
    audit(database, workspaceId, 'notification.delivery_created', delivery, {
      channel, deliveryKind, destination: destinationHint(channel, destination), notificationKey
    }, now);
    return { delivery, created: true };
  });
}

function digestText(items) {
  const visible = items.slice(0, 12);
  const lines = visible.map((item) => `• ${item.title}${item.body ? ` — ${item.body}` : ''}`);
  if (items.length > visible.length) lines.push(`• Ещё ${items.length - visible.length} уведомлений — откройте систему для подробностей.`);
  return lines.join('\n');
}

function activeProfiles(database, config) {
  return database.all(`
    SELECT ndp.*, p.display_name, p.email AS person_email
    FROM notification_delivery_profiles ndp
    JOIN people p ON p.id = ndp.person_id AND p.workspace_id = ndp.workspace_id AND p.status = 'active'
    JOIN auth_accounts aa ON aa.person_id = p.id AND aa.workspace_id = p.workspace_id AND aa.is_active = 1
    WHERE ndp.smtp_enabled = 1 OR ndp.telegram_enabled = 1
       OR ndp.daily_digest_enabled = 1 OR ndp.weekly_digest_enabled = 1
    ORDER BY ndp.workspace_id, p.display_name
  `).map((row) => ({ ...profilePayload(row, config), workspaceId: row.workspace_id }));
}

export function materializeNotificationDeliveries(database, config, nowValue = new Date()) {
  if (!config.notificationDeliveryEnabled) return { status: 'disabled', created: 0, errors: [] };
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const createdAt = now.toISOString();
  let created = 0;
  const errors = [];
  for (const profile of activeProfiles(database, config)) {
    try {
      const personal = listPersonalNotifications(database, profile.workspaceId, {
        personId: profile.personId, now, limit: 500
      });
      if (!personal) continue;
      const eligible = eligibleImmediate(personal.items, profile.personId);
      const availableAt = nextAllowedAt(now, profile);
      if (profile.immediateEnabled) {
        for (const item of eligible) {
          for (const [channel, destination] of channels(profile, config)) {
            const result = createDelivery(database, {
              workspaceId: profile.workspaceId, personId: profile.personId,
              notificationKey: item.key, channel, deliveryKind: 'immediate', destination,
              title: item.title, body: item.body || '', availableAt
            }, createdAt);
            if (result.created) created += 1;
          }
        }
      }
      for (const kind of ['daily_digest', 'weekly_digest']) {
        const enabled = kind === 'daily_digest' ? profile.dailyDigestEnabled : profile.weeklyDigestEnabled;
        if (!enabled || !eligible.length) continue;
        const key = dueDigest(profile, kind, now);
        if (!key) continue;
        const title = kind === 'daily_digest' ? 'Ежедневная рабочая сводка' : 'Еженедельная рабочая сводка';
        const body = digestText(eligible);
        for (const [channel, destination] of channels(profile, config)) {
          const result = createDelivery(database, {
            workspaceId: profile.workspaceId, personId: profile.personId,
            notificationKey: key, channel, deliveryKind: kind, destination,
            title, body, availableAt
          }, createdAt);
          if (result.created) created += 1;
        }
      }
    } catch (error) {
      errors.push({ personId: profile.personId, error: String(error?.message || error) });
    }
  }
  return { status: errors.length ? 'partial' : 'ok', created, errors };
}

export async function processNotificationDeliveryJob(database, job, logger, config, adapters = {}) {
  const payload = JSON.parse(job.payload_json);
  const delivery = database.get('SELECT * FROM notification_deliveries WHERE id = ?', payload.deliveryId);
  if (!delivery) throw new Error('notification_delivery_not_found');
  if (['sent', 'delivered', 'confirmed'].includes(delivery.status)) return delivery;
  const now = new Date().toISOString();
  database.run(`UPDATE notification_deliveries SET attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?`, now, delivery.id);
  try {
    let result;
    if (delivery.channel === 'smtp') {
      const sender = adapters.smtp || sendSmtpMessage;
      if (!config.smtpHost || !config.smtpFrom) throw new Error('smtp_not_configured');
      result = await sender({
        host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
        startTls: config.smtpStartTls, requireTls: config.smtpRequireTls,
        rejectUnauthorized: config.smtpRejectUnauthorized,
        username: config.smtpUsername, password: config.smtpPassword,
        from: config.smtpFrom, to: delivery.destination, subject: delivery.title,
        body: delivery.body, timeoutMs: config.smtpTimeoutMs,
        messageId: `${delivery.id}@kafedra-planner`
      });
    } else if (delivery.channel === 'telegram') {
      const sender = adapters.telegram || sendTelegramMessage;
      if (!config.telegramBotToken) throw new Error('telegram_not_configured');
      result = await sender({
        apiBase: config.telegramApiBase, botToken: config.telegramBotToken,
        chatId: delivery.destination, subject: delivery.title, body: delivery.body,
        timeoutMs: config.telegramTimeoutMs
      });
    } else {
      throw new Error('notification_channel_unsupported');
    }
    const completedAt = new Date().toISOString();
    const status = delivery.channel === 'telegram' ? 'delivered' : 'sent';
    database.run(`
      UPDATE notification_deliveries SET status = ?, provider_message_id = ?, last_error = NULL,
        sent_at = COALESCE(sent_at, ?), delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
        updated_at = ? WHERE id = ?
    `, status, result?.messageId || result?.providerMessage || null, completedAt, status, completedAt, completedAt, delivery.id);
    const updated = database.get('SELECT * FROM notification_deliveries WHERE id = ?', delivery.id);
    audit(database, delivery.workspace_id, `notification.delivery_${status}`, updated, {
      channel: delivery.channel, destination: destinationHint(delivery.channel, delivery.destination)
    }, completedAt);
    logger?.info?.('notification delivered', { deliveryId: delivery.id, channel: delivery.channel, status });
    return updated;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = String(error?.message || error).slice(0, 1000);
    const terminal = Number(job.attempts || 0) >= Number(job.max_attempts || 5);
    database.run(`
      UPDATE notification_deliveries
      SET status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `, terminal ? 'error' : 'created', message, failedAt, delivery.id);
    audit(database, delivery.workspace_id,
      terminal ? 'notification.delivery_error' : 'notification.delivery_attempt_failed', delivery, {
        channel: delivery.channel,
        destination: destinationHint(delivery.channel, delivery.destination),
        error: message,
        terminal,
        attempt: Number(job.attempts || 0),
        maxAttempts: Number(job.max_attempts || 5)
      }, failedAt);
    throw error;
  }
}

function hasPendingDeliveryJob(database, deliveryId) {
  return Boolean(database.get(`
    SELECT 1 AS present
    FROM jobs
    WHERE kind = 'deliver_notification'
      AND json_extract(payload_json, '$.deliveryId') = ?
      AND status IN ('queued', 'retry', 'running')
    LIMIT 1
  `, deliveryId));
}

export function retryNotificationDelivery(database, workspaceId, deliveryId, now = new Date().toISOString()) {
  return database.transaction(() => {
    const delivery = database.get(`SELECT * FROM notification_deliveries WHERE workspace_id = ? AND id = ?`, workspaceId, deliveryId);
    if (!delivery) return null;
    if (delivery.status !== 'error' || hasPendingDeliveryJob(database, delivery.id)) {
      throw new Error('notification_delivery_not_retryable');
    }
    const sequence = Number(delivery.retry_sequence || 0) + 1;
    database.run(`
      UPDATE notification_deliveries SET status = 'created', retry_sequence = ?, last_error = NULL,
        available_at = ?, updated_at = ? WHERE id = ?
    `, sequence, now, now, delivery.id);
    enqueueJob(database, {
      kind: 'deliver_notification', payload: { deliveryId: delivery.id }, priority: DELIVERY_JOB_PRIORITY,
      maxAttempts: 5, availableAt: now,
      idempotencyKey: `notification-delivery:${delivery.id}:r${sequence}`
    });
    const updated = database.get('SELECT * FROM notification_deliveries WHERE id = ?', delivery.id);
    audit(database, workspaceId, 'notification.delivery_retried', updated, { sequence }, now);
    return updated;
  });
}

export function getDeliveryDiagnostics(database, workspaceId, config) {
  const counts = Object.fromEntries(database.all(`
    SELECT status, COUNT(*) AS count FROM notification_deliveries
    WHERE workspace_id = ? GROUP BY status
  `, workspaceId).map((row) => [row.status, Number(row.count)]));
  const profiles = database.get(`SELECT COUNT(*) AS count FROM notification_delivery_profiles WHERE workspace_id = ?`, workspaceId)?.count || 0;
  const enabledProfiles = database.get(`
    SELECT COUNT(*) AS count FROM notification_delivery_profiles
    WHERE workspace_id = ? AND (smtp_enabled = 1 OR telegram_enabled = 1)
  `, workspaceId)?.count || 0;
  const failed = database.all(`
    SELECT id, person_id, channel, delivery_kind, destination, title, status, attempt_count,
      retry_sequence, last_error, updated_at
    FROM notification_deliveries
    WHERE workspace_id = ? AND status = 'error'
    ORDER BY updated_at DESC LIMIT 50
  `, workspaceId).map((row) => ({ ...row, destination: destinationHint(row.channel, row.destination) }));
  const queue = Object.fromEntries(database.all(`
    SELECT j.status, COUNT(*) AS count
    FROM jobs j
    JOIN notification_deliveries nd
      ON nd.id = json_extract(j.payload_json, '$.deliveryId')
    WHERE j.kind = 'deliver_notification' AND nd.workspace_id = ?
    GROUP BY j.status
  `, workspaceId).map((row) => [row.status, Number(row.count)]));
  const channelsConfigured = {
    smtp: Boolean(config.smtpHost && config.smtpFrom),
    telegram: Boolean(config.telegramBotToken)
  };
  return {
    enabled: Boolean(config.notificationDeliveryEnabled),
    channelsConfigured,
    profiles: Number(profiles), enabledProfiles: Number(enabledProfiles),
    counts: { created: 0, sent: 0, delivered: 0, confirmed: 0, error: 0, ...counts },
    queue,
    failed,
    status: !config.notificationDeliveryEnabled
      ? 'disabled'
      : (channelsConfigured.smtp || channelsConfigured.telegram) ? (failed.length ? 'warning' : 'ready') : 'no_channel'
  };
}