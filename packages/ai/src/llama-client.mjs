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

const PROTOCOL_TOP_FIELDS = new Set([
  'protocolNumber', 'meetingNumber', 'meetingDate', 'meetingDateRaw', 'chairperson', 'chairman',
  'secretary', 'quorum', 'attendees', 'agendaItems', 'agenda'
]);
const PROTOCOL_AGENDA_FIELDS = new Set([
  'itemNo', 'itemNumber', 'title', 'topic', 'startBoundary', 'heard', 'heardText', 'speaker',
  'discussed', 'discussedText', 'decision', 'decisionText', 'responsibleRaw', 'assignee',
  'dueDate', 'deadline', 'endBoundary', 'sourceQuote', 'decisions'
]);

export function validateProtocolProposal(output, sourceText) {
  const errors = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['proposal_not_object'] };
  }
  for (const field of unknownFields(output, PROTOCOL_TOP_FIELDS)) errors.push(`unknown_field:${field}`);
  for (const field of ['protocolNumber', 'meetingNumber', 'meetingDateRaw', 'chairperson', 'chairman', 'secretary']) {
    if (!stringOrNull(output[field], 1000)) errors.push(`${field}_invalid`);
  }
  if (!stringOrNull(output.meetingDate, 32) || !validIsoDateOrNull(output.meetingDate)) {
    errors.push('meetingDate_invalid');
  }
  if (output.attendees !== undefined && output.attendees !== null) {
    if (!Array.isArray(output.attendees) || output.attendees.some((a) => typeof a !== 'string' || a.length > 500)) {
      errors.push('attendees_invalid');
    }
  }
  const rawItems = Array.isArray(output.agendaItems) ? output.agendaItems : (Array.isArray(output.agenda) ? output.agenda : []);
  if (!Array.isArray(rawItems) || rawItems.length > 100) {
    errors.push('agendaItems_invalid');
  } else {
    rawItems.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`agenda_${index}_invalid`);
        return;
      }
      for (const field of unknownFields(item, PROTOCOL_AGENDA_FIELDS)) errors.push(`agenda_${index}_unknown_field:${field}`);
      const title = item.title || item.topic;
      if (title !== undefined && !stringOrNull(title, 2000)) errors.push(`agenda_${index}_title_invalid`);
      const due = item.dueDate || item.deadline;
      if (due && !validIsoDateOrNull(due)) errors.push(`agenda_${index}_dueDate_invalid`);
      if (item.sourceQuote && !quoteExists(sourceText, item.sourceQuote)) {
        errors.push(`agenda_${index}_source_quote_unverified`);
      }
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

export async function proposeProtocolWithLlama({ config, text, deterministic = null, fetchImpl = fetch }) {
  const inputSha256 = inputHash(text);
  const base = { inputSha256, promptVersion: 'protocol-extract-v1' };
  if (!config?.llmEnabled || !config.llmEndpoint) return { status: 'disabled', ...base };
  const started = Date.now();
  const endpoint = endpointFor(config.llmEndpoint);
  if (!endpoint) return { status: 'failed', ...base, error: 'llm_invalid_endpoint', durationMs: Date.now() - started };

  const systemPrompt = [
    'Ты — официальный аналитик протоколов заседаний кафедры.',
    'Твоя задача — извлечь из текста протокола точные реквизиты, кворум, состав участников и структурированную повестку дня.',
    'Извлеки:',
    '1) protocolNumber: номер протокола (строка);',
    '2) meetingDate: дата в формате YYYY-MM-DD;',
    '3) meetingDateRaw: точная фраза даты из текста;',
    '4) chairperson: председатель заседания (ФИО);',
    '5) secretary: секретарь заседания (ФИО);',
    '6) quorum: сведения о кворуме (всего членов кафедры, присутствовало, норма кворума, текстовая формулировка);',
    '7) attendees: список присутствовавших сотрудников и приглашенных (массив строк);',
    '8) agendaItems: упорядоченный список вопросов повестки дня.',
    'Для каждого вопроса повестки определи: itemNo (целое число), title (формулировка), startBoundary (начальная фраза вопроса), heard (кого и что заслушали), speaker (докладчик), discussed (ход обсуждения, выступления, результаты голосования), decision (принятое решение или постановление), responsibleRaw (ответственные лица), dueDate (срок исполнения YYYY-MM-DD), endBoundary (замыкающая фраза вопроса), sourceQuote (точная непрерывная выдержка из текста длиной 20-240 символов для подтверждения).',
    'Верни строго один валидный JSON-объект без Markdown вида:',
    '{"protocolNumber":"...","meetingDate":"YYYY-MM-DD","meetingDateRaw":"...","chairperson":"...","secretary":"...","quorum":{"total":15,"present":12,"required":10,"text":"..."},"attendees":["..."],"agendaItems":[{"itemNo":1,"title":"...","startBoundary":"...","heard":"...","speaker":"...","discussed":"...","decision":"...","responsibleRaw":"...","dueDate":"YYYY-MM-DD","endBoundary":"...","sourceQuote":"..."}]}.',
    'Не придумывай дат, фамилий и решений, которых нет в тексте.'
  ].join(' ');

  const body = {
    model: config.llmModel || 'local-model',
    temperature: 0,
    max_tokens: 3072,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(text || '').slice(0, 16000) }
    ],
    response_format: { type: 'json_object' }
  };

  let metadata = { task: 'protocol-extract-v1' };
  try {
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
    const validation = validateProtocolProposal(output, text);
    if (!validation.valid) return { status: 'failed', ...recorded,
      output: { proposal: output, validation }, error: 'llm_unverified_proposal' };
    return { status: 'completed', ...recorded, output, validation };
  } catch (error) {
    return { status: 'failed', ...base, endpoint, model: config.llmModel || null, metadata,
      error: safeFailure(error), durationMs: Date.now() - started };
  }
}

export async function analyzeTemplateWithLlama({ config, analysis, fetchImpl = fetch }) {
  const base = { promptVersion: 'template-structure-analyze-v1' };
  if (!config?.llmEnabled || !config.llmEndpoint) return { status: 'disabled', ...base };
  const started = Date.now();
  const endpoint = endpointFor(config.llmEndpoint);
  if (!endpoint) return { status: 'failed', ...base, error: 'llm_invalid_endpoint', durationMs: Date.now() - started };

  const projectionLines = (analysis.blocks || []).map((block) => {
    if (block.kind === 'paragraph') {
      return `[elem:${block.elementId}] ${block.text || ''}`;
    }
    if (block.kind === 'table') {
      const rows = (block.rows || []).map((r, rIdx) =>
        r.cells.map((c, cIdx) => c.paragraphs.map((p) => `(row:${rIdx+1},cell:${cIdx+1}) [elem:${p.elementId}] ${p.text}`).join(' ')).join(' | ')
      ).join('\n');
      return `[table:${block.elementId || `word/document.xml#body/table:${block.tableIndex}`}]\n${rows}`;
    }
    return '';
  }).filter(Boolean).join('\n');

  const systemPrompt = [
    'Ты — эксперт по анализу структуры шаблонов деловых документов (протоколов заседаний кафедры и выписок из протоколов).',
    'На вход передается текстовая проекция DOCX-документа с идентификаторами элементов [elem:word/document.xml#body/...].',
    'Определи места реквизитов (document_kind, protocol_number, meeting_date, meeting_title, chairperson, secretary, quorum) и границы повторяемого блока вопроса (startElementId, endElementId), а также поля внутри блока вопроса (item_no, title, heard, discussed, decision).',
    'Верни строго один JSON-объект вида:',
    '{"documentKind":"protocol","bindings":[{"field":"protocol_number","elementId":"word/document.xml#body/p:2","sampleText":"..."}],"repeat":{"kind":"block_range","startElementId":"word/document.xml#body/p:8","endElementId":"word/document.xml#body/p:12"},"confidence":0.95}.',
    'Используй только реально существующие в тексте идентификаторы [elem:...].'
  ].join(' ');

  const body = {
    model: config.llmModel || 'local-model',
    temperature: 0,
    max_tokens: 2560,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: projectionLines.slice(0, 16000) }
    ],
    response_format: { type: 'json_object' }
  };

  try {
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
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new Error('llm_invalid_response');
    const output = extractJsonObject(content);
    if (!output || typeof output !== 'object') {
      return { status: 'failed', error: 'llm_invalid_json', durationMs: Date.now() - started };
    }

    const elementsMap = new Map((analysis.elements || []).map((el) => [el.elementId, el]));
    const proposedBindings = [];
    for (const rawB of (Array.isArray(output.bindings) ? output.bindings : [])) {
      const field = String(rawB?.field || '').trim();
      const elementId = String(rawB?.elementId || '').trim();
      const element = elementsMap.get(elementId);
      if (!element) continue;
      const sampleText = String(rawB?.sampleText || rawB?.expectedText || '').trim();
      let startOffset = 0;
      let endOffset = element.text.length;
      if (sampleText && element.text.includes(sampleText)) {
        startOffset = element.text.indexOf(sampleText);
        endOffset = startOffset + sampleText.length;
      }
      if (endOffset > startOffset) {
        proposedBindings.push({
          field,
          elementId,
          startOffset,
          endOffset,
          expectedText: element.text.slice(startOffset, endOffset),
          confidence: Number(output.confidence || 0.9),
          reason: 'Предложено моделью LLM на основе анализа структуры'
        });
      }
    }

    return {
      status: 'completed',
      bindings: proposedBindings,
      repeat: output.repeat || null,
      documentKind: output.documentKind || 'protocol',
      confidence: Number(output.confidence || 0.9),
      durationMs: Date.now() - started
    };
  } catch (error) {
    return { status: 'failed', error: safeFailure(error), durationMs: Date.now() - started };
  }
}
