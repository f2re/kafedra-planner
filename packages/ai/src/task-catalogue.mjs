import { createHash } from 'node:crypto';
import { ASSISTANT_TASKS } from './assistant-tasks.mjs';
import { PLAN_TASK, preparePlanTask } from './plan-task.mjs';
import { SELECTION_TASK, prepareSelectionTask } from './plan-selection-task.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const MODEL_ALIAS = 'department-assistant';
const METADATA = {
  'table-extract': ['Аналитик табличных данных', 'Извлечение поручений, публикаций, персон и учебной нагрузки.', 'Поручить доценту Сидорову подготовить методические указания к 25 ноября.'],
  'protocol-analysis': ['Аналитик протоколов кафедры', 'Повестка, решения, исполнители и сроки протокола.', 'ПРОТОКОЛ № 3 от 15.10.2026. СЛУШАЛИ: о готовности к сессии. ПОСТАНОВИЛИ: провести контрольные срезы до 15.11.2026, отв. доц. Петров.'],
  'report-synthesis': ['Методист кафедральных отчётов', 'Разделы отчёта с привязкой к предоставленным источникам.', 'Подготовить раздел отчёта по научно-исследовательской работе за осенний семестр 2026 года.'],
  'archive-query': ['Архивариус кафедры', 'Ответ по переданным фрагментам архива.', 'На каком заседании обсуждалась статья о влажности?'],
  'search-refine': ['Помощник поиска', 'Уточнение запроса, ключевых слов и синонимов.', 'На каком заседании обсуждалась статья о влажности?'],
  'gap-repair': ['Помощник проверки документов', 'Поиск пропусков реквизитов и предложений исправления.', 'Заседание кафедры. Повестка: о подготовке к сессии. Постановили: закончить приём задолженностей.'],
  'compliance-check': ['Советник по оформлению', 'Необязательные подсказки по формулировкам и реквизитам.', 'Протокол кафедры. Постановили: активизировать научную деятельность и сдать отчёты как можно скорее.'],
  'field-extract': ['Помощник извлечения реквизитов', 'Дата, номер, председатель и повестка документа.', 'Протокол заседания кафедры от 15 октября 2026 года № 4.'],
  'formula-calc': ['Помощник по формулам', 'Формулы Calc и Excel для кафедральных таблиц.', 'Формула ВПР для подстановки должности по ФИО.'],
  'suggest-agenda': ['Помощник повестки', 'Предложения пунктов повестки по переданному контексту.', 'В ноябре кафедра готовит отчёт по научной работе и обсуждает готовность к сессии.'],
  'template-analyze': ['Помощник анализа образца', 'Реквизиты и заполняемые поля образца документа.', 'План работы кафедры на ноябрь 2026 года. Мероприятие | Срок | Исполнитель.'],
  'protocol-extract-v1': ['Помощник разбора протокола', 'Структурированные предложения из текста протокола.', 'ПРОТОКОЛ № 3 от 15.10.2026. ПОСТАНОВИЛИ: подготовить отчёт до 15.11.2026. Ответственный: Иванов.'],
  'template-structure-analyze-v1': ['Помощник структуры образца', 'Предложения по структуре и переменным образца.', 'План работы кафедры на ноябрь 2026 года. Мероприятие | Срок | Исполнитель.']
};

function entry({ id, name, description, sourceModule, promptVersion = null, body, maxRows }) {
  const { model, messages, ...requestOptions } = body;
  return {
    id, name, role: name, description, sourceModule, promptVersion,
    systemSha256: hash(messages[0].content),
    temperature: body.temperature, maxTokens: body.max_tokens,
    ...(maxRows ? { maxRows } : {}),
    responseFormat: 'json', responseSchema: body.response_format?.schema || null,
    request: { method: 'POST', path: '/v1/chat/completions', options: requestOptions },
    systemPrompt: messages[0].content,
    sampleInput: JSON.parse(messages[1].content),
    samplePurpose: 'synthetic-diagnostic-only'
  };
}

/** Export-only catalogue. Production requests and validators remain in their task modules. */
export function buildAgentCatalogue() {
  const agents = Object.entries(ASSISTANT_TASKS).map(([id, task]) => {
    const [name, description, text] = METADATA[id] || [task.role || id, task.role || id, 'Пример запроса'];
    return entry({ id, name, description, sourceModule: 'packages/ai/src/assistant-tasks.mjs',
      promptVersion: /-v\d+$/u.test(id) ? id : null,
      body: {
        model: MODEL_ALIAS, temperature: 0.1, max_tokens: Math.min(2048, task.maxTokens), stream: false,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: 'system', content: task.system },
          { role: 'user', content: JSON.stringify({ task: id, text, query: text, candidates: [] }) }]
      }
    });
  });

  const plan = preparePlanTask([{ sourceRowKey: 'probe-row-1',
    text: 'Семинар кафедры метеорологии; 15 ноября 2026 года; ответственный: Иванов; место: аудитория 215.' }],
  { kind: 'calendar', key: '2026', yearStart: 2026, yearEnd: 2026 }, { llmModel: MODEL_ALIAS });
  agents.push(entry({ id: PLAN_TASK.version, promptVersion: PLAN_TASK.version, maxRows: PLAN_TASK.maxRows,
    name: 'Разбор мероприятий плана',
    description: 'Предложения из исходных строк: названия, сроки, исполнители и виды деятельности с проверяемыми цитатами.',
    sourceModule: 'packages/ai/src/plan-task.mjs', body: plan.body }));

  const candidates = [
    { planItemId: 'probe-event-1', source: { title: 'Семинар кафедры метеорологии', plan_kind: 'organization',
      starts_at: '2026-11-15', due_date: null, location: '', customValues: {}, detailsRevision: 0 },
    segments: [{ id: 'row:probe-1', text: 'Семинар кафедры метеорологии; Место: аудитория 215; Форма участия: Доклад.' }] },
    { planItemId: 'probe-event-2', source: { title: 'Проверка столовой института', plan_kind: 'organization',
      starts_at: '2026-11-16', due_date: null, location: '', customValues: {}, detailsRevision: 0 },
    segments: [{ id: 'row:probe-2', text: 'Проверка столовой института; Ответственная: служба тыла.' }] }
  ];
  const options = { department: 'Кафедра метеорологии', month: '2026-11', fields: [
    { key: 'location', label: 'Место', source: 'location', type: 'text' },
    { key: 'custom_form', label: 'Форма участия', source: 'custom', type: 'select', options: ['Доклад', 'Слушатель'] }
  ] };
  const selection = prepareSelectionTask(candidates, options, { llmModel: MODEL_ALIAS });
  agents.push(entry({ id: SELECTION_TASK.version, promptVersion: SELECTION_TASK.version, maxRows: SELECTION_TASK.maxRows,
    name: 'Подбор мероприятий кафедры',
    description: 'Ранжирование существующих мероприятий и предложения для пустых полей месячного плана; применение подтверждает оператор.',
    sourceModule: 'packages/ai/src/plan-selection-task.mjs', body: selection.body }));

  return {
    schema: 'kafedra-agents-v1',
    targetServer: 'http://127.0.0.1:8081', defaultModelAlias: MODEL_ALIAS,
    description: 'Каталог задач помощника и планов. Промпты передаются в каждом запросе; примеры диагностические и не создают данные кафедры.',
    catalogueSha256: hash(JSON.stringify(agents)), agents
  };
}

export function formatAgentCatalogue() {
  return `${JSON.stringify(buildAgentCatalogue(), null, 2)}\n`;
}

export function formatAgentGuide() {
  const catalogue = buildAgentCatalogue();
  return `# Промпты и диагностика LLM\n\n` +
    `Каталог содержит ${catalogue.agents.length} задач. Он получен из исполняемых модулей Kafedra Planner, а не из настроек модели. ` +
    `Промпт передаётся в каждом POST /v1/chat/completions; устанавливать каталог на LLM-сервер для работы приложения не требуется.\n\n` +
    `Для автономной проверки нужны bash и Python 3 (только стандартная библиотека; pip/npm не нужны).\n\n` +
    '```bash\n./test-remote-agents.sh --list\nLLM_ENDPOINT=http://127.0.0.1:8081 LLM_MODEL=department-assistant ./test-remote-agents.sh plan-extract-v1\n./test-remote-agents.sh plan-department-selection-v1\n```\n\n' +
    `LLM_ENDPOINT, LLM_MODEL, LLM_API_KEY и LLM_TIMEOUT (секунды, по умолчанию 45) задаются окружением. ` +
    `AGENTS_FILE позволяет явно указать путь к каталогу. --help описывает все параметры.\n\n` +
    `Проверяются HTTP, формат ответа, объявленная JSON Schema и ссылки/цитаты двух задач планов на фиксированных искусственных примерах. ` +
    `При HTTP 400/422 возможна одна совместимая попытка без response_format в рамках того же срока. ` +
    `Положительный результат не доказывает качество модели на документах кафедры, полноту разбора или правильность всех решений о принадлежности. ` +
    `В приложении действуют дополнительные проверки актуальности источников, прав доступа, типов, сохранности ручных значений и подтверждение оператора.\n\n` +
    '| Задача | Назначение | Версия промпта |\n| --- | --- | --- |\n' +
    catalogue.agents.map((agent) => `| ${agent.id} | ${agent.name} | ${agent.promptVersion || 'по systemSha256'} |`).join('\n') + '\n';
}
