import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeInputText,
  extractJsonObject,
  validateAssistantResult,
  createAssistantEngine
} from '../packages/ai/src/assistant-tasks.mjs';

test('sanitizeInputText cleans whitespace, control characters and page numbers', () => {
  const dirty = '  Заголовок приказа\r\n\r\n\r\nСтраница 1 из 10\r\nТекст пункта 1.\x00\x08\nСтр. 2\nТекст пункта 2.  ';
  const clean = sanitizeInputText(dirty);
  assert.ok(!clean.includes('\r'));
  assert.ok(!clean.includes('\x00'));
  assert.ok(!clean.includes('Страница 1 из 10'));
  assert.ok(!clean.includes('Стр. 2'));
  assert.ok(clean.includes('Заголовок приказа'));
  assert.ok(clean.includes('Текст пункта 1.'));
  assert.ok(clean.includes('Текст пункта 2.'));
});

test('sanitizeInputText bounds long text cleanly', () => {
  const long = 'А'.repeat(15000);
  const bounded = sanitizeInputText(long, 500);
  assert.ok(bounded.length <= 510);
  assert.ok(bounded.endsWith('…'));
});

test('extractJsonObject extracts valid objects from plain and markdown text', () => {
  assert.deepEqual(extractJsonObject('{"a": 1, "b": "test"}'), { a: 1, b: 'test' });
  assert.deepEqual(extractJsonObject('```json\n{"hello": "world"}\n```'), { hello: 'world' });
  assert.deepEqual(extractJsonObject('```\n{"foo": "bar"}\n```'), { foo: 'bar' });
  // Trailing comma recovery
  assert.deepEqual(extractJsonObject('{"key": "value", }'), { key: 'value' });
  assert.equal(extractJsonObject('not a json'), null);
  assert.equal(extractJsonObject('[1, 2, 3]'), null);
});

test('validateAssistantResult handles table-extract properly', () => {
  const raw = {
    title: 'Список поручений',
    columns: [
      { id: 'task name', label: 'Поручение', type: 'text' },
      { id: 'due_date', label: 'Срок', type: 'date' },
      { id: 'executor', label: 'Исполнитель' }
    ],
    rows: [
      { 'task_name': 'Сдать отчёт', due_date: '2026-11-20', executor: 'Иванов И.И.' }
    ]
  };
  const validated = validateAssistantResult('table-extract', raw);
  assert.equal(validated.type, 'table');
  assert.equal(validated.title, 'Список поручений');
  assert.equal(validated.columns.length, 3);
  assert.equal(validated.columns[0].id, 'task_name');
  assert.equal(validated.columns[0].type, 'text');
  assert.equal(validated.rows.length, 1);
  assert.equal(validated.rows[0].executor, 'Иванов И.И.');
});

test('validateAssistantResult handles formula-calc properly', () => {
  const raw = {
    formula: '=ВПР(A2; Справочник!A:B; 2; 0)',
    description: 'Ищет ФИО в первом столбце и возвращает должность',
    steps: ['1. Вставьте формулу в ячейку B2', '2. Протяните вниз'],
    example: 'A2 = "Иванов И.И.", результат: "Доцент"'
  };
  const validated = validateAssistantResult('formula-calc', raw);
  assert.equal(validated.type, 'formula');
  assert.equal(validated.formula, '=ВПР(A2; Справочник!A:B; 2; 0)');
  assert.equal(validated.steps.length, 2);
});

test('validateAssistantResult handles archive-query with quote verification', () => {
  const candidates = [
    { id: 'm1', snippet: 'Обсуждалась статья доцента Петрова Оценка влажности почв и датчики.' }
  ];
  const raw = {
    summary: 'Тема обсуждалась на одном заседании',
    matches: [
      {
        meetingId: 'm1',
        protocolNumber: '4',
        meetingDate: '2026-03-12',
        itemNumber: '2',
        itemTitle: 'Обсуждение научных работ',
        quote: 'Оценка влажности почв и датчики'
      },
      {
        meetingId: 'm2',
        quote: 'Несуществующая цитата которой нет в тексте'
      }
    ]
  };
  const validated = validateAssistantResult('archive-query', raw, { candidates });
  assert.equal(validated.type, 'archive-matches');
  assert.equal(validated.matches.length, 2);
  assert.equal(validated.matches[0].verified, true);
  assert.equal(validated.matches[1].verified, false);
});

test('createAssistantEngine returns disabled when LLM is turned off', async () => {
  const engine = createAssistantEngine({ config: { llmEnabled: false } });
  assert.equal(engine.enabled, false);
  const res = await engine.process({ task: 'table-extract', text: 'Поручение' });
  assert.equal(res.status, 'disabled');
});

test('createAssistantEngine calls LLM and caches result by SHA-256', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Таблица статей',
            columns: [{ id: 'author', label: 'Автор', type: 'text' }],
            rows: [{ author: 'Иванов И.И.' }]
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const engine = createAssistantEngine({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081', llmModel: 'test-model' },
    fetchImpl: mockFetch
  });

  assert.equal(engine.enabled, true);

  // First call: executes fetch
  const res1 = await engine.process({ task: 'table-extract', text: 'Иванов И.И. Статья' });
  assert.equal(res1.status, 'completed');
  assert.equal(res1.cached, false);
  assert.equal(res1.result.rows[0].author, 'Иванов И.И.');
  assert.equal(callCount, 1);

  // Second call with same text: retrieved from cache
  const res2 = await engine.process({ task: 'table-extract', text: 'Иванов И.И. Статья' });
  assert.equal(res2.status, 'completed');
  assert.equal(res2.cached, true);
  assert.equal(callCount, 1);
});

test('createAssistantEngine handles timeouts gracefully', async () => {
  const mockTimeoutFetch = async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };

  const engine = createAssistantEngine({
    config: { llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8081' },
    fetchImpl: mockTimeoutFetch
  });

  const res = await engine.process({ task: 'formula-calc', text: 'Тест формулы' });
  assert.equal(res.status, 'timeout');
});

test('validateAssistantResult handles gap-repair with quote verification and repairedText', () => {
  const sourceText = 'На заседании кафедры от 12 апреля 2024 года слушали доклад по гранту.';
  const payload = {
    summary: 'Найдена дата заседания',
    repairedText: 'На заседании кафедры от 12.04.2024 слушали доклад по гранту.',
    items: [
      {
        field: 'Дата заседания',
        status: 'missing',
        currentValue: null,
        suggestedValue: '2024-04-12',
        sourceQuote: '12 апреля 2024 года',
        reason: 'Указана в вводной части'
      }
    ],
    actionableAdvice: 'Установить дату 12.04.2024'
  };

  const res = validateAssistantResult('gap-repair', payload, { sourceText });
  assert.equal(res.type, 'gap-repair');
  assert.equal(res.repairedText, 'На заседании кафедры от 12.04.2024 слушали доклад по гранту.');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].suggestedValue, '2024-04-12');
  assert.equal(res.items[0].quoteVerified, true);
});

test('createAssistantEngine dynamically updates config via updateConfig', async () => {
  const engine = createAssistantEngine({ config: { llmEnabled: false } });
  assert.equal(engine.enabled, false);

  engine.updateConfig({ llmEnabled: true, llmEndpoint: 'http://127.0.0.1:8088' });
  assert.equal(engine.enabled, true);
  assert.match(engine.endpoint, /127\.0\.0\.1:8088/);
});
