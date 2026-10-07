import { createHash } from 'node:crypto';
import { DIRECTIVE_TASK, prepareDirectiveTask } from './directive-task.mjs';
export { directivePrompt } from './directive-task.mjs';

const PROMPT_VERSION = DIRECTIVE_TASK.version;
const MAX_RESPONSE_BYTES = 32_768;
const ALLOWED_KINDS = new Set(['decree', 'directive', 'order']);
const TOP_LEVEL_FIELDS = new Set([
  'kind', 'documentNumber', 'issuedAt', 'issuerRaw', 'title', 'direction', 'assignments'
]);
const ASSIGNMENT_FIELDS = new Set([
  'itemNo', 'title', 'instructionText', 'dueDate', 'executors', 'controller', 'expectedResult', 'sourceQuote'
]);

export function extractJsonObject(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_RESPONSE_BYTES) return null;
  const text = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
  try {
    const output = JSON.parse(fenced ? fenced[1] : text);
    return output && typeof output === 'object' && !Array.isArray(output) ? output : null;
  } catch { return null; }
}

function normalizedQuote(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
}

function quoteExists(text, quote) {
  const source = normalizedQuote(text);
  const candidate = normalizedQuote(quote);
  return candidate.length >= 8 && source.includes(candidate);
}

function stringOrNull(value, max = 5000) {
  return value === null || value === undefined || (typeof value === 'string' && value.length <= max);
}

function validIsoDateOrNull(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function unknownFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => !allowed.has(key));
}

export function validateDirectiveProposal(output, sourceText) {
  const errors = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['proposal_not_object'] };
  }

  for (const field of unknownFields(output, TOP_LEVEL_FIELDS)) errors.push(`unknown_field:${field}`);
  if (output.kind !== null && output.kind !== undefined && !ALLOWED_KINDS.has(output.kind)) errors.push('kind_invalid');
  for (const field of ['documentNumber', 'issuerRaw', 'title', 'direction']) {
    if (!stringOrNull(output[field], 1000)) errors.push(`${field}_invalid`);
  }
  if (!stringOrNull(output.issuedAt, 32) || !validIsoDateOrNull(output.issuedAt)) errors.push('issuedAt_invalid');

  if (!Array.isArray(output.assignments) || output.assignments.length > 100) {
    errors.push('assignments_invalid');
  } else {
    output.assignments.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`assignment_${index}_invalid`);
        return;
      }
      for (const field of unknownFields(item, ASSIGNMENT_FIELDS)) errors.push(`assignment_${index}_unknown_field:${field}`);
      for (const field of ['itemNo', 'title', 'instructionText', 'controller', 'expectedResult', 'sourceQuote']) {
        if (!stringOrNull(item[field], field === 'instructionText' || field === 'sourceQuote' ? 12000 : 2000)) {
          errors.push(`assignment_${index}_${field}_invalid`);
        }
      }
      if (!stringOrNull(item.dueDate, 32) || !validIsoDateOrNull(item.dueDate)) {
        errors.push(`assignment_${index}_dueDate_invalid`);
      }
      if (!Array.isArray(item.executors) || item.executors.length > 20 || item.executors.some((value) => typeof value !== 'string' || value.length > 500)) {
        errors.push(`assignment_${index}_executors_invalid`);
      }
      if (!quoteExists(sourceText, item.sourceQuote)) errors.push(`assignment_${index}_source_quote_unverified`);
    });
  }
  return { valid: errors.length === 0, errors };
}

function inputHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function endpointFor(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/u, '').replace(/\/v1$/u, '');
  } catch { return null; }
}

function safeFailure(error) {
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (name.includes('timeout') || name === 'aborterror' || code.includes('timeout') || code === 'abort_err') return 'llm_timeout';
  const message = String(error?.message || '');
  if (/^llm_(?:http_\d+|invalid_json|invalid_response|unverified_proposal|context_too_small|response_too_large)$/u.test(message)) return message;
  return 'llm_request_failed';
}

async function readResponse(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('llm_response_too_large');
  }
  if (!response.body) throw new Error('llm_invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('llm_response_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks, length).toString('utf8')); }
    catch { throw new Error('llm_invalid_response'); }
  } finally { reader.releaseLock(); }
}

export async function proposeDirectiveWithLlama({ config, text, deterministic, fetchImpl = fetch }) {
  const inputSha256 = inputHash(text);
  const base = { inputSha256, promptVersion: PROMPT_VERSION };
  if (!config?.llmEnabled || !config.llmEndpoint) return { status: 'disabled', ...base };
  const started = Date.now();
  const endpoint = endpointFor(config.llmEndpoint);
  if (!endpoint) return { status: 'failed', ...base, error: 'llm_invalid_endpoint', durationMs: Date.now() - started };
  let metadata;
  try {
    const task = prepareDirectiveTask(text, deterministic, config);
    metadata = task.metadata;
    const body = task.body;
    const signal = AbortSignal.timeout(config.llmTimeoutMs || 45_000);
    const send = () => fetchImpl(`${endpoint}/v1/chat/completions`, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal
    });
    let response = await send();
    if ([400, 422].includes(response.status)) {
      await response.body?.cancel();
      delete body.response_format;
      response = await send();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`llm_http_${response.status}`);
    }
    const payload = await readResponse(response);
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === 'length' || choice?.finish_reason === 'tool_calls'
      || choice?.finish_reason === 'function_call' || choice?.message?.tool_calls?.length
      || choice?.message?.function_call || choice?.message?.refusal) throw new Error('llm_invalid_response');
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new Error('llm_invalid_response');
    const recorded = { ...base, endpoint, model: payload?.model || config.llmModel || null,
      metadata, durationMs: Date.now() - started };
    const output = extractJsonObject(content);
    if (!output) return { status: 'failed', ...recorded,
      output: { rawResponse: content.slice(0, 20000) }, error: 'llm_invalid_json' };
    const validation = validateDirectiveProposal(output, text);
    if (!validation.valid) return { status: 'failed', ...recorded,
      output: { proposal: output, validation }, error: 'llm_unverified_proposal' };
    return { status: 'completed', ...recorded, output, validation };
  } catch (error) {
    return { status: 'failed', ...base, endpoint, model: config.llmModel || null, metadata,
      error: safeFailure(error), durationMs: Date.now() - started };
  }
}
