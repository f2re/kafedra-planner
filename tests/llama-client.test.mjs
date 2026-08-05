import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, proposeDirectiveWithLlama } from '../packages/ai/src/llama-client.mjs';

test('извлекает JSON из fenced-ответа', () => {
  assert.deepEqual(extractJsonObject('```json\n{"kind":"order"}\n```'), { kind: 'order' });
  assert.equal(extractJsonObject('нет json'), null);
});

test('отключённый LLM не выполняет сетевой запрос', async () => {
  const result = await proposeDirectiveWithLlama({ config: { llmEnabled: false }, text: 'Приказ', deterministic: {} });
  assert.equal(result.status, 'disabled');
  assert.equal(result.inputSha256.length, 64);
});
