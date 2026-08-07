import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage } from '../packages/notifications/src/telegram.mjs';

test('сетевые ошибки Telegram не переносят bot token в БД/аудит через текст исключения', async () => {
  const secret = '123456:VERY-SECRET-TOKEN';
  await assert.rejects(
    () => sendTelegramMessage({
      botToken: secret,
      chatId: '42',
      subject: 'Срок',
      body: 'Проверить задачу',
      fetchImpl: async (url) => {
        throw new Error(`connect failed: ${url}`);
      }
    }),
    (error) => error.message === 'telegram_request_failed' && !error.message.includes(secret)
  );
});

test('таймаут Telegram преобразуется в безопасный стабильный код', async () => {
  const error = new Error('request timed out at https://api.telegram.org/botSECRET/sendMessage');
  error.name = 'TimeoutError';
  await assert.rejects(
    () => sendTelegramMessage({
      botToken: 'SECRET',
      chatId: '42',
      subject: 'Срок',
      body: 'Проверить задачу',
      fetchImpl: async () => { throw error; }
    }),
    (caught) => caught.message === 'telegram_timeout' && !caught.message.includes('SECRET')
  );
});