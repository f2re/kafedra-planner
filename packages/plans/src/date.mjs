import { findRussianDates } from '../../protocols/src/russian-date.mjs';

const MONTHS = new Map([
  ['январь', 1], ['января', 1], ['февраль', 2], ['февраля', 2],
  ['март', 3], ['марта', 3], ['апрель', 4], ['апреля', 4],
  ['май', 5], ['мая', 5], ['июнь', 6], ['июня', 6],
  ['июль', 7], ['июля', 7], ['август', 8], ['августа', 8],
  ['сентябрь', 9], ['сентября', 9], ['октябрь', 10], ['октября', 10],
  ['ноябрь', 11], ['ноября', 11], ['декабрь', 12], ['декабря', 12]
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

function parseMonthWindow(source, period) {
  const range = source.match(new RegExp(`(0?[1-9]|[12]\\d|3[01])\\s*[–—-]\\s*(0?[1-9]|[12]\\d|3[01])\\s+(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?`, 'iu'));
  if (range) {
    const month = MONTHS.get(lower(range[3]));
    const year = Number(range[4] || inferYear(month, period));
    const start = year ? isoDate(year, month, Number(range[1])) : null;
    const end = year ? isoDate(year, month, Number(range[2])) : null;
    if (start && end) return { start, end, precision: 'range', raw: range[0] };
  }

  const monthMatch = source.match(new RegExp(`(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?`, 'iu'));
  if (monthMatch) {
    const month = MONTHS.get(lower(monthMatch[1]));
    const year = Number(monthMatch[2] || inferYear(month, period));
    if (year) {
      return {
        start: isoDate(year, month, 1),
        end: isoDate(year, month, monthEnd(year, month)),
        precision: 'month', raw: monthMatch[0]
      };
    }
  }
  return null;
}

function parseQuarterWindow(source, period) {
  const match = source.match(/([1-4]|I{1,3}|IV)\s*(?:квартал|кв\.)\s*(20\d{2})?/iu);
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
  if (!source) return { start: null, end: null, precision: 'none', raw: '' };
  const explicit = findRussianDates(source);
  if (explicit.length) {
    return {
      start: explicit[0].value,
      end: explicit.length > 1 ? explicit.at(-1).value : null,
      precision: explicit.length > 1 ? 'range' : 'day',
      raw: explicit.map((item) => item.raw).join(' – ')
    };
  }

  const numeric = source.match(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])\b/);
  if (numeric) {
    const month = Number(numeric[2]);
    const year = inferYear(month, period);
    const date = year ? isoDate(year, month, Number(numeric[1])) : null;
    if (date) return { start: date, end: null, precision: 'day', raw: numeric[0], inferredYear: true };
  }

  const wordDay = source.match(new RegExp(`(0?[1-9]|[12]\\d|3[01])\\s+(${MONTH_PATTERN})`, 'iu'));
  if (wordDay) {
    const month = MONTHS.get(lower(wordDay[2]));
    const year = inferYear(month, period);
    const date = year ? isoDate(year, month, Number(wordDay[1])) : null;
    if (date) return { start: date, end: null, precision: 'day', raw: wordDay[0], inferredYear: true };
  }

  return parseMonthWindow(source, period)
    || parseQuarterWindow(source, period)
    || { start: null, end: null, precision: 'none', raw: source };
}
