import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../../core/src/errors.mjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set(['/api/auth/login', '/api/auth/setup-pin']);

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authorizeCsrfRequest(request, context, path, config) {
  if (!config.authEnabled || !config.authCsrfEnabled) return true;
  const method = String(request.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method) || EXEMPT_PATHS.has(path)) return true;
  if (!context?.authenticated) {
    throw new AppError('authentication_required', 'Требуется вход в систему.', 401);
  }
  const supplied = request.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !constantTimeEqual(supplied, context.csrfToken)) {
    throw new AppError(
      'csrf_token_invalid',
      'Защитный токен запроса отсутствует или устарел. Обновите страницу и повторите действие.',
      403
    );
  }
  return true;
}
