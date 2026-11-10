import { findRussianDates } from '../../protocols/src/russian-date.mjs';

const MONTHS = new Map([
  ['январь', 1], ['января', 1], ['февраль', 2], ['февраля', 2],
  ['март', 3], ['марта', 3], ['апрель', 4], ['апреля', 4],
  ['май', 5], ['мая', 5], ['июнь', 6], ['июня', 6],
  ['июль', 7], ['июля', 7], ['август', 8], ['августа', 8],
  ['сентябрь', 9], ['сентября', 9], ['октябрь', 10], ['октября', 10],
  ['ноябрь', 11], ['ноября', 11], ['декабрь', 12], ['декабря', 12],
  ['январе', 1], ['феврале', 2], ['марте', 3], ['апреле', 4],
  ['мае', 5], ['июне', 6], ['июле', 7], ['августе', 8],
  ['сентябре', 9], ['октябре', 10], ['ноябре', 11], ['декабре', 12]
]);
const MONTH_PATTERN = [...MONTHS.keys()].join('|');

export function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function lower(value) {
  return clean(value).toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inferYear(month, period) {
  if (!period?.yearStart) return null;
  const kind = period.periodKind || period.kind;
  if (kind === 'academic' && period.yearEnd && month < 8) return period.yearEnd;
  return period.yearStart;
}

function parseYearEnd(start, rawEnd) {
  const end = Number(rawEnd);
  if (String(rawEnd).length === 2) return Math.floor(start / 100) * 100 + end;
  return end;
}

export function extractPlanPeriod(text, title = '') {
  const source = clean(`${title}\n${text}`);
  const academic = source.match(new RegExp(`\\b(20\\d{2})\\s*[\\/–—-]\\s*(20\\d{2}|\\d{2})\\s*(?:уч(?:ебн(?:ый|ого|ом)?)?\\s*г(?:од(?:а|у)?)?\\.?)`, 'iu'));
  if (academic) {
    const yearStart = Number(academic[1]);
    const yearEnd = parseYearEnd(yearStart, academic[2]);
    if (yearEnd >= yearStart && yearEnd <= yearStart + 2) {
      return {
        kind: 'academic',
        key: `${yearStart}/${String(yearEnd).slice(-2)}`,
        yearStart,
        yearEnd,
        confidence: 0.98,
        evidence: { raw: academic[0], source: 'document_text' }
      };
    }
  }

  const calendar = source.match(/(?:на\s+|за\s+)?(20\d{2})\s*(?:календарн(?:ый|ого|ом)\s+)?г(?:од(?:а|у|ом)?|\.)/iu);
  if (calendar) {
    const year = Number(calendar[1]);
    return {
      kind: 'calendar', key: String(year), yearStart: year, yearEnd: year,
      confidence: 0.94, evidence: { raw: calendar[0], source: 'document_text' }
    };
  }

  const years = [...new Set(findRussianDates(source).map((item) => Number(item.value.slice(0, 4))))];
  if (years.length === 1) {
    return {
      kind: 'calendar', key: String(years[0]), yearStart: years[0], yearEnd: years[0],
      confidence: 0.55,
      evidence: { raw: String(years[0]), source: 'dated_rows', inferred: true }
    };
  }
  if (years.length === 2 && years[1] === years[0] + 1) {
    return {
      kind: 'academic', key: `${years[0]}/${String(years[1]).slice(-2)}`,
      yearStart: years[0], yearEnd: years[1], confidence: 0.45,
      evidence: { raw: years.join('–'), source: 'dated_rows', inferred: true }
    };
  }
  return { kind: 'unknown', key: null, yearStart: null, yearEnd: null, confidence: 0, evidence: null };
}

function unresolved(raw, precision = 'none') {
  return { start: null, end: null, precision, raw };
}

function validDateParts(parts, year) {
  // A missing year may still describe February 29; do not invent the actual year.
  return isoDate(year || 2024, parts.month, parts.day);
}

function dateTokens(source) {
  const matches = [];
  const collect = (pattern, parts) => {
    for (const match of source.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (matches.some((item) => item.index < end && item.end > match.index)) continue;
      matches.push({ ...parts(match), index: match.index, end, raw: match[0] });
    }
  };
  collect(/(?<![\p{L}\d])((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/giu,
    (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }));
  collect(/(?<![\d./])(\d{1,2})[./-](\d{1,2})(?:[./-]((?:19|20)\d{2}))?(?![\d./])/gu,
    (m) => ({ year: m[3] ? Number(m[3]) : null, month: Number(m[2]), day: Number(m[1]) }));
  collect(new RegExp(`(?<![\\p{L}\\d])[«"“]?(\\d{1,2})[»"”]?\\s*(${MONTH_PATTERN})(?![\\p{L}])(?:\\s+((?:19|20)\\d{2})(?!\\d))?`, 'giu'),
    (m) => ({ year: m[3] ? Number(m[3]) : null, month: MONTHS.get(lower(m[2])), day: Number(m[1]) }));
  return matches.sort((a, b) => a.index - b.index);
}

function rangeSeparator(value) {
  return /^(?:\s*г(?:ода|од|\.)?)?\s*(?:[–—-]|по|до)\s*$/iu.test(value);
}

function dateRange(left, right, raw, period) {
  const leftYear = left.year || (right.year && left.month <= right.month ? right.year : inferYear(left.month, period)) || right.year;
  const rightYear = right.year || (left.year && right.month >= left.month ? left.year : inferYear(right.month, period)) || left.year;
  if (!validDateParts(left, leftYear) || !validDateParts(right, rightYear)) return unresolved(raw, 'invalid');
  if (!leftYear || !rightYear) return unresolved(raw);
  const start = isoDate(leftYear, left.month, left.day);
  const end = isoDate(rightYear, right.month, right.day);
  if (end < start) return unresolved(raw, 'invalid');
  return { start, end, precision: 'range', raw, ...(!left.year || !right.year ? { inferredYear: true } : {}) };
}

function parseMonthWindow(source, period) {
  const matches = [...source.matchAll(new RegExp(`(?<![\\p{L}])(${MONTH_PATTERN})(?![\\p{L}])(?:\\s+((?:19|20)\\d{2})(?!\\d))?`, 'giu'))];
  if (matches.length === 2 && rangeSeparator(source.slice(matches[0].index + matches[0][0].length, matches[1].index))) {
    const left = { day: 1, month: MONTHS.get(lower(matches[0][1])), year: Number(matches[0][2]) || null };
    const right = { day: 1, month: MONTHS.get(lower(matches[1][1])), year: Number(matches[1][2]) || null };
    const range = dateRange(left, right, source.slice(matches[0].index, matches[1].index + matches[1][0].length), period);
    if (range.end) {
      const year = Number(range.end.slice(0, 4));
      range.end = isoDate(year, right.month, monthEnd(year, right.month));
    }
    return range;
  }
  if (matches.length !== 1) return matches.length ? unresolved(source) : null;
  const match = matches[0];
  const month = MONTHS.get(lower(match[1]));
  const year = Number(match[2] || inferYear(month, period));
  return year ? {
    start: isoDate(year, month, 1), end: isoDate(year, month, monthEnd(year, month)),
    precision: 'month', raw: match[0]
  } : unresolved(source);
}

function parseQuarterWindow(source, period) {
  const match = source.match(/(?<![\p{L}\d])([1-4]|IV|I{1,3})\s*(?:квартал|кв\.)\s*(20\d{2})?/iu);
  if (!match) return null;
  const roman = { I: 1, II: 2, III: 3, IV: 4 };
  const quarter = Number(match[1]) || roman[String(match[1]).toUpperCase()] || null;
  const year = Number(match[2] || period?.yearStart);
  if (!quarter || !year) return null;
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    start: isoDate(year, startMonth, 1),
    end: isoDate(year, endMonth, monthEnd(year, endMonth)),
    precision: 'quarter', raw: match[0]
  };
}

export function parsePlanDateWindow(value, period = null) {
  const source = clean(value);
  if (!source) return unresolved('');
  const tokens = dateTokens(source);
  // Resolve a shared month before looking at the final day in the range.
  const shared = source.match(new RegExp(`(?<![\\p{L}\\d])[«"“]?(\\d{1,2})[»"”]?\\s*(?:[–—-]|по)\\s*[«"“]?(\\d{1,2})[»"”]?\\s*(${MONTH_PATTERN})(?![\\p{L}])(?:\\s+((?:19|20)\\d{2})(?!\\d))?`, 'iu'));
  if (shared) {
    if (tokens.some((token) => token.index < shared.index || token.end > shared.index + shared[0].length)) return unresolved(source);
    const month = MONTHS.get(lower(shared[3]));
    const year = Number(shared[4]) || inferYear(month, period);
    const range = dateRange({ day: Number(shared[1]), month, year }, { day: Number(shared[2]), month, year }, shared[0], period);
    return range.start && !shared[4] ? { ...range, inferredYear: true } : range;
  }
  if (tokens.length === 2 && rangeSeparator(source.slice(tokens[0].end, tokens[1].index))) {
    return dateRange(tokens[0], tokens[1], source.slice(tokens[0].index, tokens[1].end), period);
  }
  if (tokens.some((token) => !validDateParts(token, token.year || inferYear(token.month, period)))) return unresolved(source, 'invalid');
  if (tokens.length > 1) return unresolved(source);
  if (tokens.length === 1) {
    const token = tokens[0];
    const year = token.year || inferYear(token.month, period);
    if (!year) return unresolved(source);
    return {
      start: isoDate(year, token.month, token.day), end: null, precision: 'day', raw: token.raw,
      ...(!token.year ? { inferredYear: true } : {})
    };
  }

  return parseMonthWindow(source, period)
    || parseQuarterWindow(source, period)
    || unresolved(source);
}
