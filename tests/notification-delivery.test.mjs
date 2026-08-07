import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createAuthAccount } from '../packages/auth/src/service.mjs';
import { setPersonalNotificationState } from '../packages/plan-fact/src/notifications.mjs';
import {
  getDeliveryDiagnostics,
  materializeNotificationDeliveries,
  processNotificationDeliveryJob,
  retryNotificationDelivery,
  saveDeliveryProfile
} from '../packages/notifications/src/service.mjs';
import { sendSmtpMessage } from '../packages/notifications/src/smtp.mjs';
import { sendTelegramMessage } from '../packages/notifications/src/telegram.mjs';

const migrationsDir = resolve('migrations');
const baseConfig = {
  notificationDeliveryEnabled: true,
  notificationDefaultTimezone: 'Europe/Moscow',
  smtpHost: 'mail.local', smtpPort: 25, smtpSecure: false, smtpStartTls: false,
  smtpRequireTls: false, smtpRejectUnauthorized: true, smtpUsername: '', smtpPassword: '',
  smtpFrom: 'kafedra@example.test', smtpTimeoutMs: 5000,
  telegramBotToken: '', telegramApiBase: 'https://api.telegram.org', telegramTimeoutMs: 5000
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-notification-delivery-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const createdAt = '2026-01-01T09:00:00.000Z';
  database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, email, position, created_at, updated_at)
    VALUES ('delivery-manager',?,'Иванов Иван Иванович','иванов иван иванович','manager@example.test','заведующий',?,?)`, workspace.id, createdAt, createdAt);
  database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, email, position, manager_id, created_at, updated_at)
    VALUES ('delivery-owner',?,'Петров Пётр Петрович','петров петр петрович','owner@example.test','доцент','delivery-manager',?,?)`, workspace.id, createdAt, createdAt);
  createAuthAccount(database, workspace.id, {
    personId: 'delivery-owner', username: 'delivery-owner', password: 'OwnerPassword2026', role: 'staff'
  }, createdAt);
  createAuthAccount(database, workspace.id, {
    personId: 'delivery-manager', username: 'delivery-manager', password: 'ManagerPassword2026', role: 'manager'
  }, createdAt);
  database.run(`INSERT INTO assignments(id, workspace_id, title, instruction_text, due_date, direction, priority, status, expected_result, report_required, confidence, evidence_json, created_at, updated_at)
    VALUES ('delivery-assignment',?,'Подготовить отчёт','Подготовить отчёт до срока','2026-08-05','science','high','open','Отчёт',1,1,'{}',?,?)`, workspace.id, createdAt, createdAt);
  database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
    VALUES ('delivery-assignment','delivery-owner','Петров Пётр Петрович','executor',?)`, createdAt);
  database.run(`INSERT INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
    VALUES ('delivery-assignment','delivery-manager','Иванов Иван Иванович','controller',?)`, createdAt);
  database.run(`INSERT INTO calendar_items(id, workspace_id, source_kind, source_id, title, starts_at, category, importance, status, item_kind, revision, created_at, updated_at)
    VALUES ('delivery-calendar',?,'assignment','delivery-assignment','Подготовить отчёт','2026-08-05','science','high','open','task',1,?,?)`, workspace.id, createdAt, createdAt);
  return { dir, database, workspace };
}

test('outbox создаётся атомарно один раз, автоматические повторы завершаются до ручного retry', async () => {
  const { dir, database, workspace } = await fixture();
  try {
    saveDeliveryProfile(database, workspace.id, 'delivery-owner', {
      smtpEnabled: true, emailAddress: 'owner@example.test', immediateEnabled: true,
      quietHoursEnabled: false, timezone: 'Europe/Moscow'
    }, baseConfig);
    saveDeliveryProfile(database, workspace.id, 'delivery-manager', {
      smtpEnabled: true, emailAddress: 'manager@example.test', immediateEnabled: true,
      quietHoursEnabled: false, timezone: 'Europe/Moscow'
    }, baseConfig);

    const now = new Date('2026-08-07T12:00:00.000Z');
    const first = materializeNotificationDeliveries(database, baseConfig, now);
    assert.equal(first.status, 'ok');
    assert.equal(first.created, 2);
    assert.equal(database.get(`SELECT COUNT(*) AS count FROM notification_deliveries`)?.count, 2);
    assert.equal(database.get(`SELECT COUNT(*) AS count FROM jobs WHERE kind = 'deliver_notification'`)?.count, 2);
    assert.equal(database.get(`SELECT MAX(priority) AS priority FROM jobs WHERE kind = 'deliver_notification'`)?.priority, 5);
    assert.equal(materializeNotificationDeliveries(database, baseConfig, now).created, 0);

    const ownerDelivery = database.get(`SELECT * FROM notification_deliveries WHERE person_id = 'delivery-owner'`);
    assert.ok(ownerDelivery);
    assert.equal(ownerDelivery.delivery_kind, 'immediate');
    assert.match(ownerDelivery.notification_key, /planfact:assignment:delivery-assignment:overdue/);
    const ownerJob = database.get(`SELECT * FROM jobs WHERE json_extract(payload_json, '$.deliveryId') = ?`, ownerDelivery.id);
    let sends = 0;
    await processNotificationDeliveryJob(database, ownerJob, null, baseConfig, {
      smtp: async ({ messageId }) => { sends += 1; return { accepted: true, messageId }; }
    });
    assert.equal(sends, 1);
    assert.equal(database.get('SELECT status FROM notification_deliveries WHERE id = ?', ownerDelivery.id).status, 'sent');
    await processNotificationDeliveryJob(database, ownerJob, null, baseConfig, {
      smtp: async () => { sends += 1; return { accepted: true }; }
    });
    assert.equal(sends, 1);

    setPersonalNotificationState(database, workspace.id, 'delivery-owner', ownerDelivery.notification_key, 'read', '2026-08-07T12:05:00.000Z');
    assert.equal(database.get('SELECT status FROM notification_deliveries WHERE id = ?', ownerDelivery.id).status, 'confirmed');
    assert.throws(
      () => retryNotificationDelivery(database, workspace.id, ownerDelivery.id, '2026-08-07T12:06:00.000Z'),
      /notification_delivery_not_retryable/
    );

    const managerDelivery = database.get(`SELECT * FROM notification_deliveries WHERE person_id = 'delivery-manager'`);
    const managerJob = database.get(`SELECT * FROM jobs WHERE json_extract(payload_json, '$.deliveryId') = ?`, managerDelivery.id);
    await assert.rejects(() => processNotificationDeliveryJob(database, { ...managerJob, attempts: 1 }, null, baseConfig, {
      smtp: async () => { throw new Error('mailbox_unavailable'); }
    }), /mailbox_unavailable/);
    const pendingDelivery = database.get('SELECT status, last_error FROM notification_deliveries WHERE id = ?', managerDelivery.id);
    assert.equal(pendingDelivery.status, 'created');
    assert.match(pendingDelivery.last_error, /mailbox_unavailable/);
    assert.throws(
      () => retryNotificationDelivery(database, workspace.id, managerDelivery.id, '2026-08-07T12:08:00.000Z'),
      /notification_delivery_not_retryable/
    );

    await assert.rejects(() => processNotificationDeliveryJob(database, {
      ...managerJob,
      attempts: managerJob.max_attempts
    }, null, baseConfig, {
      smtp: async () => { throw new Error('mailbox_unavailable'); }
    }), /mailbox_unavailable/);
    assert.equal(database.get('SELECT status FROM notification_deliveries WHERE id = ?', managerDelivery.id).status, 'error');
    database.run(`UPDATE jobs SET status = 'failed', locked_by = NULL, lease_until = NULL WHERE id = ?`, managerJob.id);
    const retried = retryNotificationDelivery(database, workspace.id, managerDelivery.id, '2026-08-07T12:10:00.000Z');
    assert.equal(retried.retry_sequence, 1);
    assert.equal(retried.status, 'created');
    assert.ok(database.get(`SELECT id FROM jobs WHERE idempotency_key = ?`, `notification-delivery:${managerDelivery.id}:r1`));

    const diagnostics = getDeliveryDiagnostics(database, workspace.id, baseConfig);
    assert.equal(diagnostics.enabled, true);
    assert.equal(diagnostics.channelsConfigured.smtp, true);
    assert.equal(diagnostics.profiles, 2);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('тихие часы откладывают доставку, ежедневная сводка идемпотентна', async () => {
  const { dir, database, workspace } = await fixture();
  try {
    saveDeliveryProfile(database, workspace.id, 'delivery-owner', {
      smtpEnabled: true, emailAddress: 'owner@example.test', immediateEnabled: false,
      dailyDigestEnabled: true, dailyDigestTime: '08:00', quietHoursEnabled: true,
      quietStart: '22:00', quietEnd: '07:00', timezone: 'Europe/Moscow'
    }, baseConfig);
    const now = new Date('2026-08-07T20:30:00.000Z');
    const first = materializeNotificationDeliveries(database, baseConfig, now);
    assert.equal(first.created, 1);
    const delivery = database.get(`SELECT * FROM notification_deliveries WHERE person_id = 'delivery-owner'`);
    assert.equal(delivery.delivery_kind, 'daily_digest');
    assert.match(delivery.notification_key, /^digest:daily:/);
    assert.ok(new Date(delivery.available_at).getTime() > now.getTime());
    assert.equal(materializeNotificationDeliveries(database, baseConfig, now).created, 0);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('SMTP-адаптер отправляет UTF-8 письмо через локальный relay без npm-зависимостей', async () => {
  let received = '';
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 test.local ESMTP\r\n');
    let buffer = '';
    let dataMode = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (dataMode) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end >= 0) {
          received += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          dataMode = false;
          socket.write('250 queued as 123\r\n');
        }
        return;
      }
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (line.startsWith('EHLO')) socket.write('250-test.local\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 authenticated\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
        else if (line.startsWith('RCPT TO')) socket.write('250 ok\r\n');
        else if (line === 'DATA') { dataMode = true; socket.write('354 end with dot\r\n'); break; }
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = server.address().port;
    const result = await sendSmtpMessage({
      host: '127.0.0.1', port, secure: false, startTls: false,
      username: 'user', password: 'secret', from: 'kafedra@example.test',
      to: 'person@example.test', subject: 'Срок поручения', body: 'Подготовьте отчёт.',
      messageId: 'delivery-test@kafedra-planner', timeoutMs: 3000
    });
    assert.equal(result.accepted, true);
    assert.match(received, /Subject: =\?UTF-8\?B\?/);
    assert.match(received, /Подготовьте отчёт/);
    assert.match(received, /delivery-test@kafedra-planner/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Telegram-адаптер не раскрывает токен в ошибке и принимает успешный ответ', async () => {
  const calls = [];
  const result = await sendTelegramMessage({
    botToken: 'secret-token', chatId: '42', subject: 'Срок', body: 'Проверьте задачу',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }) };
    }
  });
  assert.equal(result.messageId, '77');
  assert.equal(calls[0].body.chat_id, '42');
  assert.match(calls[0].body.text, /Проверьте задачу/);

  await assert.rejects(() => sendTelegramMessage({
    botToken: 'secret-token', chatId: '42', subject: 'x', body: 'y',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false }) })
  }), (error) => error.message === 'telegram_http_401' && !error.message.includes('secret-token'));
});