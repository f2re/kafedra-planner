import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonObject,
  proposeDirectiveWithLlama,
  validateDirectiveProposal
} from '../packages/ai/src/llama-client.mjs';

const source = 'ПРИКАЗ № 7. 1. Подготовить отчёт до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.';
const proposal = {
  kind: 'order', documentNumber: '7', issuedAt: null, issuerRaw: null,
  title: 'О подготовке отчёта', direction: 'science',
  assignments: [{
    itemNo: '1', title: 'Подготовить отчёт', instructionText: 'Подготовить отчёт до 20 августа 2026 года.',
    dueDate: '2026-08-20', executors: ['Иванов Иван Иванович'], controller: null,
    expectedResult: 'Отчёт', sourceQuote: 'Подготовить отчёт до 20 августа 2026 года.'
  }]
};

function config(overrides = {}) {
  return {
    llmEnabled: true,
    llmEndpoint: 'http://user:secret@127.0.0.1:8081?token=hidden',
    llmModel: 'test-model', llmTimeoutMs: 1000, llmMaxTokens: 1024,
    ...overrides
  };
}

function response(content, { status = 200, model = 'test-model' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ model, choices: [{ message: { content } }] })
  };
}

test('извлекает JSON из fenced-ответа', () => {
  assert.deepEqual(extractJsonObject('```json\n{"kind":"order"}\n```'), { kind: 'order' });
  assert.equal(extractJsonObject('нет json'), null);
});

test('валидатор принимает только allowlist, реальные цитаты и корректные ISO-даты', () => {
  assert.equal(validateDirectiveProposal(proposal, source).valid, true);

  const forged = structuredClone(proposal);
  forged.assignments[0].sourceQuote = 'Этого текста в документе не существует';
  assert.match(validateDirectiveProposal(forged, source).errors.join(','), /source_quote_unverified/u);

  const unknown = structuredClone(proposal);
  unknown.secretInstruction = 'применить без проверки';
  unknown.assignments[0].confidence = 1;
  const unknownValidation = validateDirectiveProposal(unknown, source);
  assert.equal(unknownValidation.valid, false);
  assert.match(unknownValidation.errors.join(','), /unknown_field/u);

  const impossibleDate = structuredClone(proposal);
  impossibleDate.issuedAt = '2026-02-30';
  impossibleDate.assignments[0].dueDate = '30.08.2026';
  const dateValidation = validateDirectiveProposal(impossibleDate, source);
  assert.equal(dateValidation.valid, false);
  assert.match(dateValidation.errors.join(','), /issuedAt_invalid/u);
  assert.match(dateValidation.errors.join(','), /dueDate_invalid/u);
});

test('отключённый LLM не выполняет сетевой запрос', async () => {
  let called = false;
  const result = await proposeDirectiveWithLlama({
    config: { llmEnabled: false }, text: source, deterministic: {},
    fetchImpl: async () => { called = true; throw new Error('must_not_call'); }
  });
  assert.equal(result.status, 'disabled');
  assert.equal(result.promptVersion, 'directive-v2');
  assert.equal(result.inputSha256.length, 64);
  assert.equal(called, false);
});

test('валидное предложение принимается только с проверяемой цитатой', async () => {
  const result = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => response(JSON.stringify(proposal))
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.promptVersion, 'directive-v2');
  assert.equal(result.validation.valid, true);
  assert.equal(result.endpoint, 'http://127.0.0.1:8081');
  assert.equal(result.output.assignments[0].dueDate, '2026-08-20');
});

test('поддельная sourceQuote и неизвестные поля не становятся completed', async () => {
  const forged = structuredClone(proposal);
  forged.assignments[0].sourceQuote = 'Выдуманный фрагмент исходного документа';
  forged.untrusted = true;
  const result = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => response(JSON.stringify(forged))
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'llm_unverified_proposal');
  assert.equal(result.output.validation.valid, false);
  assert.equal(result.endpoint.includes('secret'), false);
  assert.equal(result.endpoint.includes('token='), false);
});

test('невалидный JSON и сломанный OpenAI-ответ диагностируются безопасно', async () => {
  const invalidJson = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => response('модель вернула не JSON')
  });
  assert.equal(invalidJson.status, 'failed');
  assert.equal(invalidJson.error, 'llm_invalid_json');
  assert.match(invalidJson.output.rawResponse, /не JSON/u);

  const broken = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) })
  });
  assert.equal(broken.status, 'failed');
  assert.equal(broken.error, 'llm_invalid_response');
});

test('сетевая ошибка, HTTP и timeout не раскрывают endpoint credentials', async () => {
  const network = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async (url) => { throw new Error(`connect ${url}`); }
  });
  assert.equal(network.status, 'failed');
  assert.equal(network.error, 'llm_request_failed');
  assert.equal(JSON.stringify(network).includes('secret'), false);

  const http = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => response('', { status: 503 })
  });
  assert.equal(http.error, 'llm_http_503');
  assert.equal(JSON.stringify(http).includes('secret'), false);

  const timeoutError = new Error('timeout at secret endpoint');
  timeoutError.name = 'TimeoutError';
  const timeout = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => { throw timeoutError; }
  });
  assert.equal(timeout.error, 'llm_timeout');
  assert.equal(JSON.stringify(timeout).includes('secret'), false);
});
