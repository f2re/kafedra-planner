import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { AppError } from '../../../packages/core/src/errors.mjs';

const staticTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
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
  sendJson(response, status, {
    error: {
      code: error.code || 'internal_error',
      message: status >= 500 ? 'Внутренняя ошибка сервера.' : error.message,
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

export async function serveStatic(response, publicDir, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = normalize(requested).replace(/^([/\\])+/, '');
  if (relative.startsWith('..')) return false;
  const path = join(publicDir, relative);
  try {
    const content = await readFile(path);
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
  if (typeof value !== 'string' || !value.trim()) throw new AppError('required_header_missing', message, 400, { header: name });
  return value.trim();
}
