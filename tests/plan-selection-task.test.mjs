import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSelectionCandidates, prepareSelectionTask, suggestPlanSelectionWithLlama, validateSelectionResponse } from '../packages/ai/src/plan-selection-task.mjs';
import { deterministicSelection } from '../packages/plans/src/selection.mjs';

const raw = 'Семинар кафедры метеорологии; Место: аудитория 215; Форма участия: Доклад; Число участников: 12; Срок заявки: 15.11.2026';
const candidate = { planItemId: 'event-1', source: { title: 'Семинар кафедры метеорологии', plan_kind: 'organization',
  plan_title: 'План института', location: '', customValues: {}, detailsRevision: 0 },
segments: [{ id: 'row:1', text: raw, locator: { table: 1, row: 4 } }, { id: 'plan:title', text: 'План института', locator: {} }] };
const fields = [
  { key: 'location', source: 'location', type: 'text', label: 'Место' },
  { key: 'custom_form', source: 'custom', type: 'select', label: 'Участие', options: ['Доклад', 'Слушатель'] },
  { key: 'custom_count', source: 'custom', type: 'number', label: 'Участники' },
  { key: 'custom_date', source: 'custom', type: 'date', label: 'Срок заявки' }
];
const proposal = (overrides = {}) => ({ planItemId: 'event-1', relevance: 'recommended', reason: 'Кафедра названа в мероприятии.',
  quote: 'Семинар кафедры метеорологии', segmentId: 'row:1', fields: [
    { key: 'location', value: 'аудитория 215', quote: 'Место: аудитория 215', segmentId: 'row:1' },
    { key: 'custom_form', value: 'Доклад', quote: 'Форма участия: Доклад', segmentId: 'row:1' },
    { key: 'custom_count', value: '12', quote: 'Число участников: 12', segmentId: 'row:1' },
    { key: 'custom_date', value: '15.11.2026', quote: 'Срок заявки: 15.11.2026', segmentId: 'row:1' }
  ], ...overrides });
const response = (output) => new Response(JSON.stringify({ model: 'fixture-local', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));

test('selection verifies identifiers and each field against one source segment; dates are parsed locally', () => {
  const result = validateSelectionResponse({ items: [proposal()] }, [candidate], fields);
  assert.equal(result.valid, true);
  assert.equal(result.items[0].suggestedFields.location.value, 'аудитория 215');
  assert.equal(result.items[0].suggestedFields.customValues.custom_count.value, '12');
  assert.equal(result.items[0].suggestedFields.customValues.custom_date.value, '2026-11-15');
  assert.deepEqual(result.items[0].suggestedFields.location.locator, { table: 1, row: 4 });
  assert.equal(result.items[0].source, undefined);
  for (const bad of [proposal({ planItemId: 'invented' }), proposal({ segmentId: 'missing' }), proposal({ quote: 'Подменённая цитата' }),
    proposal({ startsAt: '2026-12-01' }), proposal({ relevance: 'completed' })]) {
    assert.equal(validateSelectionResponse({ items: [bad] }, [candidate], fields).items.length, 0);
  }
});

test('numeric prefill preserves decimal notation and integers beyond JavaScript safe precision', () => {
  for (const value of ['9007199254740993', '1000000000000000000000', '12345678901234567890,25']) {
    const source = { ...candidate, segments: [{ id: 'row:1', text: `Семинар кафедры метеорологии. Число участников: ${value}` }] };
    const item = proposal({ fields: [{ key: 'custom_count', value, quote: `Число участников: ${value}`, segmentId: 'row:1' }] });
    const accepted = validateSelectionResponse({ items: [item] }, [source], fields);
    assert.equal(accepted.valid, true);
    assert.equal(accepted.items[0].suggestedFields.customValues.custom_count.value, value.replace(',', '.'));
  }
});

test('selection drops fabricated fields while retaining grounded ranking; preserves existing values and blanks', () => {
  const mixed = proposal({ fields: [...proposal().fields, { key: 'executor', value: 'Иванов', quote: 'Иванов', segmentId: 'row:1' }] });
  const result = validateSelectionResponse({ items: [mixed] }, [candidate], fields);
  assert.equal(result.valid, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].suggestedFields.location.value, 'аудитория 215');
  const saved = { ...candidate, source: { ...candidate.source, detailsRevision: 2, customValues: { custom_form: '' } } };
  const retained = validateSelectionResponse({ items: [proposal()] }, [saved], fields).items[0];
  assert.equal(retained.suggestedFields.location, undefined);
  assert.equal(retained.suggestedFields.customValues.custom_form, undefined);
  const fromHeader = proposal({ fields: [{ key: 'location', value: 'института', quote: 'План института', segmentId: 'plan:title' }] });
  assert.deepEqual(validateSelectionResponse({ items: [fromHeader] }, [candidate], fields).items[0].suggestedFields, {});
});

test('department rules do not select an entire institute merely sharing the discipline name', () => {
  const institute = { ...candidate, source: { ...candidate.source, plan_title: 'План института метеорологии' }, segments: [
    { id: 'plan:title', text: 'План института метеорологии' }, { id: 'item:title', text: 'Общее совещание администрации' }
  ] };
  assert.equal(deterministicSelection(institute, 'Кафедра метеорологии').relevance, 'other');
  assert.equal(deterministicSelection(institute, 'метеорологии').relevance, 'other');
  const assigned = { ...institute, segments: [...institute.segments, { id: 'item:responsible', text: 'Кафедра метеорологии' }] };
  assert.equal(deterministicSelection(assigned, 'Кафедра метеорологии').relevance, 'recommended');
});

test('selection bounds complete candidate chunks and reports oversized candidates', () => {
  const candidates = Array.from({ length: 14 }, (_, index) => ({ ...candidate, planItemId: `event-${index}`, segments: [{ id: 'row:1', text: raw.repeat(3) }] }));
  const large = { ...candidate, planItemId: 'large', segments: [{ id: 'row:1', text: raw.repeat(500) }] };
  const options = { department: 'Кафедра метеорологии', month: '2026-11', fields };
  const result = chunkSelectionCandidates([...candidates, large], options);
  assert.deepEqual(result.chunks.flat().map((item) => item.planItemId), candidates.map((item) => item.planItemId));
  assert.deepEqual(result.skipped, ['large']);
  for (const chunk of result.chunks) assert.doesNotThrow(() => prepareSelectionTask(chunk, options));
});

test('selection local model transport uses one schema fallback and safely handles malformed/large responses', async () => {
  const base = { candidates: [candidate], department: 'Кафедра метеорологии', month: '2026-11', fields,
    config: { llmEnabled: true, llmEndpoint: 'http://localhost:8081/v1/', llmApiKey: 'fixture' } };
  assert.equal((await suggestPlanSelectionWithLlama({ ...base, config: {} })).status, 'disabled');
  let calls = 0;
  const result = await suggestPlanSelectionWithLlama({ ...base, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://localhost:8081/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer fixture');
    calls += 1;
    if (calls === 1) return new Response('', { status: 422 });
    assert.equal(JSON.parse(options.body).response_format, undefined);
    return response({ items: [proposal()] });
  } });
  assert.equal(calls, 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.items.length, 1);
  assert.equal((await suggestPlanSelectionWithLlama({ ...base, fetchImpl: async () => response({ execute: 'anything' }) })).status, 'failed');
  assert.equal((await suggestPlanSelectionWithLlama({ ...base, fetchImpl: async () => new Response('x'.repeat(70_000)) })).error, 'llm_response_too_large');
  const timeout = await suggestPlanSelectionWithLlama({ ...base, config: { ...base.config, llmTimeoutMs: 10 },
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture timeout')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }) });
  assert.equal(timeout.error, 'llm_timeout');
});
