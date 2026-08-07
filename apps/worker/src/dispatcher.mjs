import { dispatchJob as dispatchDefaultJob } from './processor.mjs';
import { processPlanDocumentJob } from '../../../packages/plans/src/processor.mjs';

export async function dispatchJob(database, job, logger, config) {
  if (job.kind === 'process_plan_document') {
    return processPlanDocumentJob(database, JSON.parse(job.payload_json), logger, config);
  }
  if (job.kind === 'process_plan_template') {
    return processPlanDocumentJob(database, JSON.parse(job.payload_json), logger, config, { templateOnly: true });
  }
  return dispatchDefaultJob(database, job, logger, config);
}
