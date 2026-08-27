import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../packages/config/src/index.mjs';
import { openDatabase } from '../../packages/storage/src/database.mjs';
import { createDocumentService } from '../../packages/document-intake/src/service.mjs';
import { getAppVersion } from '../../packages/core/src/version.mjs';
import { scheduleWorkspaceNotifications } from '../../packages/notifications/src/service.mjs';
import { authorizeApiRequest } from '../../packages/auth/src/policy.mjs';
import { badRequest, forbidden, notFound, readBodyJson, sendError, sendJson } from './http-utils.mjs';
import { routeApi } from './router.mjs';
import { routeAccess } from './access-router.mjs';
import { routeAuth } from './auth-router.mjs';
import { routeOrganization } from './organization-router.mjs';
import { routeScienceLifecycle } from './science-lifecycle-router.mjs';
import { routeScienceImport } from './science-import-router-020.mjs';
import { routeScienceReports } from './science-reports-router-020.mjs';
import { routeMeetings } from './meetings-router.mjs';
import { routeMeetingTemplateLibrary } from './meeting-template-library-router.mjs';
import { routeMeetingTemplateProfiles } from './meeting-template-profile-router.mjs';
import { routePlanFact } from './plan-fact-router.mjs';
import { routeSupportingDocuments } from './supporting-documents-router.mjs';
import { routeWork } from './work-router.mjs';
import { routePlans } from './plans-router.mjs';
import { routePlanItems } from './plan-items-router.mjs';
import { routePlanSourceRows } from './plan-source-rows-router.mjs';
import { routeManualPlans } from './manual-plans-router.mjs';
import { routeAssignmentResponsibility } from './assignment-responsibility-router.mjs';
import { routeStandaloneAssignments } from './standalone-assignment-router.mjs';
import { routePeriodicTasks } from './periodic-tasks-router.mjs';
import { routeUiPreferences } from './ui-preferences-router.mjs';
import { routeUserCalendarSettings } from './user-calendar-settings-router.mjs';
import { routeReportMatches } from './report-matches-router.mjs';
import { routeLifecycle } from './lifecycle-router.mjs';
import { routePreview } from './preview-router.mjs';
import { routeSearch } from './search-router.mjs';
import { routeNotificationDelivery } from './notification-delivery-router.mjs';
import { routeDirectiveArchive } from './directive-archive-router.mjs';
import { routeDocomatorIntegration } from './docomator-integration-router.mjs';
import { routeAcademicPerformance } from './academic-performance-router.mjs';

const publicDir = fileURLToPath(new URL('../../../public', import.meta.url));

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relative = normalize(requested).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
  const filename = join(publicDir, relative);
  if (!filename.startsWith(publicDir)) {
    notFound();
  }
  return readFile(filename)
    .then((body) => {
      response.writeHead(200, {
        'content-type': contentTypes[extname(filename)] || 'application/octet-stream',
        'cache-control': 'no-cache'
      });
      response.end(body);
    })
    .catch((error) => {
      if (error?.code === 'ENOENT') notFound();
      throw error;
    });
}

export function createApp(options = {}) {
  const config = getConfig(options.env || process.env);
  const database = options.database || openDatabase(config.databasePath);
  const documentService = createDocumentService({ database, config });
  const version = getAppVersion();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    let workspace = null;

    try {
      if (pathname === '/health') {
        const health = database.healthCheck();
        sendJson(response, health.ok ? 200 : 503, {
          status: health.ok ? 'ok' : 'degraded',
          version,
          database: health,
          documents: documentService.capabilities()
        });
        return;
      }

      if (pathname === '/ready') {
        const health = database.healthCheck();
        sendJson(response, health.ok ? 200 : 503, {
          ready: health.ok,
          schemaVersion: health.schemaVersion,
          documents: documentService.capabilities()
        });
        return;
      }

      if (pathname.startsWith('/api/')) {
        workspace = database.getWorkspace();
        const authResult = await routeAuth(database, config, request, response, pathname, {
          workspace,
          readBodyJson
        });
        if (authResult) return;

        const authContext = authorizeApiRequest(database, config, request, pathname);
        request.auth = authContext.auth;
        request.session = authContext.session;
        request.authEnabled = authContext.authEnabled;
        request.authMode = authContext.mode;
        if (!request.auth && authContext.authEnabled) forbidden();

        const context = {
          workspace,
          readBodyJson,
          config,
          documentService
        };

        const accessResult = await routeAccess(database, request, response, pathname, context);
        if (accessResult) return;
        const organizationResult = await routeOrganization(database, request, response, pathname, context);
        if (organizationResult) return;
        const scienceLifecycleResult = await routeScienceLifecycle(database, request, response, pathname, context);
        if (scienceLifecycleResult) return;
        const scienceImportResult = await routeScienceImport(database, request, response, pathname, context);
        if (scienceImportResult) return;
        const scienceReportsResult = await routeScienceReports(database, request, response, pathname, context);
        if (scienceReportsResult) return;
        const meetingsResult = await routeMeetings(database, request, response, pathname, context);
        if (meetingsResult) return;
        const meetingTemplateLibraryResult = await routeMeetingTemplateLibrary(database, request, response, pathname, context);
        if (meetingTemplateLibraryResult) return;
        const meetingTemplateProfilesResult = await routeMeetingTemplateProfiles(database, request, response, pathname, context);
        if (meetingTemplateProfilesResult) return;
        const planFactResult = await routePlanFact(database, request, response, pathname, context);
        if (planFactResult) return;
        const supportingDocumentsResult = await routeSupportingDocuments(database, request, response, pathname, context);
        if (supportingDocumentsResult) return;
        const workResult = await routeWork(database, request, response, pathname, context);
        if (workResult) return;
        const plansResult = await routePlans(database, request, response, pathname, context);
        if (plansResult) return;
        const planItemsResult = await routePlanItems(database, request, response, pathname, context);
        if (planItemsResult) return;
        const planSourceRowsResult = await routePlanSourceRows(database, request, response, pathname, context);
        if (planSourceRowsResult) return;
        const manualPlansResult = await routeManualPlans(database, request, response, pathname, context);
        if (manualPlansResult) return;
        const assignmentResponsibilityResult = await routeAssignmentResponsibility(database, request, response, pathname, context);
        if (assignmentResponsibilityResult) return;
        const standaloneAssignmentResult = await routeStandaloneAssignments(database, request, response, pathname, context);
        if (standaloneAssignmentResult) return;
        const periodicTasksResult = await routePeriodicTasks(database, request, response, pathname, context);
        if (periodicTasksResult) return;
        const uiPreferencesResult = await routeUiPreferences(database, request, response, pathname, context);
        if (uiPreferencesResult) return;
        const userCalendarSettingsResult = await routeUserCalendarSettings(database, request, response, pathname, context);
        if (userCalendarSettingsResult) return;
        const reportMatchesResult = await routeReportMatches(database, request, response, pathname, context);
        if (reportMatchesResult) return;
        const lifecycleResult = await routeLifecycle(database, request, response, pathname, context);
        if (lifecycleResult) return;
        const previewResult = await routePreview(database, request, response, pathname, context);
        if (previewResult) return;
        const searchResult = await routeSearch(database, request, response, pathname, context);
        if (searchResult) return;
        const notificationDeliveryResult = await routeNotificationDelivery(database, request, response, pathname, context);
        if (notificationDeliveryResult) return;
        const directiveArchiveResult = await routeDirectiveArchive(database, request, response, pathname, context);
        if (directiveArchiveResult) return;
        const docomatorIntegrationResult = await routeDocomatorIntegration(database, request, response, pathname, context);
        if (docomatorIntegrationResult) return;
        const academicPerformanceResult = await routeAcademicPerformance(database, request, response, pathname, context);
        if (academicPerformanceResult) return;
        await routeApi(database, request, response, pathname, context);
        return;
      }

      await serveStatic(pathname, response);
    } catch (error) {
      if (!response.headersSent) {
        if (error?.code === 'bad_request') {
          sendJson(response, 400, { error: { code: error.details?.code || 'bad_request', details: error.details || null } });
          return;
        }
        if (error?.code === 'forbidden') {
          sendJson(response, 403, { error: { code: 'forbidden' } });
          return;
        }
        if (error?.code === 'not_found') {
          sendJson(response, 404, { error: { code: 'not_found' } });
          return;
        }
        if (error?.code === 'conflict') {
          sendJson(response, 409, { error: { code: 'conflict', details: error.details || null } });
          return;
        }
        sendError(response, error, config.environment === 'production' ? null : error.stack);
      } else {
        response.end();
      }
    }
  });

  server.on('close', () => database.close());
  return { server, database, config, documentService };
}

export function startNotificationScheduler(database, env = process.env) {
  const intervalMs = Number(env.KAFEDRA_NOTIFICATION_INTERVAL_MS || 60_000);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('KAFEDRA_NOTIFICATION_INTERVAL_MS must be a positive number');
  }
  const tick = () => {
    try {
      const workspace = database.getWorkspace();
      scheduleWorkspaceNotifications(database, workspace.id);
    } catch (error) {
      console.error('[notifications]', error);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
