import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../../packages/core/src/errors.mjs';

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,96}$/u;

export const PUBLIC_SERVER_ERROR_CODES = new Set([
  'docomator_dns_failed',
  'docomator_dns_error',
  'docomator_connection_refused',
  'docomator_timeout',
  'docomator_tls_failed',
  'docomator_tls_error',
  'docomator_wrong_service',
  'docomator_not_ready',
  'docomator_unreachable',
  'docomator_remote_error',
  'docomator_protocol_error'
]);

const staticTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

export function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers
  });
  response.end(body);
}

export function sendError(response, error, requestId) {
  const status = error instanceof AppError ? error.status : 500;
  const safeServerError = status >= 500
    && error instanceof AppError
    && PUBLIC_SERVER_ERROR_CODES.has(error.code);
  const expose = status < 500 || safeServerError;
  sendJson(response, status, {
    error: {
      code: expose ? (error.code || 'internal_error') : 'internal_error',
      message: expose ? error.message : 'Внутренняя ошибка сервера.',
      details: status >= 500 ? undefined : error.details,
      requestId
    }
  });
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('request_too_large', 'Запрос слишком большой.', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('invalid_json', 'Тело запроса не является корректным JSON.', 400);
  }
}

function safeDispositionFileName(value) {
  const fallback = String(value || 'document')
    .replace(/[\u0000-\u001f"\\/;]+/g, '_')
    .slice(0, 180) || 'document';
  return {
    ascii: fallback.replace(/[^\x20-\x7e]/g, '_'),
    encoded: encodeURIComponent(fallback).replaceAll("'", '%27')
  };
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value || '').trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;

  let start;
  let end;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function sendFile(request, response, path, {
  mediaType = 'application/octet-stream',
  fileName = 'document',
  sizeBytes = null,
  etag = null,
  disposition = 'inline'
} = {}) {
  const fileStat = sizeBytes === null ? await stat(path) : null;
  const size = Number(sizeBytes ?? fileStat.size);
  const strongEtag = etag ? `"${String(etag)}"` : null;

  if (strongEtag && request.headers['if-none-match'] === strongEtag) {
    response.writeHead(304, { etag: strongEtag });
    response.end();
    return;
  }

  const rangeHeader = request.headers.range;
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    response.writeHead(416, {
      'content-range': `bytes */${size}`,
      'accept-ranges': 'bytes'
    });
    response.end();
    return;
  }

  const name = safeDispositionFileName(fileName);
  const headers = {
    'content-type': mediaType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'content-disposition': `${disposition}; filename="${name.ascii}"; filename*=UTF-8''${name.encoded}`,
    'x-content-type-options': 'nosniff'
  };
  if (strongEtag) headers.etag = strongEtag;

  if (range) {
    headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['content-length'] = String(range.end - range.start + 1);
    response.writeHead(206, headers);
  } else {
    headers['content-length'] = String(size);
    response.writeHead(200, headers);
  }

  if ((request.method || 'GET').toUpperCase() === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(path, range || undefined);
  await pipeline(stream, response);
}

export async function serveStatic(response, publicDir, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = normalize(requested).replace(/^([/\\])+/, '');
  if (relative.startsWith('..')) return false;
  const path = join(publicDir, relative);
  try {
    let content = await readFile(path);
    if (relative === 'index.html') {
      const html = content.toString('utf8');
      const scripts = [];
      if (!html.includes('/auth-next.js')) scripts.push('  <script type="module" src="/auth-next.js"></script>');
      if (!html.includes('/admin-next.js')) scripts.push('  <script type="module" src="/admin-next.js"></script>');
      if (!html.includes('/preview-next.js')) scripts.push('  <script type="module" src="/preview-next.js"></script>');
      if (!html.includes('/template-binding.js')) scripts.push('  <script type="module" src="/template-binding.js"></script>');
      if (!html.includes('/work-next.js')) scripts.push('  <script type="module" src="/work-next.js"></script>');
      if (!html.includes('/reports-science-next.js')) scripts.push('  <script type="module" src="/reports-science-next.js"></script>');
      if (!html.includes('/report-match-refresh.js')) scripts.push('  <script type="module" src="/report-match-refresh.js"></script>');
      if (!html.includes('/plan-fact-next.js')) scripts.push('  <script type="module" src="/plan-fact-next.js"></script>');
      if (!html.includes('/plan-fact-tools.js')) scripts.push('  <script type="module" src="/plan-fact-tools.js"></script>');
      if (scripts.length) content = Buffer.from(html.replace('</body>', scripts.join('\n') + '\n</body>'));
    }
    response.writeHead(200, {
      'content-type': staticTypes.get(extname(path).toLowerCase()) || 'application/octet-stream',
      'content-length': content.length,
      'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    });
    response.end(content);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return false;
    throw error;
  }
}

export function requireHeader(request, name, message) {
  const value = request.headers[name.toLowerCase()];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('required_header_missing', message, 400, { header: name });
  }
  const result = value.trim();
  if (name.toLowerCase() === 'idempotency-key' && !IDEMPOTENCY_KEY_PATTERN.test(result)) {
    throw new AppError(
      'invalid_idempotency_key',
      'Ключ повторной операции должен быть коротким ASCII-значением без пробелов и управляющих символов.',
      400,
      { header: name, maxBytes: 96 }
    );
  }
  return result;
}
