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

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: 'worker' });
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
ensureDefaultWorkspace(database);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
let nextNotificationSweep = 0;

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

  const job = acquireJob(database, workerId, config.workerLeaseSeconds);
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
    continue;
  }
  const jobLogger = logger.child({ jobId: job.id, jobKind: job.kind });
  try {
    if (job.kind === 'deliver_notification') {
      await processNotificationDeliveryJob(database, job, jobLogger, config);
    } else {
      await dispatchJob(database, job, jobLogger, config);
    }
    completeJob(database, job.id);
    jobLogger.info('job completed');
  } catch (error) {
    failJob(database, job, error);
    jobLogger.error('job failed', { error: String(error?.stack || error) });
  }
}

database.close();
logger.info('worker stopped');