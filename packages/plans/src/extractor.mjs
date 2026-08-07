const MONTHS = new Map([
  ['январь', 1], ['января', 1], ['январе', 1],
  ['февраль', 2], ['февраля', 2], ['феврале', 2],
  ['март', 3], ['марта', 3], ['марте', 3],
  ['апрель', 4], ['апреля', 4], ['апреле', 4],
  ['май', 5], ['мая', 5], ['мае', 5],
  ['июнь', 6], ['июня', 6], ['июне', 6],
  ['июль', 7], ['июля', 7], ['июле', 7],
  ['август', 8], ['августа', 8], ['августе', 8],
  ['сентябрь', 9], ['сентября', 9], ['сентябре', 9],
  ['октябрь', 10], ['октября', 10], ['октябре', 10],
  ['ноябрь', 11], ['ноября', 11], ['ноябре', 11],
  ['декабрь', 12], ['декабря', 12], ['декабре', 12]
]);

const PLAN_SCOPES = new Set(['department', 'faculty', 'personal', 'unit', 'organization']);

function normalized(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function academicStartYear(periodKey) {
  const match = String(periodKey || '').match(/^(20\d{2})\s*[/–—-]/);
  return match ? Number(match[1]) : null;
}

function periodYear(period, month) {
  if (!period?.key) return null;
  if (period.kind === 'calendar_year') {
    const match = String(period.key).match(/(20\d{2})/);
    return match ? Number(match[1]) : null;
  }
  if (period.kind === 'academic_year') {
    const start = academicStartYear(period.key);
    if (!start) return null;
    return month >= 9 ? start : start + 1;
  }
  return null;
}

function normalizeAcademicKey(start, rawEnd) {
  const end = Number(rawEnd) < 100
    ? Math.floor(Number(start) / 100) * 100 + Number(rawEnd)
    : Number(rawEnd);
  if (end !== Number(start) + 1) return `${start}/${end}`;
  return `${start}/${String(end).slice(-2)}`;
}

export function detectPlanPeriod(text, hint = {}) {
  const hintedKind = ['calendar_year', 'academic_year', 'custom'].includes(hint.periodKind)
    ? hint.periodKind
    : null;
  const hintedKey = String(hint.periodKey || '').trim();
  if (hintedKey) {
    return {
      kind: hintedKind || (/[\/–—-]/.test(hintedKey) ? 'academic_year' : 'calendar_year'),
      key: hintedKey,
      raw: hintedKey,
      source: 'hint'
    };
  }

  const source = String(text || '');
  const academic = source.match(/\b(20\d{2})\s*[/–—-]\s*(20\d{2}|\d{2})\s*(?:учебн[а-яё]*\s+год[а-яё]*)?/iu);
  if (academic) {
    return {
      kind: 'academic_year',
      key: normalizeAcademicKey(Number(academic[1]), academic[2]),
      raw: academic[0],
      source: 'document'
    };
  }
  const calendar = source.match(/(?:^|\s)(?:на\s+|за\s+|план[а-яё]*\s+(?:работ[а-яё]*\s+)?(?:на\s+)?)(20\d{2})\s*(?:г(?:од|ода)?\.?)?/iu)
    || source.match(/(20\d{2})\s+год(?:а)?/iu);
  if (calendar) {
    return {
      kind: 'calendar_year',
      key: String(calendar[1]),
      raw: calendar[0],
      source: 'document'
    };
  }
  return { kind: hintedKind || 'unknown', key: null, raw: null, source: null };
}

function scopeFromRequested(value) {
  const requested = normalized(value).replaceAll('-', '_');
  if (requested.includes('personal') || requested.includes('individual')) return 'personal';
  if (requested.includes('faculty')) return 'faculty';
  if (requested.includes('department')) return 'department';
  if (requested.includes('organization')) return 'organization';
  if (requested.includes('unit')) return 'unit';
  return null;
}

export function detectPlanScope(text, title = '', hint = {}) {
  if (PLAN_SCOPES.has(hint.planScope)) return hint.planScope;
  const requested = scopeFromRequested(hint.requestedType);
  if (requested) return requested;
  const source = normalized(`${title}\n${text}`);
  if (/(индивидуальн|личн)[а-я]*\s+план/u.test(source)) return 'personal';
  if (/план[а-я]*\s+(?:работ[а-я]*\s+)?факультет/u.test(source) || /факультет[а-я]*\s+план/u.test(source)) return 'faculty';
  if (/план[а-я]*\s+(?:работ[а-я]*\s+)?кафедр/u.test(source) || /кафедр[а-я]*\s+план/u.test(source)) return 'department';
  if (/(университет|институт|организаци)[а-я]*/u.test(source) && /план/u.test(source)) return 'organization';
  return 'unit';
}

function ownerFromText(text) {
  const source = String(text || '');
  const match = source.match(/(?:Ф\.?\s*И\.?\s*О\.?|сотрудник|преподаватель)\s*[:–—-]\s*([А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/u);
  return match ? match[1].trim() : null;
}

function headerKind(value) {
  const text = normalized(value);
  if (!text) return null;
  if (/^(№|n\b|номер|п\/?п)/u.test(text)) return 'number';
  if (/(срок[а-я]*\s+(исполн|выполн|сдач)|контрольн[а-я]*\s+срок|дата\s+исполн)/u.test(text)) return 'due';
  if (/(ответствен|исполнител|соисполнител)/u.test(text)) return 'responsible';
  if (/(ожидаем[а-я]*\s+результат|форма\s+отчет|отчетност|результат)/u.test(text)) return 'result';
  if (/(направлен|раздел|вид\s+деятельност)/u.test(text)) return 'direction';
  if (/(дата|сроки?\s+проведен|период|время\s+проведен)/u.test(text)) return 'date';
  if (/(наименован[а-я]*\s+(мероприят|работ)|мероприят|содержание\s+работ|вид\s+работ|задач|работы)/u.test(text)) return 'title';
  return null;
}

function excelColumnNumber(value) {
  const text = String(value || '').toUpperCase();
  if (/^\d+$/.test(text)) return Number(text);
  let result = 0;
  for (const char of text) {
    if (char < 'A' || char > 'Z') return 0;
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result;
}

function blockPosition(block) {
  const locator = block?.locator || {};
  const metadata = block?.metadata || {};
  if (locator.kind === 'docx_table_cell') {
    return { tableKey: `docx:${locator.table}`, table: Number(locator.table), row: Number(locator.row), column: Number(locator.column) };
  }
  if (locator.kind === 'odf_table_cell') {
    return { tableKey: `odf:${locator.table}`, table: locator.table, row: Number(locator.row), column: Number(locator.column) };
  }
  if (locator.kind === 'xlsx_cell') {
    return {
      tableKey: `xlsx:${locator.sheet}`,
      table: locator.sheet,
      row: Number(metadata.row || (String(locator.cell || '').match(/\d+/) || [0])[0]),
      column: excelColumnNumber(metadata.column || (String(locator.cell || '').match(/[A-Z]+/i) || [''])[0])
    };
  }
  return null;
}

function structuredTables(blocks) {
  const tables = new Map();
  for (const block of blocks || []) {
    const position = blockPosition(block);
    if (!position || !position.row || !position.column) continue;
    if (!tables.has(position.tableKey)) {
      tables.set(position.tableKey, { key: position.tableKey, table: position.table, rows: new Map() });
    }
    const table = tables.get(position.tableKey);
    if (!table.rows.has(position.row)) table.rows.set(position.row, new Map());
    table.rows.get(position.row).set(position.column, block);
  }
  return [...tables.values()];
}

function detectTable(blocks) {
  let best = null;
  for (const table of structuredTables(blocks)) {
    for (const [rowNo, cells] of table.rows) {
      const map = {};
      for (const [column, block] of cells) {
        const kind = headerKind(block.text);
        if (kind && map[kind] === undefined) map[kind] = column;
      }
      const kinds = Object.keys(map);
      const score = kinds.length
        + (map.title ? 4 : 0)
        + (map.date || map.due ? 2 : 0)
        + (map.responsible ? 1 : 0);
      if (!map.title || (!map.date && !map.due && !map.responsible)) continue;
      if (!best || score > best.score) best = { table, headerRow: rowNo, columnMap: map, score };
    }
  }
  return best;
}

function monthMatch(text) {
  const source = normalized(text);
  for (const [name, month] of MONTHS) {
    if (new RegExp(`(^|[^а-я])${name}([^а-я]|$)`, 'u').test(source)) return { month, raw: name };
  }
  return null;
}

function dateFromCell(value, period, { due = false } = {}) {
  const source = String(value || '').trim();
  if (!source) return null;

  let match = source.match(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])(?:[./-]((?:19|20)?\d{2}))?\b/);
  if (match) {
    const month = Number(match[2]);
    let year = match[3] ? Number(match[3]) : periodYear(period, month);
    if (year && year < 100) year += 2000;
    const start = year ? isoDate(year, month, Number(match[1])) : null;
    if (start) return { start, end: null, raw: match[0], precision: 'day' };
  }

  match = source.match(/\b(0?[1-9]|[12]\d|3[01])\s+(январ[ьяе]|феврал[ьяе]|март[ае]?|апрел[ьяе]|ма[йяе]|июн[ьяе]|июл[ьяе]|август[ае]?|сентябр[ьяе]|октябр[ьяе]|ноябр[ьяе]|декабр[ьяе])(?:\s+((?:19|20)\d{2}))?/iu);
  if (match) {
    const month = MONTHS.get(normalized(match[2]));
    const year = match[3] ? Number(match[3]) : periodYear(period, month);
    const start = year ? isoDate(year, month, Number(match[1])) : null;
    if (start) return { start, end: null, raw: match[0], precision: 'day' };
  }

  const monthOnly = monthMatch(source);
  if (monthOnly) {
    const year = periodYear(period, monthOnly.month);
    if (!year) return null;
    const first = isoDate(year, monthOnly.month, 1);
    const last = isoDate(year, monthOnly.month, lastDay(year, monthOnly.month));
    return due
      ? { start: last, end: null, raw: monthOnly.raw, precision: 'month' }
      : { start: first, end: last, raw: monthOnly.raw, precision: 'month' };
  }
  return null;
}

function directionFromText(value) {
  const text = normalized(value);
  if (/(науч|нир|публикац|конференц|исследован|грант)/u.test(text)) return 'science';
  if (/(учеб|образован|дисциплин|занят|методичес|студент|практик|гиа)/u.test(text)) return 'education';
  return 'organizational';
}

function itemKind(title, dateText, dueText) {
  const source = normalized(`${title} ${dateText || ''}`);
  if (dueText && !dateText) return 'task';
  if (/(сдать|представить|подготовить|отчет|отчёт|контроль|завершить|утвердить)/u.test(source)) return dueText ? 'task' : 'milestone';
  return 'event';
}

function tableItems(candidate, period) {
  const items = [];
  const rows = [...candidate.table.rows.keys()].sort((a, b) => a - b);
  for (const rowNo of rows) {
    if (rowNo <= candidate.headerRow) continue;
    const cells = candidate.table.rows.get(rowNo);
    const cell = (kind) => cells.get(candidate.columnMap[kind]);
    const titleBlock = cell('title');
    const title = String(titleBlock?.text || '').trim();
    if (!title || headerKind(title) === 'title') continue;
    const numberBlock = cell('number');
    const dateBlock = cell('date');
    const dueBlock = cell('due');
    const responsibleBlock = cell('responsible');
    const resultBlock = cell('result');
    const directionBlock = cell('direction');
    const eventDate = dateFromCell(dateBlock?.text, period, { due: false });
    const dueDate = dateFromCell(dueBlock?.text, period, { due: true });
    const rawBlocks = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, block]) => block);
    const confidence = Math.max(0.45, Math.min(0.98,
      0.72 + (eventDate || dueDate ? 0.1 : 0) + (responsibleBlock?.text ? 0.06 : 0) + (numberBlock?.text ? 0.04 : 0)));
    items.push({
      sourceRowKey: `${candidate.table.key}:row:${rowNo}`,
      itemNo: String(numberBlock?.text || '').trim() || null,
      title,
      description: null,
      startsAt: eventDate?.start || null,
      endsAt: eventDate?.end || null,
      dueDate: dueDate?.start || null,
      itemKind: itemKind(title, dateBlock?.text, dueBlock?.text),
      direction: directionFromText(`${directionBlock?.text || ''} ${title}`),
      responsibleRaw: String(responsibleBlock?.text || '').trim() || null,
      expectedResult: String(resultBlock?.text || '').trim() || null,
      importance: 'normal',
      confidence,
      evidence: {
        kind: 'plan_table_row',
        table: candidate.table.table,
        row: rowNo,
        raw: rawBlocks.map((block) => block.text).join(' | '),
        locators: rawBlocks.map((block) => block.locator),
        fields: Object.fromEntries([
          ['title', titleBlock], ['number', numberBlock], ['date', dateBlock], ['due', dueBlock],
          ['responsible', responsibleBlock], ['result', resultBlock], ['direction', directionBlock]
        ].filter(([, block]) => block).map(([key, block]) => [key, { raw: block.text, locator: block.locator }]))
      }
    });
  }
  return items;
}

function fallbackItems(text, period) {
  const items = [];
  const lines = String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  lines.forEach((line, index) => {
    const clean = line.trim();
    if (clean.length < 8 || headerKind(clean)) return;
    const date = dateFromCell(clean, period, { due: /до\s+/iu.test(clean) });
    if (!date) return;
    const numbered = clean.match(/^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+)$/u);
    let title = numbered ? numbered[2] : clean;
    title = title.replace(date.raw, '').replace(/\s{2,}/g, ' ').replace(/[;,–—-]+\s*$/u, '').trim();
    if (title.length < 4) return;
    const due = /(до|срок|представить|сдать|завершить)/iu.test(clean);
    items.push({
      sourceRowKey: `text:line:${index + 1}`,
      itemNo: numbered?.[1] || null,
      title,
      description: clean,
      startsAt: due ? null : date.start,
      endsAt: due ? null : date.end,
      dueDate: due ? date.start : null,
      itemKind: due ? 'task' : 'event',
      direction: directionFromText(title),
      responsibleRaw: null,
      expectedResult: null,
      importance: 'normal',
      confidence: 0.56,
      evidence: { kind: 'plan_text_line', line: index + 1, raw: clean, locator: { kind: 'text_line', line: index + 1 } }
    });
  });
  return items;
}

function titleFromText(text, documentTitle) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /(^|[^а-яё])план([^а-яё]|$)/iu.test(line) && line.length <= 240);
  return candidate || documentTitle || 'План';
}

export function looksLikePlan(text, title = '', blocks = []) {
  const source = normalized(`${title}\n${text}`);
  let score = 0;
  if (/(^|[^а-яё])план([^а-яё]|$)/u.test(normalized(title))) score += 2;
  if (/план[а-я]*\s+(работ|мероприят|деятельност|кафедр|факультет)/u.test(source)) score += 3;
  if (/(индивидуальн|личн)[а-я]*\s+план/u.test(source)) score += 3;
  const table = detectTable(blocks);
  if (table) score += 4;
  return score >= 5;
}

export function extractPlan({ text, title, blocks = [], hints = {} }) {
  const period = detectPlanPeriod(text, hints);
  const scope = detectPlanScope(text, title, hints);
  const table = detectTable(blocks);
  const items = table ? tableItems(table, period) : fallbackItems(text, period);
  const ownerRaw = scope === 'personal' ? (hints.ownerRaw || ownerFromText(text)) : null;
  let confidence = table ? 0.82 : 0.58;
  if (period.key) confidence += 0.08;
  if (items.length) confidence += 0.06;
  confidence = Math.min(0.98, confidence);
  return {
    kind: 'plan',
    title: titleFromText(text, title),
    planScope: scope,
    periodKind: period.kind,
    periodKey: period.key,
    ownerPersonId: hints.ownerPersonId || null,
    ownerRaw,
    sourceTemplateId: hints.sourceTemplateId || null,
    confidence,
    evidence: {
      period: period.raw ? { raw: period.raw, source: period.source } : null,
      structure: table ? {
        table: table.table.table,
        headerRow: table.headerRow,
        columnMap: table.columnMap
      } : { kind: 'text_fallback' }
    },
    items
  };
}

export function analyzePlanTable(blocks = []) {
  const candidate = detectTable(blocks);
  if (!candidate) return null;
  const rows = [...candidate.table.rows.keys()].sort((a, b) => a - b);
  const sampleRow = rows.find((row) => row > candidate.headerRow) || candidate.headerRow + 1;
  return {
    table: candidate.table.table,
    tableKey: candidate.table.key,
    tableIndex: typeof candidate.table.table === 'number' ? candidate.table.table : 1,
    headerRow: candidate.headerRow,
    sampleRow,
    columnMap: candidate.columnMap,
    score: candidate.score
  };
}
