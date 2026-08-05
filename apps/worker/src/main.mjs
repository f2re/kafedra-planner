import { hostname } from 'node:os';
import { loadConfig } from '../../../packages/config/src/index.mjs';
import { createLogger } from '../../../packages/core/src/logger.mjs';
import { Database } from '../../../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../../../packages/storage/src/bootstrap.mjs';
import { acquireJob, completeJob, failJob } from '../../../packages/storage/src/jobs.mjs';
import { dispatchJob } from './processor.mjs';

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: 'worker' });
const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
ensureDefaultWorkspace(database);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    logger.info('worker stopping', { signal });
  });
}

logger.info('worker started', { workerId, databasePath: config.databasePath });
while (!stopping) {
  const job = acquireJob(database, workerId, config.workerLeaseSeconds);
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
    continue;
  }
  const jobLogger = logger.child({ jobId: job.id, jobKind: job.kind });
  try {
    await dispatchJob(database, job, jobLogger, config);
    completeJob(database, job.id);
    jobLogger.info('job completed');
  } catch (error) {
    failJob(database, job, error);
    jobLogger.error('job failed', { error: String(error?.stack || error) });
  }
}

database.close();
logger.info('worker stopped');
