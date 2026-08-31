import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../packages/core/src/errors.mjs';
import { PUBLIC_SERVER_ERROR_CODES, sendError } from '../apps/api/src/http-utils.mjs';

class ResponseCapture {
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  end(body) {
    this.body = body;
  }
}

function serialize(error, requestId = 'request-1') {
  const response = new ResponseCapture();
  sendError(response, error, requestId);
  return { response, payload: JSON.parse(response.body) };
}

test('classified Docomator 5xx errors keep their safe code and message without details', () => {
  const error = new AppError(
    'docomator_dns_failed',
    'Имя сервера Оформлятора не найдено. Проверьте адрес или локальный DNS.',
    502,
    { transportCode: 'ENOTFOUND', sensitive: 'must-not-leak' }
  );
  const { response, payload } = serialize(error);
  assert.equal(response.status, 502);
  assert.equal(payload.error.code, 'docomator_dns_failed');
  assert.equal(payload.error.message, error.message);
  assert.equal(Object.hasOwn(payload.error, 'details'), false);
  assert.equal(payload.error.requestId, 'request-1');
});

test('unknown server errors are masked even when they carry an AppError code', () => {
  const error = new AppError('database_secret_failure', 'sensitive database path', 500, { path: '/secret' });
  const { payload } = serialize(error);
  assert.equal(payload.error.code, 'internal_error');
  assert.equal(payload.error.message, 'Внутренняя ошибка сервера.');
  assert.equal(Object.hasOwn(payload.error, 'details'), false);
  assert.equal(JSON.stringify(payload).includes('/secret'), false);
});

test('ordinary client errors preserve actionable details', () => {
  const error = new AppError('invalid_input', 'Проверьте введённое значение.', 400, { field: 'host' });
  const { response, payload } = serialize(error);
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'invalid_input');
  assert.equal(payload.error.message, error.message);
  assert.deepEqual(payload.error.details, { field: 'host' });
});

test('public server error allowlist contains only predetermined operational codes', () => {
  assert.deepEqual([...PUBLIC_SERVER_ERROR_CODES].sort(), [
    'docomator_connection_refused',
    'docomator_dns_error',
    'docomator_dns_failed',
    'docomator_not_ready',
    'docomator_protocol_error',
    'docomator_remote_error',
    'docomator_timeout',
    'docomator_tls_error',
    'docomator_tls_failed',
    'docomator_unreachable',
    'docomator_wrong_service'
  ]);
});
