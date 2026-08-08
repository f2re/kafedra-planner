import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRouter } from './router.mjs';
import { createPlanFactRouter } from './plan-fact-router.mjs';
import { createPlansRouter } from './plans-router.mjs';
import { createPlanItemsRouter } from './plan-items-router.mjs';
import { createNotificationDeliveryRouter } from './notification-delivery-router.mjs';
import { createAssignmentResponsibilityRouter } from './assignment-responsibility-router.mjs';
import { createPeriodicTasksRouter } from './periodic-tasks-router.mjs';
import { createAuthRouter } from './auth-router.mjs';
import { createAccessRouter } from './access-router.mjs';
import { resolveAuthContext } from '../../../packages/auth/src/service.mjs';
import { authorizeApiRequest } from '../../../packages/auth/src/policy.mjs';
import { authorizeCsrfRequest } from '../../../packages/auth/src/csrf.mjs';
import { sendError, serveStatic } from './http-utils.mjs';

export function createApp({ database, config, logger }) {
  const authRouter = createAuthRouter({ database, config, logger });
  const accessRouter = createAccessRouter({ database, config, logger });
  const notificationDeliveryRouter = createNotificationDeliveryRouter({ database, config, logger });
  const assignmentResponsibilityRouter = createAssignmentResponsibilityRouter({ database, config, logger });
  const periodicTasksRouter = createPeriodicTasksRouter({ database, config, logger });
  const planItemsRouter = createPlanItemsRouter({ database, config, logger });
  const plansRouter = createPlansRouter({ database, config, logger });
  const planFactRouter = createPlanFactRouter({ database, config, logger });
  const router = createRouter({ database, config, logger });
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-frame-options', 'SAMEORIGIN');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'self'; frame-src 'self'; base-uri 'none'; frame-ancestors 'self'"
    );
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      request.auth = resolveAuthContext(database, request, config);
      if (request.auth?.enabled && request.auth.authenticated && request.auth.workspaceId) {
        request.headers['x-workspace-id'] = request.auth.workspaceId;
      }
      if (url.pathname.startsWith('/api/')) {
        authorizeCsrfRequest(request, request.auth, url.pathname, config);
        const authHandled = await authRouter(request, response, url, requestId);
        if (!authHandled && !response.headersSent) {
          authorizeApiRequest(request.auth, url.pathname);
          const notificationHandled = await notificationDeliveryRouter(request, response, url, requestId);
          const responsibilityHandled = !notificationHandled && !response.headersSent
            ? await assignmentResponsibilityRouter(request, response, url, requestId)
            : false;
          const periodicHandled = !notificationHandled && !responsibilityHandled && !response.headersSent
            ? await periodicTasksRouter(request, response, url, requestId)
            : false;
          const planItemHandled = !notificationHandled && !responsibilityHandled && !periodicHandled && !response.headersSent
            ? await planItemsRouter(request, response, url, requestId)
            : false;
          const plansHandled = !notificationHandled && !responsibilityHandled && !periodicHandled && !planItemHandled && !response.headersSent
            ? await plansRouter(request, response, url, requestId)
            : false;
          const accessHandled = !notificationHandled && !responsibilityHandled && !periodicHandled && !planItemHandled && !plansHandled && !response.headersSent && request.auth?.enabled
            ? await accessRouter(request, response, url, requestId)
            : false;
          if (!notificationHandled && !responsibilityHandled && !periodicHandled && !planItemHandled && !plansHandled && !accessHandled && !response.headersSent) {
            const handled = await planFactRouter(request, response, url, requestId);
            if (!handled && !response.headersSent) await router(request, response, url, requestId);
          }
        }
      } else if (!(await serveStatic(response, config.publicDir, url.pathname))) {
        if (!(await serveStatic(response, config.publicDir, '/index.html'))) response.end();
      }
    } catch (error) {
      if (!response.headersSent) sendError(response, error, requestId);
      else response.destroy(error);
      logger.error('request failed', {
        requestId,
        method: request.method,
        url: request.url,
        error: String(error?.stack || error)
      });
    } finally {
      logger.info('request completed', {
        requestId,
        method: request.method,
        url: request.url,
        status: response.statusCode,
        durationMs: Date.now() - started,
        accountId: request.auth?.accountId || null,
        personId: request.auth?.personId || null
      });
    }
  });
}
