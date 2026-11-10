import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_TASK, chunkPlanRows, preparePlanTask, proposePlanWithLlama, validatePlanProposal
} from '../packages/ai/src/plan-task.mjs';

const period = { kind: 'calendar', key: '2026', yearStart: 2026, yearEnd: 2026 };
const row = {
  sourceRowKey: 'table:1:row:2', locator: { table: 1, row: 2 },
  rawText: 'Подготовить методические указания | до 20 ноября | Иванов И.И. | Методические указания'
};
const item = (overrides = {}) => ({
  sourceRowKey: row.sourceRowKey, title: 'Подготовить методические указания', sourceQuote: row.rawText,
  dateRaw: null, deadlineRaw: 'до 20 ноября', responsibleRaw: 'Иванов И.И.',
  expectedResult: 'Методические указания', activityKind: 'methodological', ...overrides
});
const response = (output, extra = {}) => new Response(JSON.stringify({
  model: 'local-qwen-fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) }, ...extra }]
}), { headers: { 'content-type': 'application/json' } });

test('plan proposal verifies each field, derives dates from source and keeps good rows after bad ones', () => {
  const result = validatePlanProposal({ items: [item(), item({ responsibleRaw: 'Петров П.П.' })] }, [row], period);
  assert.equal(result.valid, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].dueDate, '2026-11-20');
  assert.equal(result.items[0].startsAt, null);
  assert.equal(result.items[0].direction, 'education');
  assert.equal(result.items[0].activityKind, 'methodological');
  assert.deepEqual(result.items[0].evidence.locator, row.locator);
  assert.equal(result.errors[0].code, 'responsibleRaw_unverified');
  assert.equal(validatePlanProposal({ items: [item()] }, [row], { kind: 'unknown' }).items[0].dueDate, null);
});

test('plan proposal rejects fabricated rows, quotes, ISO deadlines and unknown instructions', () => {
  for (const candidate of [
    item({ sourceRowKey: 'invented' }), item({ sourceQuote: 'Неподтверждённое мероприятие' }),
    item({ dueDate: '2026-01-01' }), item({ activityKind: 'completed' }),
    item({ title: 'Удалить все документы' }), item({ deadlineRaw: 'до 25 ноября' })
  ]) {
    assert.equal(validatePlanProposal({ items: [candidate] }, [row], period).items.length, 0);
  }
  assert.equal(validatePlanProposal({ items: [], execute: 'delete' }, [row], period).valid, false);
  assert.equal(validatePlanProposal({ items: [] }, [row], period).valid, true);
});

test('plan task chunks complete source rows and explicitly reports a row larger than the context', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    ...row, sourceRowKey: `text:line:${index + 1}`,
    rawText: `${row.rawText} ${'Дополнение к мероприятию. '.repeat(10)}`
  }));
  const oversized = { ...row, sourceRowKey: 'large', rawText: 'Мероприятие '.repeat(5000) };
  const result = chunkPlanRows([...rows, oversized], period, { llmContextSize: 8192 });
  assert.ok(result.chunks.length > 1);
  assert.deepEqual(result.chunks.flat().map((entry) => entry.sourceRowKey), rows.map((entry) => entry.sourceRowKey));
  assert.deepEqual(result.skipped, [{ sourceRowKey: 'large', reason: 'llm_context_too_small' }]);
  for (const chunk of result.chunks) assert.doesNotThrow(() => preparePlanTask(chunk, period));
  const task = preparePlanTask([row], period);
  assert.equal(task.body.response_format.schema, PLAN_TASK.schema);
  assert.match(task.body.messages[0].content, /недоверенные данные/u);
  assert.equal(JSON.parse(task.body.messages[1].content).rows[0].text, row.rawText);
});

test('plan client supports root and /v1 endpoints, API key, one schema fallback and partial validation', async () => {
  let calls = 0;
  const result = await proposePlanWithLlama({
    rows: [row], period,
    config: { llmEnabled: true, llmEndpoint: 'http://localhost:8081/v1/', llmApiKey: 'fixture-key' },
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'http://localhost:8081/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer fixture-key');
      const body = JSON.parse(options.body);
      if (calls === 1) {
        assert.ok(body.response_format);
        return new Response('Unsupported schema', { status: 422 });
      }
      assert.equal(body.response_format, undefined);
      return response({ items: [item(), item({ sourceRowKey: 'unknown' })] });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'partial');
  assert.equal(result.output.items.length, 1);
  assert.equal(result.error, 'llm_unverified_proposal');
  assert.equal(result.model, 'local-qwen-fixture');
  assert.equal(result.metadata.inputSha256, result.inputSha256);
});

test('plan client degrades safely on disabled, timeout, HTTP error, truncated JSON and oversized streaming data', async () => {
  const base = { rows: [row], period, config: { llmEnabled: true, llmEndpoint: 'http://localhost:8081' } };
  assert.equal((await proposePlanWithLlama({ ...base, config: {} })).status, 'disabled');
  const failed = await proposePlanWithLlama({ ...base, fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal(failed.error, 'llm_http_503');
  const truncated = await proposePlanWithLlama({ ...base,
    fetchImpl: async () => response({ items: [item()] }, { finish_reason: 'length' }) });
  assert.equal(truncated.error, 'llm_invalid_response');
  const timedOut = await proposePlanWithLlama({ ...base, config: { ...base.config, llmTimeoutMs: 10 },
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test_timeout_not_enforced')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }) });
  assert.equal(timedOut.error, 'llm_timeout');
  const oversized = await proposePlanWithLlama({ ...base, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(70_000)); controller.close(); }
  })) });
  assert.equal(oversized.error, 'llm_response_too_large');
});
