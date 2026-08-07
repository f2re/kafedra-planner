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

test('валидатор отклоняет выдуманную sourceQuote', () => {
  assert.equal(validateDirectiveProposal(proposal, source).valid, true);
  const forged = structuredClone(proposal);
  forged.assignments[0].sourceQuote = 'Этого текста в документе не существует';
  const validation = validateDirectiveProposal(forged, source);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(','), /source_quote_unverified/u);
});

test('отключённый LLM не выполняет сетевой запрос', async () => {
  let called = false;
  const result = await proposeDirectiveWithLlama({
    config: { llmEnabled: false }, text: source, deterministic: {},
    fetchImpl: async () => { called = true; throw new Error('must_not_call'); }
  });
  assert.equal(result.status, 'disabled');
  assert.equal(result.inputSha256.length, 64);
  assert.equal(called, false);
});

test('валидное предложение принимается только с проверяемой цитатой', async () => {
  const result = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => response(JSON.stringify(proposal))
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.validation.valid, true);
  assert.equal(result.endpoint, 'http://127.0.0.1:8081');
  assert.equal(result.output.assignments[0].dueDate, '2026-08-20');
});

test('поддельная sourceQuote сохраняется как непригодное предложение и не считается completed', async () => {
  const forged = structuredClone(proposal);
  forged.assignments[0].sourceQuote = 'Выдуманный фрагмент исходного документа';
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

test('невалидный JSON диагностируется и сохраняет ограниченный сырой ответ', async () => {
  const result = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => response('модель вернула не JSON')
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'llm_invalid_json');
  assert.match(result.output.rawResponse, /не JSON/u);
});

test('сетевая ошибка и timeout не раскрывают endpoint credentials', async () => {
  const network = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async (url) => { throw new Error(`connect ${url}`); }
  });
  assert.equal(network.status, 'failed');
  assert.equal(network.error, 'llm_request_failed');
  assert.equal(JSON.stringify(network).includes('secret'), false);

  const timeoutError = new Error('timeout at secret endpoint');
  timeoutError.name = 'TimeoutError';
  const timeout = await proposeDirectiveWithLlama({
    config: config(), text: source, deterministic: {},
    fetchImpl: async () => { throw timeoutError; }
  });
  assert.equal(timeout.error, 'llm_timeout');
  assert.equal(JSON.stringify(timeout).includes('secret'), false);
});
