import { createHash } from 'node:crypto';

const PROMPT_VERSION = 'directive-v1';
const ALLOWED_KINDS = new Set(['decree', 'directive', 'order']);

export function extractJsonObject(value) {
  const text = String(value || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1] || text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
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

export function validateDirectiveProposal(output, sourceText) {
  const errors = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['proposal_not_object'] };
  }
  if (output.kind !== null && output.kind !== undefined && !ALLOWED_KINDS.has(output.kind)) errors.push('kind_invalid');
  for (const field of ['documentNumber', 'issuedAt', 'issuerRaw', 'title', 'direction']) {
    if (!stringOrNull(output[field], 1000)) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(output.assignments) || output.assignments.length > 100) {
    errors.push('assignments_invalid');
  } else {
    output.assignments.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`assignment_${index}_invalid`);
        return;
      }
      for (const field of ['itemNo', 'title', 'instructionText', 'dueDate', 'controller', 'expectedResult', 'sourceQuote']) {
        if (!stringOrNull(item[field], field === 'instructionText' || field === 'sourceQuote' ? 12000 : 2000)) {
          errors.push(`assignment_${index}_${field}_invalid`);
        }
      }
      if (!Array.isArray(item.executors) || item.executors.length > 20 || item.executors.some((value) => typeof value !== 'string' || value.length > 500)) {
        errors.push(`assignment_${index}_executors_invalid`);
      }
      if (!quoteExists(sourceText, item.sourceQuote)) errors.push(`assignment_${index}_source_quote_unverified`);
    });
  }
  return { valid: errors.length === 0, errors };
}

export function directivePrompt(text, deterministic) {
  return [
    'Извлеки структуру российского распорядительного документа.',
    'Верни только JSON. Не выдумывай отсутствующие сведения.',
    'Каждое предложенное поле должно иметь опору в исходном документе.',
    'Для каждого элемента assignments поле sourceQuote обязательно и должно быть точным фрагментом входного документа длиной не менее 8 символов.',
    'Схема: {kind, documentNumber, issuedAt, issuerRaw, title, direction, assignments:[{itemNo,title,instructionText,dueDate,executors,controller,expectedResult,sourceQuote}]}.',
    `Детерминированный результат для проверки: ${JSON.stringify(deterministic)}`,
    `Документ:\n${String(text || '').slice(0, 120000)}`
  ].join('\n\n');
}

function inputHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function safeEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/$/u, '');
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return raw.replace(/\?.*$/u, '').replace(/#.*$/u, '');
  }
}

function safeFailure(error) {
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (name.includes('timeout') || name === 'aborterror' || code.includes('timeout') || code === 'abort_err') return 'llm_timeout';
  const message = String(error?.message || '');
  if (/^llm_(?:http_\d+|invalid_json|unverified_proposal)$/u.test(message)) return message;
  return 'llm_request_failed';
}

function rawResponse(value) {
  return String(value || '').slice(0, 20000);
}

export async function proposeDirectiveWithLlama({ config, text, deterministic, fetchImpl = fetch }) {
  const inputSha256 = inputHash(text);
  if (!config?.llmEnabled || !config.llmEndpoint) {
    return { status: 'disabled', inputSha256, promptVersion: PROMPT_VERSION };
  }
  const started = Date.now();
  const endpoint = String(config.llmEndpoint).replace(/\/$/u, '');
  const recordedEndpoint = safeEndpoint(endpoint);
  try {
    const response = await fetchImpl(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.llmModel || 'local-model',
        temperature: 0,
        max_tokens: config.llmMaxTokens || 4096,
        messages: [
          { role: 'system', content: 'Ты локальный модуль извлечения. Возвращай только проверяемый JSON без пояснений.' },
          { role: 'user', content: directivePrompt(text, deterministic) }
        ]
      }),
      signal: AbortSignal.timeout(config.llmTimeoutMs || 45_000)
    });
    if (!response.ok) throw new Error(`llm_http_${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const output = extractJsonObject(content);
    if (!output) {
      return {
        status: 'failed', endpoint: recordedEndpoint,
        model: payload?.model || config.llmModel || null,
        promptVersion: PROMPT_VERSION, inputSha256,
        output: { rawResponse: rawResponse(content) },
        error: 'llm_invalid_json', durationMs: Date.now() - started
      };
    }
    const validation = validateDirectiveProposal(output, text);
    if (!validation.valid) {
      return {
        status: 'failed', endpoint: recordedEndpoint,
        model: payload?.model || config.llmModel || null,
        promptVersion: PROMPT_VERSION, inputSha256,
        output: { proposal: output, validation },
        error: 'llm_unverified_proposal', durationMs: Date.now() - started
      };
    }
    return {
      status: 'completed', endpoint: recordedEndpoint,
      model: payload?.model || config.llmModel || null,
      promptVersion: PROMPT_VERSION, inputSha256,
      output, validation, durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      status: 'failed', endpoint: recordedEndpoint,
      model: config.llmModel || null,
      promptVersion: PROMPT_VERSION, inputSha256,
      error: safeFailure(error), durationMs: Date.now() - started
    };
  }
}
