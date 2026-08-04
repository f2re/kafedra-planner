import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRouter } from './router.mjs';
import { sendError, serveStatic } from './http-utils.mjs';

export function createApp({ database, config, logger }) {
  const router = createRouter({ database, config, logger });
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await router(request, response, url, requestId);
      } else if (!(await serveStatic(response, config.publicDir, url.pathname))) {
        if (!(await serveStatic(response, config.publicDir, '/index.html'))) response.end();
      }
    } catch (error) {
      if (!response.headersSent) sendError(response, error, requestId);
      else response.destroy(error);
      logger.error('request failed', { requestId, method: request.method, url: request.url, error: String(error?.stack || error) });
    } finally {
      logger.info('request completed', {
        requestId,
        method: request.method,
        url: request.url,
        status: response.statusCode,
        durationMs: Date.now() - started
      });
    }
  });
}
