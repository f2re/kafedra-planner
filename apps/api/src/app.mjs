import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRouter } from './router.mjs';
import { createPlanFactRouter } from './plan-fact-router.mjs';
import { createPlansRouter } from './plans-router.mjs';
import { createPlanItemsRouter } from './plan-items-router.mjs';
import { createManualPlansRouter } from './manual-plans-router.mjs';
import { createMeetingsRouter } from './meetings-router.mjs';
import { createUiPreferencesRouter } from './ui-preferences-router.mjs';
import { createNotificationDeliveryRouter } from './notification-delivery-router.mjs';
import { createAssignmentResponsibilityRouter } from './assignment-responsibility-router.mjs';
import { createPeriodicTasksRouter } from './periodic-tasks-router.mjs';
import { createSearchRouter } from './search-router.mjs';
import { createAuthRouter } from './auth-router.mjs';
import { createAccessRouter } from './access-router.mjs';
import { createOrganizationRouter } from './organization-router.mjs';
import { createScienceLifecycleRouter } from './science-lifecycle-router.mjs';
import { createScienceImportRouter020 } from './science-import-router-020.mjs';
import { createScienceReportsRouter } from './science-reports-router.mjs';
import { resolveAuthContext } from '../../../packages/auth/src/service.mjs';
import { authorizeApiRequest } from '../../../packages/auth/src/policy.mjs';
import { authorizeCsrfRequest } from '../../../packages/auth/src/csrf.mjs';
import { sendError, serveStatic } from './http-utils.mjs';

export function createApp({ database, config, logger }) {
  const authRouter = createAuthRouter({ database, config, logger });
  const accessRouter = createAccessRouter({ database, config, logger });
  const uiPreferencesRouter = createUiPreferencesRouter({ database, config, logger });
  const notificationDeliveryRouter = createNotificationDeliveryRouter({ database, config, logger });
  const assignmentResponsibilityRouter = createAssignmentResponsibilityRouter({ database, config, logger });
  const periodicTasksRouter = createPeriodicTasksRouter({ database, config, logger });
  const searchRouter = createSearchRouter({ database, config, logger });
  const manualPlansRouter = createManualPlansRouter({ database, config, logger });
  const planItemsRouter = createPlanItemsRouter({ database, config, logger });
  const plansRouter = createPlansRouter({ database, config, logger });
  const meetingsRouter = createMeetingsRouter({ database, config, logger });
  const organizationRouter = createOrganizationRouter({ database, logger });
  const scienceLifecycleRouter = createScienceLifecycleRouter({ database, logger });
  const scienceImportRouter020 = createScienceImportRouter020({ database });
  const scienceReportsRouter = createScienceReportsRouter({ database, config, logger });
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
          const preferencesHandled = await uiPreferencesRouter(request, response, url, requestId);
          const notificationHandled = !preferencesHandled && !response.headersSent
            ? await notificationDeliveryRouter(request, response, url, requestId)
            : false;
          const responsibilityHandled = !preferencesHandled && !notificationHandled && !response.headersSent
            ? await assignmentResponsibilityRouter(request, response, url, requestId)
            : false;
          const periodicHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !response.headersSent
            ? await periodicTasksRouter(request, response, url, requestId)
            : false;
          const searchHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !response.headersSent
            ? await searchRouter(request, response, url, requestId)
            : false;
          const manualPlansHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !response.headersSent
            ? await manualPlansRouter(request, response, url, requestId)
            : false;
          const planItemHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !manualPlansHandled && !response.headersSent
            ? await planItemsRouter(request, response, url, requestId)
            : false;
          const plansHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !manualPlansHandled && !planItemHandled && !response.headersSent
            ? await plansRouter(request, response, url, requestId)
            : false;
          const meetingsHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !manualPlansHandled && !planItemHandled && !plansHandled && !response.headersSent
            ? await meetingsRouter(request, response, url, requestId)
            : false;
          const accessHandled = !preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !manualPlansHandled && !planItemHandled && !plansHandled && !meetingsHandled && !response.headersSent && request.auth?.enabled
            ? await accessRouter(request, response, url, requestId)
            : false;
          let extensionHandled = false;
          if (!preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !manualPlansHandled && !planItemHandled && !plansHandled && !meetingsHandled && !accessHandled && !response.headersSent) {
            extensionHandled = await organizationRouter(request, response, url, requestId);
            if (!extensionHandled && !response.headersSent) extensionHandled = await scienceLifecycleRouter(request, response, url, requestId);
            if (!extensionHandled && !response.headersSent) extensionHandled = await scienceImportRouter020(request, response, url, requestId);
            if (!extensionHandled && !response.headersSent) extensionHandled = await scienceReportsRouter(request, response, url, requestId);
          }
          if (!preferencesHandled && !notificationHandled && !responsibilityHandled && !periodicHandled && !searchHandled && !manualPlansHandled && !planItemHandled && !plansHandled && !meetingsHandled && !accessHandled && !extensionHandled && !response.headersSent) {
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
