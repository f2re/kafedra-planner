import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateAssistantResult
} from '../packages/ai/src/assistant-tasks.mjs';
import {
  proposeProtocolWithLlama,
  analyzeTemplateWithLlama
} from '../packages/ai/src/llama-client.mjs';
import {
  renderVisualMeetingTemplateXml,
  analyzeMeetingTemplatePath
} from '../packages/protocols/src/meeting-template-profile.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';

function mockLlamaResponse(resultObj) {
  return async () => new Response(JSON.stringify({
    model: 'mock-model',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify(resultObj)
        }
      }
    ]
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('validateAssistantResult: protocol-extract-v1 validates quorum and multi-paragraph decisions', () => {
  const raw = {
    protocolNumber: '5',
    meetingDate: '2026-10-25',
    chairperson: 'Иванов И.И.',
    secretary: 'Петрова А.С.',
    quorum: '12 из 15 членов кафедры (кворум имеется)',
    attendees: ['Иванов И.И.', 'Петрова А.С.', 'Сидоров С.С.'],
    agenda: [
      {
        itemNumber: 1,
        title: 'Об утверждении учебных планов',
        reporter: 'Иванов И.И.',
        heard: 'Первый абзац доклада.\nВторой абзац доклада с подробностями.',
        decision: '1. Утвердить учебные планы.\n2. Назначить ответственных за контроль.'
      }
    ]
  };

  const validated = validateAssistantResult('protocol-extract-v1', raw);
  assert.equal(validated.type, 'protocol-extract-v1');
  assert.equal(validated.protocolNumber, '5');
  assert.equal(validated.meetingDate, '2026-10-25');
  assert.equal(validated.chairperson, 'Иванов И.И.');
  assert.equal(validated.quorum.text, '12 из 15 членов кафедры (кворум имеется)');
  assert.equal(validated.agendaItems.length, 1);
  assert.ok(validated.agendaItems[0].heard.includes('Второй абзац'));
  assert.ok(validated.agendaItems[0].decision.includes('2. Назначить'));
});

test('validateAssistantResult: template-structure-analyze-v1 validates block_range boundaries', () => {
  const raw = {
    repeat: {
      kind: 'block_range',
      startElementId: 'word/document.xml#body/p:4',
      endElementId: 'word/document.xml#body/p:7'
    },
    bindings: [
      {
        field: 'protocol_number',
        elementId: 'word/document.xml#body/p:2',
        sampleText: '01'
      },
      {
        field: 'title',
        elementId: 'word/document.xml#body/p:4',
        sampleText: 'Вопрос повестки'
      }
    ]
  };

  const validated = validateAssistantResult('template-structure-analyze-v1', raw);
  assert.equal(validated.type, 'template-structure-analyze-v1');
  assert.equal(validated.repeat.kind, 'block_range');
  assert.equal(validated.repeat.startElementId, 'word/document.xml#body/p:4');
  assert.equal(validated.repeat.endElementId, 'word/document.xml#body/p:7');
  assert.equal(validated.bindings.length, 2);
  assert.equal(validated.bindings[1].field, 'title');
});

test('proposeProtocolWithLlama: extracts facts when LLM is enabled with quote verification', async () => {
  const sourceText = `ПРОТОКОЛ № 4
заседания кафедры от 18 октября 2026 г.
Председатель: проф. Сидоров А.В.
Секретарь: доц. Кузнецова Т.И.
Присутствовали: Сидоров А.В., Кузнецова Т.И., Васильев П.П.
Кворум: 10 из 12 членов кафедры (кворум имеется).

ПОВЕСТКА ДНЯ:
1. О готовности к аккредитации.

СЛУШАЛИ:
Сидоров А.В. доложил о состоянии документов к аккредитации.
Работа ведется по графику.

ПОСТАНОВИЛИ:
1. Завершить формирование портфолио до 1 ноября 2026 г.
2. Контроль возложить на секретаря.`;

  const mockData = {
    protocolNumber: '4',
    meetingDate: '2026-10-18',
    chairperson: 'проф. Сидоров А.В.',
    secretary: 'доц. Кузнецова Т.И.',
    quorum: { total: 12, present: 10, required: 8, text: '10 из 12 членов кафедры (кворум имеется)' },
    attendees: ['Сидоров А.В.', 'Кузнецова Т.И.', 'Васильев П.П.'],
    agendaItems: [
      {
        itemNo: 1,
        title: 'О готовности к аккредитации.',
        speaker: 'Сидоров А.В.',
        heard: 'Сидоров А.В. доложил о состоянии документов к аккредитации.\nРабота ведется по графику.',
        decision: '1. Завершить формирование портфолио до 1 ноября 2026 г.\n2. Контроль возложить на секретаря.',
        sourceQuote: 'О готовности к аккредитации'
      }
    ]
  };

  const config = {
    llmEnabled: true,
    llmEndpoint: 'http://127.0.0.1:8081',
    llmModel: 'mock-model'
  };

  const fetchImpl = mockLlamaResponse(mockData);

  const result = await proposeProtocolWithLlama({
    config,
    text: sourceText,
    deterministic: false,
    fetchImpl
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.output.protocolNumber, '4');
  assert.equal(result.output.meetingDate, '2026-10-18');
  assert.equal(result.output.chairperson, 'проф. Сидоров А.В.');
  assert.equal(result.output.quorum.text, '10 из 12 членов кафедры (кворум имеется)');
  assert.equal(result.output.agendaItems.length, 1);
  assert.ok(result.output.agendaItems[0].decision.includes('1 ноября 2026'));
});

test('proposeProtocolWithLlama: returns disabled status when AI is not configured', async () => {
  const result = await proposeProtocolWithLlama({
    config: { llmEnabled: false },
    text: 'Тестовый текст'
  });
  assert.equal(result.status, 'disabled');
});

test('analyzeTemplateWithLlama: suggests block_range and bindings via LLM', async () => {
  const analysis = {
    blocks: [
      { kind: 'paragraph', elementId: 'word/document.xml#body/p:1', childIndex: 1, text: 'ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ' },
      { kind: 'paragraph', elementId: 'word/document.xml#body/p:2', childIndex: 2, text: 'Протокол № 1 от 01.09.2026' },
      { kind: 'paragraph', elementId: 'word/document.xml#body/p:3', childIndex: 3, text: 'Председатель: Иванов И.И.' },
      { kind: 'paragraph', elementId: 'word/document.xml#body/p:4', childIndex: 4, text: '1. О плане работы кафедры' },
      { kind: 'table', elementId: 'word/document.xml#body/table:1', childIndex: 5 },
      { kind: 'paragraph', elementId: 'word/document.xml#body/p:5', childIndex: 6, text: 'Постановили: утвердить план' }
    ],
    elements: [
      { elementId: 'word/document.xml#body/p:2', text: 'Протокол № 1 от 01.09.2026' },
      { elementId: 'word/document.xml#body/p:3', text: 'Председатель: Иванов И.И.' },
      { elementId: 'word/document.xml#body/p:4', text: '1. О плане работы кафедры' },
      { elementId: 'word/document.xml#body/p:5', text: 'Постановили: утвердить план' }
    ]
  };

  const mockProposal = {
    documentKind: 'protocol',
    repeat: {
      kind: 'block_range',
      startElementId: 'word/document.xml#body/p:4',
      endElementId: 'word/document.xml#body/p:5'
    },
    bindings: [
      { field: 'protocol_number', elementId: 'word/document.xml#body/p:2', sampleText: '1' },
      { field: 'chairperson', elementId: 'word/document.xml#body/p:3', sampleText: 'Иванов И.И.' },
      { field: 'title', elementId: 'word/document.xml#body/p:4', sampleText: 'О плане работы кафедры' }
    ],
    confidence: 0.95
  };

  const config = {
    llmEnabled: true,
    llmEndpoint: 'http://127.0.0.1:8081',
    llmModel: 'mock-model'
  };

  const fetchImpl = mockLlamaResponse(mockProposal);

  const result = await analyzeTemplateWithLlama({
    config,
    analysis,
    fetchImpl
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.repeat.kind, 'block_range');
  assert.equal(result.bindings.length, 3);
  assert.equal(result.bindings[0].field, 'protocol_number');
  assert.equal(result.bindings[0].expectedText, '1');
});

test('генерация протокола и выписки: block_range с таблицей и многоабзацным решением', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'template-multiblock-'));
  try {
    const docxPath = join(dir, 'template.docx');

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
  <w:p><w:r><w:t>Протокол № 99 от 15.09.2026</w:t></w:r></w:p>
  <w:p><w:r><w:t>Председатель: Иванов И.И.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Секретарь: Петрова А.С.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Кворум: 10 из 12</w:t></w:r></w:p>
  <w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>1. Обсуждение вопроса повестки</w:t></w:r></w:p>
  <w:tbl>
    <w:tr>
      <w:tc><w:p><w:r><w:t>Колонка 1</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Колонка 2</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:r><w:t>Слушали: докл. Васильев В.В.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Постановили: решение принято единогласно.</w:t></w:r></w:p>
  <w:p><w:r><w:t>Подписи сторон</w:t></w:r></w:p>
  <w:sectPr/>
</w:body>
</w:document>`;

    await writeZipArchive(docxPath, {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': documentXml
    });

    const analysis = await analyzeMeetingTemplatePath(docxPath, 'test-hash');
    assert.equal(analysis.blocks.length, 9);

    const p1 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:1');
    const p2 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:2');
    const p3 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:3');
    const p4 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:4');
    const p5 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:5');
    const p6 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:6');
    const p7 = analysis.elements.find((el) => el.elementId === 'word/document.xml#body/p:7');

    const makeBinding = (el, field, sample) => {
      const start = el.text.indexOf(sample);
      return {
        field,
        elementId: el.elementId,
        startOffset: start,
        endOffset: start + sample.length,
        expectedText: sample
      };
    };

    const profile = {
      status: 'ready',
      bindings: [
        makeBinding(p1, 'protocol_number', '99'),
        makeBinding(p1, 'meeting_date', '15.09.2026'),
        makeBinding(p2, 'chairperson', 'Иванов И.И.'),
        makeBinding(p3, 'secretary', 'Петрова А.С.'),
        makeBinding(p4, 'quorum', '10 из 12'),
        makeBinding(p5, 'title', 'Обсуждение вопроса повестки'),
        makeBinding(p6, 'heard', 'докл. Васильев В.В.'),
        makeBinding(p7, 'decision', 'решение принято единогласно.')
      ],
      repeat: {
        kind: 'block_range',
        startChildIndex: 5,
        endChildIndex: 8
      }
    };

    const globalValues = {
      protocol_number: '7',
      meeting_date: '2026-11-01',
      chairperson: 'проф. Сидоров С.С.',
      secretary: 'доц. Кузнецова К.К.',
      quorum: '11 из 12 членов кафедры (кворум имеется)'
    };

    const agendaValues = [
      {
        title: 'Вопрос первый: утверждение расписания',
        heard: 'Сидоров С.С.',
        decision: '1. Утвердить предложенное расписание занятий.\n2. Передать расписание в деканат в срок до 05.11.2026.'
      },
      {
        title: 'Вопрос второй: научная работа',
        heard: 'Кузнецова К.К.',
        decision: 'Принять к сведению информацию о грантах.'
      }
    ];

    const renderedXml = renderVisualMeetingTemplateXml(documentXml, profile, globalValues, agendaValues);

    // Проверяем подстановку реквизитов
    assert.ok(renderedXml.includes('Протокол № 7 от 2026-11-01'));
    assert.ok(renderedXml.includes('проф. Сидоров С.С.'));
    assert.ok(renderedXml.includes('11 из 12 членов кафедры'));

    // Проверяем тиражирование вопросов
    assert.ok(renderedXml.includes('Вопрос первый: утверждение расписания'));
    assert.ok(renderedXml.includes('Вопрос второй: научная работа'));

    // Проверяем сохранение таблицы внутри каждого тиражированного вопроса
    const tableMatches = [...renderedXml.matchAll(/<w:tbl\b/g)];
    assert.equal(tableMatches.length, 2, 'В двух вопросах должно быть 2 таблицы');

    // Проверяем многоабзацное разбиение решения (отдельные <w:p> для пунктов 1 и 2)
    assert.ok(renderedXml.includes('1. Утвердить предложенное расписание занятий.'));
    assert.ok(renderedXml.includes('2. Передать расписание в деканат'));

    // Теперь проверяем генерацию выписки (один вопрос)
    const extractXml = renderVisualMeetingTemplateXml(documentXml, profile, globalValues, [agendaValues[1]]);
    assert.ok(extractXml.includes('Вопрос второй: научная работа'));
    assert.ok(!extractXml.includes('Вопрос первый: утверждение расписания'));
    const extractTableMatches = [...extractXml.matchAll(/<w:tbl\b/g)];
    assert.equal(extractTableMatches.length, 1, 'В выписке должна быть 1 таблица');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
