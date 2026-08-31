import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../packages/core/src/errors.mjs';
import {
  PUBLIC_SERVER_ERROR_CODES,
  sendError
} from '../apps/api/src/http-utils.mjs';

function captureResponse() {
  let status = null;
  let headers = null;
  let body = '';
  return {
    response: {
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus;
        headers = nextHeaders;
      },
      end(value = '') {
        body += String(value);
      }
    },
    result() {
      return {
        status,
        headers,
        payload: JSON.parse(body)
      };
    }
  };
}

function serialize(error, requestId = 'request-test') {
  const capture = captureResponse();
  sendError(capture.response, error, requestId);
  return capture.result();
}

test('предопределённые безопасные 5xx сохраняют код и понятное сообщение без details', () => {
  for (const code of PUBLIC_SERVER_ERROR_CODES) {
    const result = serialize(new AppError(
      code,
      `Безопасное сообщение: ${code}`,
      code === 'docomator_timeout' ? 504 : 502,
      { cause: 'секретная внутренняя причина' }
    ));
    assert.equal(result.status, code === 'docomator_timeout' ? 504 : 502);
    assert.equal(result.payload.error.code, code);
    assert.equal(result.payload.error.message, `Безопасное сообщение: ${code}`);
    assert.equal(Object.hasOwn(result.payload.error, 'details'), false);
    assert.equal(result.payload.error.requestId, 'request-test');
  }
});

test('неизвестный 5xx не раскрывает внутренний код, сообщение или details', () => {
  const result = serialize(new AppError(
    'sqlite_internal_state',
    'SQLITE_BUSY at /opt/kafedra-planner/data/private.sqlite3',
    500,
    { stack: 'private stack', databasePath: '/opt/kafedra-planner/data/private.sqlite3' }
  ));
  assert.equal(result.status, 500);
  assert.equal(result.payload.error.code, 'internal_error');
  assert.equal(result.payload.error.message, 'Внутренняя ошибка сервера.');
  assert.equal(Object.hasOwn(result.payload.error, 'details'), false);
  assert.equal(result.payload.error.requestId, 'request-test');
});

test('ошибка клиента сохраняет предметную диагностику и безопасные details', () => {
  const result = serialize(new AppError(
    'invalid_document_kind',
    'Выберите поддерживаемый тип документа.',
    422,
    { allowed: ['plan', 'directive'] }
  ));
  assert.equal(result.status, 422);
  assert.equal(result.payload.error.code, 'invalid_document_kind');
  assert.equal(result.payload.error.message, 'Выберите поддерживаемый тип документа.');
  assert.deepEqual(result.payload.error.details, { allowed: ['plan', 'directive'] });
});

test('необработанное исключение всегда становится нейтральной внутренней ошибкой', () => {
  const result = serialize(new Error('private runtime failure'));
  assert.equal(result.status, 500);
  assert.deepEqual(result.payload.error, {
    code: 'internal_error',
    message: 'Внутренняя ошибка сервера.',
    requestId: 'request-test'
  });
});
