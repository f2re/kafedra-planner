import { createHash } from 'node:crypto';

export const ASSISTANT_VERSION = 'assistant-tools-v1';
const MAX_RESPONSE_BYTES = 65_536;
const MAX_INPUT_CHARS = 12_000;

export function sanitizeInputText(rawText, maxChars = MAX_INPUT_CHARS) {
  if (typeof rawText !== 'string') return '';
  let text = rawText
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')
    // Remove repeated page markers like "Страница 1 из 5"
    .replace(/(?:^|\n)\s*(?:Страница|Стр\.?)\s+\d+(?:\s*(?:из|\/)\s*\d+)?\s*(?=\n|$)/giu, '\n')
    // Collapse multiple empty lines
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastBoundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
    text = (lastBoundary > maxChars * 0.7 ? cut.slice(0, lastBoundary) : cut).trim() + '…';
  }
  return text;
}

export const ASSISTANT_TASKS = Object.freeze({
  'table-extract': Object.freeze({
    id: 'table-extract',
    maxTokens: 2048,
    system: [
      'Ты — аналитический помощник кафедры.',
      'Проанализируй входной текст и структурируй упомянутые факты (протоколы, решения, поручения со сроками и исполнителями, статьи, публикации или списки персон) в виде таблицы.',
      'Верни строго один JSON-объект без форматирования Markdown и без вступительного текста вида:',
      '{"title":"Название таблицы","columns":[{"id":"col1","label":"Колонка 1","type":"text"}],"rows":[{"col1":"значение"}]}.',
      'Допустимые type для columns: "text", "date", "number".',
      'Не выдумывай факты, сохраняй исходные формулировки.',
      'Если данных для таблицы нет, верни {"title":"Данные не найдены","columns":[],"rows":[]}.'
    ].join(' ')
  }),

  'formula-calc': Object.freeze({
    id: 'formula-calc',
    maxTokens: 1024,
    system: [
      'Ты — эксперт по формулам и расчётам в LibreOffice Calc и Microsoft Excel.',
      'По запросу пользователя составь формулу или правило условного форматирования.',
      'Используй русские названия функций (ВПР, СУММЕСЛИМН, СЧЁТЕСЛИМН, ЕСЛИ, ИНДЕКС, ПОИСКПОЗ) и точку с запятой (;) как разделитель аргументов.',
      'Верни строго один JSON-объект без Markdown и вводных слов вида:',
      '{"formula":"=ФОРМУЛА(...)","description":"Краткое описание на русском","steps":["1. Куда вставить","2. Как настроить"],"example":"Пример со значениями"}.'
    ].join(' ')
  }),

  'archive-query': Object.freeze({
    id: 'archive-query',
    maxTokens: 1536,
    system: [
      'Ты — архивариус кафедры.',
      'Сопоставь вопрос пользователя со списком найденных фрагментов заседаний и протоколов.',
      'Определи, в каких заседаниях и пунктах повестки действительно обсуждалась запрашиваемая тема.',
      'Верни строго один JSON-объект без Markdown и вступительных слов вида:',
      '{"summary":"Краткий ответ по существу","matches":[{"meetingId":"...","protocolNumber":"...","meetingDate":"...","itemNumber":"...","itemTitle":"...","quote":"точная цитата из текста"}]}.',
      'quote обязана быть точной выдержкой длиной 16-240 символов из переданного текста фрагмента.',
      'Не выдумывай номера протоколов и цитаты. Если совпадений нет, верни {"summary":"В доступных протоколах тема не упоминается","matches":[]}.'
    ].join(' ')
  }),

  'gap-repair': Object.freeze({
    id: 'gap-repair',
    maxTokens: 2048,
    system: [
      'Ты — эксперт-аналитик документов и заседаний кафедры.',
      'Твоя задача — внимательно изучить предоставленный текст (фрагмент заседания, протокол, приказ, описание ошибки или неполные данные).',
      'Определи:',
      '1) Недостающие или неполные реквизиты (дата заседания, номер пункта повестки, докладчик, решение, срок исполнения, ответственный).',
      '2) Если передан текст с ошибкой — выяви причину и предложи точный способ её исправления.',
      'Для каждого найденного пропуска или исправления обязательно укажи точную цитату (sourceQuote) из переданного текста, которая подтверждает твоё предложение.',
      'Сформируй полный исправленный текст (repairedText), в котором устранены выявленные ошибки, аккуратно вставлены недостающие реквизиты и даты, сохраняя исходную структуру документа.',
      'Верни строго один JSON-объект без Markdown и лишнего текста вида:',
      '{"summary":"Краткий вывод о пропусках или ошибках","repairedText":"полный связный текст с применёнными исправлениями","items":[{"field":"Название реквизита","status":"missing|invalid|fixed","currentValue":"...","suggestedValue":"...","sourceQuote":"точная цитата из текста","reason":"почему предлагается"}],"actionableAdvice":"Конкретные шаги оператора"}.',
      'Не выдумывай факты. Если пропусков нет, верни {"summary":"Пропусков и ошибок не обнаружено","repairedText":"","items":[],"actionableAdvice":"Все обязательные реквизиты заполнены"}.'
    ].join(' ')
  }),

  'field-extract': Object.freeze({
    id: 'field-extract',
    maxTokens: 512,
    system: [
      'Ты — помощник по разбору документов кафедры.',
      'Извлеки из текста документа запрошенный реквизит (например: дату заседания, номер протокола, председателя или повестку).',
      'Верни строго один JSON-объект вида:',
      '{"field":"имя реквизита","value":"найденное значение (например YYYY-MM-DD для даты или номер)","sourceQuote":"точная цитата из текста подтверждающая значение","confidence":0.95}.',
      'Дату приводи к формату YYYY-MM-DD, если указан месяц словом (например "15 октября 2026 г." -> "2026-10-15").',
      'Если реквизит не найден, верни {"field":"имя","value":"","sourceQuote":"","confidence":0}.'
    ].join(' ')
  }),

  'search-refine': Object.freeze({
    id: 'search-refine',
    maxTokens: 1024,
    system: [
      'Ты — интеллектуальный агент поиска по материалам, протоколам и документам кафедры.',
      'Твоя цель — разобрать вопрос пользователя, определить интент поиска, выявить ключевые поисковые слова (без знаков препинания и стоп-слов), подобрать предметные синонимы в контексте высшего учебного заведения и кафедры (например: статья <-> публикация <-> вестник <-> сборник, УМК <-> учебно-методический комплекс <-> пособие, ВКР <-> диплом <-> выпускная работа, нагрузка <-> часы <-> семестр, заседание <-> протокол), и сформировать поисковую строку для FTS5 (слова соединены через пробел или OR).',
      'Верни строго один JSON-объект вида:',
      '{"intent":"meeting_search|decision_lookup|person_tasks|publication_search|general","keywords":["слово1","слово2"],"synonyms":["синоним1","синоним2"],"ftsQuery":"слово1 OR слово2","timeframe":"...","explanation":"Краткое пояснение направления поиска"}.',
      'Не выдумывай лишних слов, сохраняй исходную тему.'
    ].join(' ')
  }),

  'protocol-analysis': Object.freeze({
    id: 'protocol-analysis',
    maxTokens: 2560,
    system: [
      'Ты — аналитик протоколов заседаний кафедры.',
      'Твоя задача — детально структурировать протокольный текст или черновик заседания («СЛУШАЛИ / ВЫСТУПИЛИ / ПОСТАНОВИЛИ»).',
      'Извлеки:',
      '1) реквизиты заседания (номер протокола, дату YYYY-MM-DD, председателя, секретаря, кворум);',
      '2) повестку дня (номер вопроса, тему, докладчика);',
      '3) принятые постановления и поручения (действие, ответственный исполнитель с должностью/званием, точный срок исполнения YYYY-MM-DD или календарная дата).',
      'Верни строго один JSON-объект вида:',
      '{"meetingNumber":"...","meetingDate":"...","chairman":"...","secretary":"...","quorum":"...","agenda":[{"itemNumber":"1","topic":"...","speaker":"...","decisions":[{"action":"...","assignee":"...","deadline":"...","control":"..."}]}]}.',
      'Сохраняй исходные формулировки, не додумывай поручений, которых нет в тексте.'
    ].join(' ')
  }),

  'report-synthesis': Object.freeze({
    id: 'report-synthesis',
    maxTokens: 2560,
    system: [
      'Ты — методист-составитель официальных отчётов кафедры.',
      'Твоя задача — составить связный, грамотный и структурированный раздел кафедрального отчёта (по учебно-методической, научной, воспитательной или кадровой работе) на основе предоставленных фактов, протоколов и решений.',
      'Каждое утверждение подкрепляй точной ссылкой на заседание кафедры: «(Протокол № X от DD.MM.YYYY, п. Y)».',
      'Сформируй: 1) официальный заголовок раздела (sectionTitle); 2) краткое резюме для руководства (executiveSummary); 3) связные абзацы текста отчёта (paragraphs); 4) структурированные ключевые факты и показатели (facts: label, value, source); 5) итоговые выводы (conclusions).',
      'Верни строго один JSON-объект вида:',
      '{"sectionTitle":"...","executiveSummary":"...","paragraphs":["..."],"facts":[{"label":"...","value":"...","source":"..."}],"conclusions":["..."]}.',
      'Опирайся строго на предоставленный материал, не выдумывай номеров и фамилий.'
    ].join(' ')
  }),

  'compliance-check': Object.freeze({
    id: 'compliance-check',
    maxTokens: 2048,
    system: [
      'Ты — доброжелательный помощник по оформлению документов и протоколов кафедры.',
      'Твоя задача — не наказывать и не блокировать пользователя, а дать полезные подсказки и предложить конкретные варианты улучшения текста (suggestedFix), которые пользователь может одобрить в один клик.',
      'Обрати внимание на:',
      '1) Реквизиты и кворум (подскажи, если не указана дата, номер, явка или председатель);',
      '2) Чёткость поручений (если формулировка размыта, предложи конкретный деловой вариант с ответственным и сроком);',
      '3) Повестку дня (структурированность вопросов).',
      'Для каждого пункта сформируй:',
      '- rule: краткая тема подсказки (например "Уточнение срока поручения" или "Кворум заседания");',
      '- status: "suggestion" (предложение по улучшению), "notice" (полезное примечание), "ok" (всё в порядке);',
      '- details: доброжелательное пояснение, почему это может быть полезно;',
      '- suggestedFix: готовый вариант улучшенной формулировки для вставки в текст (или пустая строка, если исправление не требуется);',
      '- sourceQuote: точная фраза из исходного текста, которую предлагается улучшить.',
      'Верни строго один JSON-объект вида:',
      '{"summary":"Доброжелательное резюме подсказок","suggestions":[{"rule":"...","status":"suggestion|notice|ok","details":"...","suggestedFix":"...","sourceQuote":"..."}],"helpfulNotes":["..."]}.',
      'Никаких карательных формулировок, не объявляй документ недействительным. Тон — конструктивный и помогающий.'
    ].join(' ')
  }),

  'suggest-agenda': Object.freeze({
    id: 'suggest-agenda',
    maxTokens: 2560,
    system: [
      'Ты — методист и секретарь кафедры.',
      'На основе переданного месяца заседания, задач из планов кафедры и типовых кафедральных тем сформируй проект повестки заседания кафедры.',
      'Для каждого вопроса повестки предложи:',
      '- title: чёткое официальное наименование («О распределении учебной нагрузки...», «Об утверждении тем ВКР...»);',
      '- heardText: кого и что заслушали (краткий тезис сообщения);',
      '- discussedText: краткое содержание обсуждения;',
      '- decisionText: итоговое постановление/решение кафедры;',
      '- speaker: предлагаемый докладчик;',
      '- sourceKind: "plan_item" | "standard_template" | "task" | "manual";',
      '- sourceId: id источника, если вопрос взят из переданного плана или задачи.',
      'Верни строго один JSON-объект вида:',
      '{"explanation":"Пояснение к предложенной повестке","topics":[{"title":"...","heardText":"...","discussedText":"...","decisionText":"...","speaker":"...","sourceKind":"...","sourceId":"..."}]}.',
      'Сохраняй академический стиль и точность.'
    ].join(' ')
  })
});

export function extractJsonObject(rawContent) {
  if (typeof rawContent !== 'string') return null;
  const text = rawContent.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
  const target = fenced ? fenced[1].trim() : text;
  try {
    const parsed = JSON.parse(target);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // Attempt relaxed recovery of JSON if trailing commas exist
    try {
      const fixed = target.replace(/,\s*([}\]])/gu, '$1');
      const parsed = JSON.parse(fixed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function validateAssistantResult(taskType, payload, extra = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('assistant_invalid_json');
  }

  if (taskType === 'table-extract') {
    const title = String(payload.title || 'Таблица').trim().slice(0, 160);
    const rawCols = Array.isArray(payload.columns) ? payload.columns : [];
    const columns = rawCols
      .filter((c) => c && typeof c === 'object' && c.id && c.label)
      .map((c) => ({
        id: String(c.id).trim().replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 40),
        label: String(c.label).trim().slice(0, 80),
        type: ['date', 'number', 'text'].includes(c.type) ? c.type : 'text'
      }));

    const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
    const colIds = new Set(columns.map((c) => c.id));
    const rows = rawRows
      .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
      .slice(0, 500)
      .map((r) => {
        const row = {};
        for (const [k, v] of Object.entries(r)) {
          if (colIds.has(k) || columns.length === 0) {
            row[k] = v === null || v === undefined ? '' : String(v).trim().slice(0, 2000);
          }
        }
        return row;
      });

    return { type: 'table', title, columns, rows };
  }

  if (taskType === 'formula-calc') {
    const formula = String(payload.formula || '').trim().slice(0, 500);
    const description = String(payload.description || '').trim().slice(0, 1000);
    const rawSteps = Array.isArray(payload.steps) ? payload.steps : [];
    const steps = rawSteps.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 10);
    const example = String(payload.example || '').trim().slice(0, 500);
    return { type: 'formula', formula, description, steps, example };
  }

  if (taskType === 'archive-query') {
    const summary = String(payload.summary || '').trim().slice(0, 1000);
    const rawMatches = Array.isArray(payload.matches) ? payload.matches : [];
    const candidates = Array.isArray(extra.candidates) ? extra.candidates : [];
    const allowedTexts = candidates.map((c) => String(c.text || c.snippet || '').toLocaleLowerCase('ru-RU'));

    const matches = rawMatches
      .filter((m) => m && typeof m === 'object')
      .slice(0, 20)
      .map((m) => {
        const quote = String(m.quote || '').trim().slice(0, 300);
        const normQuote = quote.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
        const isVerified = normQuote.length >= 8 && allowedTexts.some((txt) => txt.includes(normQuote));
        return {
          meetingId: String(m.meetingId || '').slice(0, 80),
          protocolNumber: String(m.protocolNumber || '').slice(0, 40),
          meetingDate: String(m.meetingDate || '').slice(0, 32),
          itemNumber: String(m.itemNumber || '').slice(0, 32),
          itemTitle: String(m.itemTitle || '').slice(0, 200),
          quote,
          verified: isVerified
        };
      });

    return { type: 'archive-matches', summary, matches };
  }

  if (taskType === 'gap-repair') {
    const summary = String(payload.summary || 'Анализ завершён').trim().slice(0, 1000);
    const repairedText = typeof payload.repairedText === 'string' ? payload.repairedText.trim().slice(0, 12000) : '';
    const actionableAdvice = String(payload.actionableAdvice || '').trim().slice(0, 1000);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const sourceText = String(extra.sourceText || '').toLocaleLowerCase('ru-RU');

    const items = rawItems
      .filter((it) => it && typeof it === 'object')
      .slice(0, 30)
      .map((it) => {
        const quote = String(it.sourceQuote || '').trim().slice(0, 300);
        const normQuote = quote.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
        const quoteFound = !sourceText || !normQuote || normQuote.length < 6 || sourceText.includes(normQuote);
        return {
          field: String(it.field || 'Реквизит').trim().slice(0, 100),
          status: ['missing', 'invalid', 'fixed'].includes(it.status) ? it.status : 'missing',
          currentValue: it.currentValue ? String(it.currentValue).trim().slice(0, 500) : null,
          suggestedValue: String(it.suggestedValue || '').trim().slice(0, 500),
          sourceQuote: quote,
          quoteVerified: quoteFound,
          reason: String(it.reason || '').trim().slice(0, 1000)
        };
      });

    return { type: 'gap-repair', summary, repairedText, items, actionableAdvice };
  }

  if (taskType === 'field-extract') {
    const field = String(payload.field || 'field').trim().slice(0, 100);
    const value = String(payload.value || '').trim().slice(0, 500);
    const sourceQuote = String(payload.sourceQuote || '').trim().slice(0, 500);
    const confidence = Math.max(0, Math.min(1, Number(payload.confidence !== undefined ? payload.confidence : (value ? 0.9 : 0))));
    return { type: 'field-extract', field, value, sourceQuote, confidence };
  }

  if (taskType === 'search-refine') {
    const intent = ['meeting_search', 'decision_lookup', 'person_tasks', 'publication_search', 'general'].includes(payload.intent)
      ? payload.intent
      : 'meeting_search';
    const keywords = (Array.isArray(payload.keywords) ? payload.keywords : [])
      .map((k) => String(k || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 15);
    const synonyms = (Array.isArray(payload.synonyms) ? payload.synonyms : [])
      .map((s) => String(s || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 20);
    const ftsQuery = String(payload.ftsQuery || keywords.join(' OR ')).trim().slice(0, 400);
    const timeframe = String(payload.timeframe || '').trim().slice(0, 80);
    const explanation = String(payload.explanation || '').trim().slice(0, 500);
    return { type: 'search-refine', intent, keywords, synonyms, ftsQuery, timeframe, explanation };
  }

  if (taskType === 'protocol-analysis') {
    const meetingNumber = String(payload.meetingNumber || '').trim().slice(0, 40);
    const meetingDate = String(payload.meetingDate || '').trim().slice(0, 32);
    const chairman = String(payload.chairman || '').trim().slice(0, 160);
    const secretary = String(payload.secretary || '').trim().slice(0, 160);
    const quorum = String(payload.quorum || '').trim().slice(0, 200);

    const rawAgenda = Array.isArray(payload.agenda) ? payload.agenda : [];
    const agenda = rawAgenda
      .filter((it) => it && typeof it === 'object')
      .slice(0, 20)
      .map((item, idx) => {
        const itemNumber = String(item.itemNumber || idx + 1).trim().slice(0, 20);
        const topic = String(item.topic || '').trim().slice(0, 300);
        const speaker = String(item.speaker || '').trim().slice(0, 160);
        const rawDecisions = Array.isArray(item.decisions) ? item.decisions : [];
        const decisions = rawDecisions
          .filter((d) => d && typeof d === 'object')
          .slice(0, 10)
          .map((d) => ({
            action: String(d.action || '').trim().slice(0, 500),
            assignee: String(d.assignee || '').trim().slice(0, 160),
            deadline: String(d.deadline || '').trim().slice(0, 40),
            control: String(d.control || '').trim().slice(0, 160)
          }));
        return { itemNumber, topic, speaker, decisions };
      });

    return { type: 'protocol-analysis', meetingNumber, meetingDate, chairman, secretary, quorum, agenda };
  }

  if (taskType === 'report-synthesis') {
    const sectionTitle = String(payload.sectionTitle || 'Отчёт кафедры').trim().slice(0, 200);
    const executiveSummary = String(payload.executiveSummary || '').trim().slice(0, 1500);
    const rawParagraphs = Array.isArray(payload.paragraphs) ? payload.paragraphs : [];
    const paragraphs = rawParagraphs
      .map((p) => String(p || '').trim().slice(0, 3000))
      .filter(Boolean)
      .slice(0, 20);
    const rawFacts = Array.isArray(payload.facts) ? payload.facts : [];
    const facts = rawFacts
      .filter((f) => f && typeof f === 'object')
      .slice(0, 30)
      .map((f) => ({
        label: String(f.label || '').trim().slice(0, 120),
        value: String(f.value || '').trim().slice(0, 200),
        source: String(f.source || '').trim().slice(0, 200)
      }));
    const rawConclusions = Array.isArray(payload.conclusions) ? payload.conclusions : [];
    const conclusions = rawConclusions
      .map((c) => String(c || '').trim().slice(0, 1000))
      .filter(Boolean)
      .slice(0, 10);

    return { type: 'report-synthesis', sectionTitle, executiveSummary, paragraphs, facts, conclusions };
  }

  if (taskType === 'compliance-check') {
    const summary = String(payload.summary || payload.advice || 'Подсказки по оформлению подготовлены').trim().slice(0, 1000);
    const rawItems = Array.isArray(payload.suggestions) ? payload.suggestions : (Array.isArray(payload.checks) ? payload.checks : []);
    const suggestions = rawItems
      .filter((c) => c && typeof c === 'object')
      .slice(0, 25)
      .map((c) => {
        let status = 'suggestion';
        if (['ok', 'pass'].includes(c.status)) status = 'ok';
        else if (['notice', 'info'].includes(c.status)) status = 'notice';
        else if (['suggestion', 'warn', 'fail'].includes(c.status)) status = 'suggestion';

        return {
          rule: String(c.rule || 'Подсказка').trim().slice(0, 160),
          status,
          details: String(c.details || '').trim().slice(0, 500),
          suggestedFix: String(c.suggestedFix || '').trim().slice(0, 500),
          sourceQuote: String(c.sourceQuote || '').trim().slice(0, 300)
        };
      });

    const rawNotes = Array.isArray(payload.helpfulNotes) ? payload.helpfulNotes : (Array.isArray(payload.recommendations) ? payload.recommendations : []);
    const helpfulNotes = rawNotes
      .map((r) => String(r || '').trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 10);

    return {
      type: 'compliance-check',
      summary,
      suggestions,
      helpfulNotes,
      // Backward compatibility fields
      passed: Boolean(payload.passed !== undefined ? payload.passed : true),
      score: Math.max(0, Math.min(100, Math.round(Number(payload.score !== undefined ? payload.score : 90)))),
      checks: suggestions,
      recommendations: helpfulNotes
    };
  }

  if (taskType === 'suggest-agenda') {
    const explanation = String(payload.explanation || 'Проект повестки сформирован').trim().slice(0, 1000);
    const rawTopics = Array.isArray(payload.topics) ? payload.topics : [];
    const topics = rawTopics
      .filter((t) => t && typeof t === 'object')
      .slice(0, 20)
      .map((t, idx) => ({
        itemNo: idx + 1,
        title: String(t.title || `Вопрос ${idx + 1}`).trim().slice(0, 300),
        heardText: String(t.heardText || '').trim().slice(0, 1000),
        discussedText: String(t.discussedText || '').trim().slice(0, 1000),
        decisionText: String(t.decisionText || '').trim().slice(0, 1500),
        speaker: String(t.speaker || '').trim().slice(0, 160),
        sourceKind: String(t.sourceKind || 'manual').trim().slice(0, 40),
        sourceId: t.sourceId ? String(t.sourceId).trim().slice(0, 80) : null
      }));
    return { type: 'suggest-agenda', explanation, topics };
  }

  throw new Error(`unknown_task_type:${taskType}`);
}

function endpointFor(config) {
  try {
    const raw = String(config?.llmEndpoint || '').trim();
    if (!raw) return null;
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    url.pathname = `${url.pathname.replace(/\/$/u, '').replace(/\/v1$/u, '')}/v1/chat/completions`;
    return url.href;
  } catch {
    return null;
  }
}

export function createAssistantEngine({ config = {}, fetchImpl = fetch, maxCacheEntries = 64, ttlMs = 600_000 } = {}) {
  const cache = new Map();
  let currentConfig = { ...config };
  let endpoint = endpointFor(currentConfig);
  let enabled = Boolean(currentConfig?.llmEnabled && endpoint);

  function updateConfig(newConfig) {
    currentConfig = { ...currentConfig, ...newConfig };
    const newEndpoint = endpointFor(currentConfig);
    if (newEndpoint !== endpoint) {
      cache.clear();
    }
    endpoint = newEndpoint;
    enabled = Boolean(currentConfig?.llmEnabled && endpoint);
    return { enabled, endpoint };
  }

  function getCacheKey(taskType, input) {
    const str = `${taskType}:${JSON.stringify(input)}`;
    return createHash('sha256').update(str).digest('hex');
  }

  function pruneCache() {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > ttlMs) cache.delete(key);
    }
    while (cache.size > maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
      else break;
    }
  }

  async function process({ task, text, query, candidates, signal, customSystemPrompt, customUserPrompt } = {}) {
    const started = Date.now();
    const taskConfig = ASSISTANT_TASKS[task];
    if (!taskConfig) {
      return { status: 'failed', error: 'unknown_task', durationMs: Date.now() - started };
    }

    if (!enabled) {
      return { status: 'disabled', durationMs: Date.now() - started };
    }

    const cleanText = sanitizeInputText(text);
    const inputPayload = {
      task,
      text: cleanText,
      query: sanitizeInputText(query, 500),
      candidates: Array.isArray(candidates) ? candidates.slice(0, 12) : []
    };

    const userContent = customUserPrompt && typeof customUserPrompt === 'string'
      ? customUserPrompt
      : JSON.stringify(inputPayload);
    const systemContent = customSystemPrompt && typeof customSystemPrompt === 'string'
      ? customSystemPrompt
      : taskConfig.system;

    const cacheKey = getCacheKey(task, { inputPayload, customSystemPrompt, customUserPrompt });
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return {
        status: 'completed',
        result: cached.result,
        cached: true,
        durationMs: Date.now() - started,
        prompt: { system: systemContent, user: userContent },
        rawResponse: cached.rawResponse || null
      };
    }

    // Construct prompt
    const maxTokens = Math.min(currentConfig?.llmMaxTokens || 2048, taskConfig.maxTokens);
    const requestBody = {
      model: currentConfig?.llmModel || 'local-model',
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ]
    };

    const headers = {
      'content-type': 'application/json',
      'accept': 'application/json'
    };
    if (currentConfig?.llmApiKey) {
      headers.authorization = `Bearer ${currentConfig.llmApiKey}`;
    }

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal
      });

      if (!response.ok) {
        return {
          status: 'failed',
          error: `llm_http_${response.status}`,
          durationMs: Date.now() - started
        };
      }

      const bodyText = await response.text();
      if (Buffer.byteLength(bodyText) > MAX_RESPONSE_BYTES) {
        return { status: 'failed', error: 'response_too_large', durationMs: Date.now() - started };
      }

      let jsonBody;
      try {
        jsonBody = JSON.parse(bodyText);
      } catch {
        return { status: 'failed', error: 'invalid_server_json', durationMs: Date.now() - started };
      }

      const choice = jsonBody?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string') {
        return { status: 'failed', error: 'empty_response', durationMs: Date.now() - started };
      }

      const parsedObj = extractJsonObject(content);
      if (!parsedObj) {
        return {
          status: 'failed',
          error: 'invalid_json_format',
          rawResponse: content.slice(0, 5000),
          durationMs: Date.now() - started
        };
      }

      const validated = validateAssistantResult(task, parsedObj, { candidates, sourceText: cleanText });
      pruneCache();
      cache.set(cacheKey, { result: validated, rawResponse: content, timestamp: Date.now() });

      return {
        status: 'completed',
        result: validated,
        cached: false,
        durationMs: Date.now() - started,
        prompt: { system: systemContent, user: userContent },
        rawResponse: content
      };
    } catch (error) {
      const name = String(error?.name || '').toLowerCase();
      const isTimeout = name.includes('timeout') || name.includes('abort');
      return {
        status: isTimeout ? 'timeout' : 'unavailable',
        error: error?.message || 'request_failed',
        durationMs: Date.now() - started
      };
    }
  }

  return {
    get enabled() { return enabled; },
    get endpoint() { return endpoint; },
    get config() { return { ...currentConfig }; },
    updateConfig,
    process,
    clearCache: () => cache.clear()
  };
}
