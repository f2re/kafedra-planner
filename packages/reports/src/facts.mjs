const NUMBER_PATTERN = String.raw`-?\d+(?:[.,]\d+)?`;

const UNIT_RULES = [
  [/^(?:%|процент(?:а|ов)?)/iu, '%'],
  [/^(?:шт\.?|штук(?:а|и)?)/iu, 'шт.'],
  [/^(?:чел\.?|человек(?:а)?)/iu, 'чел.'],
  [/^(?:час(?:а|ов)?|ч\.)/iu, 'ч'],
  [/^(?:руб\.?|рубл(?:ь|я|ей))/iu, 'руб.'],
  [/^(?:тыс\.?\s*руб\.?)/iu, 'тыс. руб.'],
  [/^(?:млн\.?\s*руб\.?)/iu, 'млн руб.'],
  [/^(?:дн(?:я|ей)?|день|дней)/iu, 'дн.']
];

const METRIC_WORDS = new Map([
  ['статья', 'статья'], ['статьи', 'статья'], ['статей', 'статья'], ['статью', 'статья'],
  ['публикация', 'публикация'], ['публикации', 'публикация'], ['публикаций', 'публикация'],
  ['мероприятие', 'мероприятие'], ['мероприятия', 'мероприятие'], ['мероприятий', 'мероприятие'],
  ['документ', 'документ'], ['документа', 'документ'], ['документов', 'документ'],
  ['заявка', 'заявка'], ['заявки', 'заявка'], ['заявок', 'заявка'],
  ['патент', 'патент'], ['патента', 'патент'], ['патентов', 'патент'],
  ['отчет', 'отчет'], ['отчёт', 'отчет'], ['отчета', 'отчет'], ['отчёта', 'отчет'], ['отчетов', 'отчет'], ['отчётов', 'отчет'],
  ['слушатель', 'слушатель'], ['слушателя', 'слушатель'], ['слушателей', 'слушатель'],
  ['студент', 'студент'], ['студента', 'студент'], ['студентов', 'студент'],
  ['договор', 'договор'], ['договора', 'договор'], ['договоров', 'договор'],
  ['проект', 'проект'], ['проекта', 'проект'], ['проектов', 'проект']
]);

const NAME_STOP_WORDS = new Set([
  'план', 'факт', 'целевой', 'цель', 'значение', 'показатель', 'показателя',
  'выполнено', 'выполнены', 'подготовлено', 'проведено', 'опубликовано',
  'направлено', 'разработано', 'достигнуто', 'не', 'менее', 'необходимое',
  'количество', 'всего', 'итого', 'за', 'период'
]);

function asNumber(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value || '')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.—–-]+|[\s:;,.—–-]+$/g, '')
    .trim();
}

function lineLocator(line, lineNumber) {
  return { kind: 'text_line', startLine: lineNumber, endLine: lineNumber, quote: line.slice(0, 240) };
}

function normalizeUnit(value) {
  const text = cleanText(value).toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (!text) return null;
  for (const [pattern, unit] of UNIT_RULES) {
    if (pattern.test(text)) return unit;
  }
  return null;
}

function normalizeWord(value) {
  const text = String(value || '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (METRIC_WORDS.has(text)) return METRIC_WORDS.get(text);
  return text
    .replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ей|ов|ев|ий|ый|ая|ое|ые|ам|ям|ах|ях|у|ю|а|я|ы|и|е)$/u, '')
    .replace(/[^а-яa-z0-9-]/giu, '');
}

export function normalizeMetricName(value) {
  const words = cleanText(value)
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^а-яa-z0-9\s-]/giu, ' ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter((word) => word && !NAME_STOP_WORDS.has(word));
  return words.join('_').slice(0, 120) || 'общий_результат';
}

function parseNumberValue(value) {
  const text = cleanText(value);
  const match = text.match(new RegExp(`^(${NUMBER_PATTERN})\\s*(.*)$`, 'iu'));
  if (!match) return null;
  const numeric = asNumber(match[1]);
  if (numeric === null) return null;
  const tail = cleanText(match[2]);
  const unit = normalizeUnit(tail);
  let name = tail;
  if (unit) {
    for (const [pattern] of UNIT_RULES) name = name.replace(pattern, '');
  }
  name = cleanText(name).replace(/\s+(?:до|к)\s+(?:конц[ау]?|начал[ау]?|\d{1,2}[.\/-]|\d{4}).*$/iu, '');
  return { numeric, unit, name, raw: text };
}

function metricMapEntry(map, name, unit = null) {
  const cleanedName = cleanText(name) || 'Общий результат';
  const key = normalizeMetricName(cleanedName);
  if (!map.has(key)) {
    map.set(key, {
      key,
      name: cleanedName,
      unit: unit || null,
      targetNumeric: null,
      targetText: null,
      actualNumeric: null,
      actualText: null,
      evidence: { plan: [], fact: [] }
    });
  }
  const metric = map.get(key);
  if (!metric.unit && unit) metric.unit = unit;
  return metric;
}

function addPlan(map, name, parsed, locator) {
  const metric = metricMapEntry(map, name || parsed.name, parsed.unit);
  metric.targetNumeric = parsed.numeric;
  metric.targetText = parsed.raw;
  metric.evidence.plan.push(locator);
}

function addFact(map, name, parsed, locator) {
  const metric = metricMapEntry(map, name || parsed.name, parsed.unit);
  metric.actualNumeric = parsed.numeric;
  metric.actualText = parsed.raw;
  metric.evidence.fact.push(locator);
}

function parseStructuredLine(map, line, lineNumber) {
  const parts = line.split(/[;|]/).map(cleanText).filter(Boolean);
  const fields = new Map();
  for (const part of parts) {
    const match = part.match(/^([^:—–-]{2,40})\s*[:—–-]\s*(.+)$/u);
    if (match) fields.set(cleanText(match[1]).toLocaleLowerCase('ru-RU').replaceAll('ё', 'е'), cleanText(match[2]));
  }
  const name = fields.get('показатель') || fields.get('наименование показателя') || fields.get('критерий');
  const planText = fields.get('план') || fields.get('целевое значение') || fields.get('цель');
  const factText = fields.get('факт') || fields.get('фактическое значение') || fields.get('результат');
  const explicitUnit = normalizeUnit(fields.get('единица') || fields.get('ед. изм.') || fields.get('единица измерения'));
  const locator = lineLocator(line, lineNumber);
  if (name && planText) {
    const parsed = parseNumberValue(planText);
    if (parsed) addPlan(map, name, { ...parsed, unit: parsed.unit || explicitUnit }, locator);
  }
  if (name && factText) {
    const parsed = parseNumberValue(factText);
    if (parsed) addFact(map, name, { ...parsed, unit: parsed.unit || explicitUnit }, locator);
  }
  return Boolean(name && (planText || factText));
}

function parseInlinePlanFact(map, line, lineNumber) {
  const match = line.match(new RegExp(`^(.{2,120}?)\\s*[:—–-]\\s*план\\s*[:—–-]?\\s*(${NUMBER_PATTERN})\\s*([^,;]*?)[,;]\\s*факт\\s*[:—–-]?\\s*(${NUMBER_PATTERN})\\s*(.*)$`, 'iu'));
  if (!match) return false;
  const name = cleanText(match[1]);
  const plan = parseNumberValue(`${match[2]} ${match[3]}`);
  const fact = parseNumberValue(`${match[4]} ${match[5]}`);
  const locator = lineLocator(line, lineNumber);
  if (plan) addPlan(map, name, plan, locator);
  if (fact) addFact(map, name, fact, locator);
  return true;
}

function parseRatioLine(map, line, lineNumber) {
  const match = line.match(new RegExp(`(?:выполнено|подготовлено|проведено|опубликовано|достигнуто)\\s*[:—–-]?\\s*(${NUMBER_PATTERN})\\s+из\\s+(${NUMBER_PATTERN})\\s*(.*)$`, 'iu'));
  if (!match) return false;
  const actual = asNumber(match[1]);
  const target = asNumber(match[2]);
  const tail = cleanText(match[3]);
  if (actual === null || target === null) return false;
  const parsedTail = parseNumberValue(`0 ${tail}`);
  const unit = parsedTail?.unit || null;
  let name = parsedTail?.name || tail || 'Общий результат';
  if (!name && unit === '%') name = 'Выполнение';
  const locator = lineLocator(line, lineNumber);
  addPlan(map, name, { numeric: target, unit, name, raw: `${target} ${tail}`.trim() }, locator);
  addFact(map, name, { numeric: actual, unit, name, raw: `${actual} ${tail}`.trim() }, locator);
  return true;
}

function parseMarkerLine(map, line, lineNumber, mode) {
  const marker = mode === 'plan'
    ? '(?:план|целев(?:ое|ой)\\s+значение|цель|не\\s+менее)'
    : '(?:факт|фактически|выполнено|подготовлено|проведено|опубликовано|направлено|разработано|достигнуто)';
  const match = line.match(new RegExp(`${marker}\\s*[:—–-]?\\s*(${NUMBER_PATTERN})\\s*(.*)$`, 'iu'));
  if (!match) return false;
  const parsed = parseNumberValue(`${match[1]} ${match[2]}`);
  if (!parsed) return false;
  let name = parsed.name || 'Общий результат';
  if (parsed.unit === '%' && !parsed.name) name = 'Выполнение';
  const locator = lineLocator(line, lineNumber);
  if (mode === 'plan') addPlan(map, name, parsed, locator);
  else addFact(map, name, parsed, locator);
  return true;
}

function parseObligationLine(map, line, lineNumber) {
  const match = line.match(new RegExp(`(?:подготовить|провести|опубликовать|разработать|направить|обеспечить|представить|заключить)\\s+(?:не\\s+менее\\s+)?(${NUMBER_PATTERN})\\s*(.*)$`, 'iu'));
  if (!match) return false;
  const parsed = parseNumberValue(`${match[1]} ${match[2]}`);
  if (!parsed || (!parsed.name && !parsed.unit)) return false;
  addPlan(map, parsed.name || 'Общий результат', parsed, lineLocator(line, lineNumber));
  return true;
}

function parseMetrics(text, { includeObligations = false } = {}) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/).map(cleanText).filter(Boolean);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (parseStructuredLine(map, line, lineNumber)) return;
    if (parseInlinePlanFact(map, line, lineNumber)) return;
    if (parseRatioLine(map, line, lineNumber)) return;
    const planFound = parseMarkerLine(map, line, lineNumber, 'plan');
    const factFound = parseMarkerLine(map, line, lineNumber, 'fact');
    if (!planFound && !factFound && includeObligations) parseObligationLine(map, line, lineNumber);
  });
  return [...map.values()];
}

function detectResultState(text) {
  const value = String(text || '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (/(?:отменено|поручение\s+отменено|исполнение\s+прекращено)/u.test(value)) return 'cancelled';
  if (/(?:срок\s+перенесен|перенесено\s+на|срок\s+продлен|исполнение\s+продлено)/u.test(value)) return 'postponed';
  if (/(?:выполнено\s+частично|частично\s+выполнено|не\s+в\s+полном\s+объеме|требуется\s+доработка)/u.test(value)) return 'partial';
  if (/(?:поручение\s+выполнено|выполнено\s+полностью|результат\s+достигнут|работы\s+завершены)/u.test(value)) return 'completed';
  return 'unknown';
}

function resultSummary(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanText).filter(Boolean);
  const line = lines.find((item) => /(?:поручение|результат|выполнено|частично|перенес|отменено|итог)/iu.test(item));
  return line?.slice(0, 500) || lines[0]?.slice(0, 500) || null;
}

function explicitProgress(text) {
  const match = String(text || '').match(new RegExp(`(?:выполнено|готовность|исполнение|прогресс)\\s*(?:на|:)\\s*(${NUMBER_PATTERN})\\s*%`, 'iu'));
  const value = match ? asNumber(match[1]) : null;
  return value === null ? null : Math.max(0, Math.min(100, value));
}

function metricProgress(metrics) {
  const ratios = metrics
    .filter((metric) => Number.isFinite(metric.targetNumeric) && metric.targetNumeric > 0 && Number.isFinite(metric.actualNumeric))
    .map((metric) => Math.max(0, Math.min(1, metric.actualNumeric / metric.targetNumeric)) * 100);
  if (!ratios.length) return null;
  return Math.round(ratios.reduce((sum, value) => sum + value, 0) / ratios.length);
}

export function extractPlanMetrics(text) {
  return parseMetrics(text, { includeObligations: true })
    .filter((metric) => metric.targetNumeric !== null || metric.targetText)
    .map((metric) => ({ ...metric, actualNumeric: null, actualText: null, evidence: { plan: metric.evidence.plan, fact: [] } }));
}

export function looksLikeReportFacts(text, title = '') {
  const haystack = `${title}\n${text}`.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const reportMarker = /(?:^|\s)(?:отчет|справка|акт|доклад)(?=$|\s|[.,;:])/u.test(haystack);
  const resultMarker = /(?:план\s*[:—–-]|факт\s*[:—–-]|поручение\s+выполнено|выполнено\s+частично|выполнено\s+\d+\s+из\s+\d+)/u.test(haystack);
  return reportMarker && resultMarker;
}

export function extractReportFacts(text, title = '') {
  const metrics = parseMetrics(text, { includeObligations: false });
  const state = detectResultState(text);
  const progress = explicitProgress(text) ?? metricProgress(metrics)
    ?? (state === 'completed' ? 100 : state === 'partial' ? 50 : null);
  const signalCount = metrics.length + (state !== 'unknown' ? 1 : 0) + (progress !== null ? 1 : 0);
  return {
    title: cleanText(title) || null,
    resultState: state,
    summary: resultSummary(text),
    progressPercent: progress,
    metrics,
    confidence: Math.min(0.98, 0.35 + signalCount * 0.12),
    evidence: {
      result: resultSummary(text),
      metricCount: metrics.length,
      deterministic: true
    }
  };
}
