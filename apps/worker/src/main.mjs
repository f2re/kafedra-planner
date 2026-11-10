import { hostname } from 'node:os';
import { loadConfig } from '../../../packages/config/src/index.mjs';
import { createLogger } from '../../../packages/core/src/logger.mjs';
import { Database } from '../../../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../../../packages/storage/src/bootstrap.mjs';
import { acquireJob, completeJob, failJob } from '../../../packages/storage/src/jobs.mjs';
import {
  materializeNotificationDeliveries,
  processNotificationDeliveryJob
} from '../../../packages/notifications/src/service.mjs';
import { dispatchJob } from './processor.mjs';
import { applyProtocolRecognitionForJob } from './protocol-recognition-job.mjs';
import {
  applyProtocolProfileForJob,
  shouldApplyProtocolProfileForJob
} from './protocol-profile-job.mjs';

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: 'worker' });
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
ensureDefaultWorkspace(database);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
let nextNotificationSweep = 0;
let pendingPlanLlm = null;

function finishOptionalPlanJob(job, error = null) {
  return database.transaction(() => {
    const current = database.get('SELECT status, locked_by FROM jobs WHERE id = ?', job.id);
    if (current?.status !== 'running' || current.locked_by !== workerId) return false;
    if (error) failJob(database, job, error);
    else completeJob(database, job.id);
    return true;
  });
}

function startOptionalPlanJob(job, jobLogger) {
  pendingPlanLlm = dispatchJob(database, job, jobLogger, config)
    .then(() => {
      if (finishOptionalPlanJob(job)) jobLogger.info('optional plan job completed');
    })
    .catch((error) => {
      finishOptionalPlanJob(job, error);
      jobLogger.error('optional plan job failed', { error: String(error?.stack || error) });
    })
    .finally(() => { pendingPlanLlm = null; });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    logger.info('worker stopping', { signal });
  });
}

logger.info('worker started', { workerId, databasePath: config.databasePath });
while (!stopping) {
  if (config.notificationDeliveryEnabled && Date.now() >= nextNotificationSweep) {
    nextNotificationSweep = Date.now() + config.notificationSweepMs;
    try {
      const sweep = materializeNotificationDeliveries(database, config);
      if (sweep.created || sweep.errors.length) {
        logger.info('notification delivery sweep', sweep);
      }
    } catch (error) {
      logger.error('notification delivery sweep failed', { error: String(error?.stack || error) });
    }
  }

  const job = acquireJob(database, workerId, config.workerLeaseSeconds, new Date(), {
    excludeKinds: [
      ...(config.notificationDeliveryEnabled ? [] : ['deliver_notification']),
      ...(pendingPlanLlm ? ['enrich_plan'] : [])
    ]
  });
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
    continue;
  }
  const jobLogger = logger.child({ jobId: job.id, jobKind: job.kind });
  if (job.kind === 'enrich_plan') {
    // One bounded optional request can run while new files keep importing.
    // Completion and failures are recorded only after the request settles.
    startOptionalPlanJob(job, jobLogger);
    continue;
  }
  try {
    if (job.kind === 'deliver_notification') {
      await processNotificationDeliveryJob(database, job, jobLogger, config);
    } else {
      const applyProtocolProfile = shouldApplyProtocolProfileForJob(database, job);
      await dispatchJob(database, job, jobLogger, config);
      if (applyProtocolProfile) await applyProtocolProfileForJob(database, job, jobLogger);
      applyProtocolRecognitionForJob(database, job, jobLogger);
    }
    completeJob(database, job.id);
    jobLogger.info('job completed');
  } catch (error) {
    failJob(database, job, error);
    jobLogger.error('job failed', { error: String(error?.stack || error) });
  }
}

if (pendingPlanLlm) await pendingPlanLlm;
database.close();
logger.info('worker stopped');
