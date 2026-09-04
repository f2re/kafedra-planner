import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  installUnicodeSafeHeaders,
  isUploadRequest,
  normalizeHeadersInit,
  normalizeIdempotencyHeader,
  sha256HexUtf8
} from '../public/http-headers.js';

const expectedSha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');

test('sha256HexUtf8 matches Node for ASCII, Cyrillic, emoji and long input', () => {
  for (const value of ['', 'plan.xlsx', 'План кафедры.xlsx', 'план🙂.xlsx', 'д'.repeat(20_000)]) {
    assert.equal(sha256HexUtf8(value), expectedSha256(value));
  }
});

test('idempotency normalization is bounded ASCII and stable', () => {
  const raw = 'action-center:plan:План кафедры 🙂.xlsx:2048:1788150000';
  const normalized = normalizeIdempotencyHeader(raw);
  const annualProtocol = `protocol-year:2031:${'a'.repeat(64)}`;
  assert.match(normalized, /^kp-v1-[a-f0-9]{64}$/u);
  assert.equal(normalized.length, 70);
  assert.equal(normalizeIdempotencyHeader(raw), normalized);
  assert.equal(normalizeIdempotencyHeader(normalized), normalized);
  assert.equal(normalizeIdempotencyHeader(annualProtocol), annualProtocol);
  assert.notEqual(normalizeIdempotencyHeader(`${raw}:other`), normalized);
});

test('header shapes are normalized before a native Headers constructor receives values', () => {
  const raw = 'План 🙂.docx:1:2';
  const expected = normalizeIdempotencyHeader(raw);
  const native = globalThis.Headers;

  for (const init of [
    { 'Idempotency-Key': raw, 'x-file-name': '%D0%9F%D0%BB%D0%B0%D0%BD.docx' },
    [['idempotency-key', raw], ['x-document-type', 'plan']],
    new native([['idempotency-key', 'ascii-before-normalization']])
  ]) {
    const entries = normalizeHeadersInit(init, native);
    const headers = new native(entries);
    if (init instanceof native) {
      assert.equal(headers.get('idempotency-key'), normalizeIdempotencyHeader('ascii-before-normalization'));
    } else {
      assert.equal(headers.get('idempotency-key'), expected);
    }
  }
});

test('installer protects explicit Headers construction and fetch header objects', async () => {
  const calls = [];
  const scope = {
    Headers: globalThis.Headers,
    fetch: async (input, init) => {
      calls.push({ input, init });
      return { input, init };
    }
  };

  const first = installUnicodeSafeHeaders(scope);
  const second = installUnicodeSafeHeaders(scope);
  assert.equal(first, second);

  const raw = 'Протокол заседания 🙂.docx:4096:1788150000';
  const expected = normalizeIdempotencyHeader(raw);
  const headers = new scope.Headers({ 'idempotency-key': raw, 'x-document-type': 'protocol' });
  assert.equal(headers.get('idempotency-key'), expected);
  assert.equal(headers instanceof globalThis.Headers, true);
  assert.equal(headers instanceof scope.Headers, true);

  await scope.fetch('/api/documents', {
    method: 'POST',
    headers: { 'Idempotency-Key': raw, 'x-document-type': 'protocol' },
    body: new Uint8Array([1, 2, 3])
  });
  const forwarded = new globalThis.Headers(calls[0].init.headers);
  assert.equal(forwarded.get('idempotency-key'), expected);
  assert.equal(forwarded.get('x-document-type'), 'protocol');
});

test('upload detection is deterministic and does not classify unrelated requests', () => {
  assert.equal(isUploadRequest('/api/documents', { method: 'POST' }), true);
  assert.equal(isUploadRequest('http://localhost/api/documents?kind=plan', { method: 'PUT' }), true);
  assert.equal(isUploadRequest('/api/documents/abc', { method: 'POST' }), false);
  assert.equal(isUploadRequest('/api/documents', { method: 'GET' }), false);
  assert.equal(isUploadRequest('/api/plans', { method: 'POST' }), false);
});
