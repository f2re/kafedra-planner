import { finalizeProtocolRecognition } from '../../../packages/protocols/src/recognition-materialize.mjs';

export function applyProtocolRecognitionForJob(database,job,logger) {
  if (job.kind !== 'process_document') return {applied:false};
  let payload;
  try {payload=JSON.parse(job.payload_json);} catch {return {applied:false};}
  if (!payload?.documentId || !payload?.versionId) return {applied:false};
  const result=finalizeProtocolRecognition(database,payload);
  if (result.applied) logger?.info?.('protocol recognition finalized',result);
  return result;
}
