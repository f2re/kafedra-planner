const months = new Map([
  ['января', 1], ['январь', 1],
  ['февраля', 2], ['февраль', 2],
  ['марта', 3], ['март', 3],
  ['апреля', 4], ['апрель', 4],
  ['мая', 5], ['май', 5],
  ['июня', 6], ['июнь', 6],
  ['июля', 7], ['июль', 7],
  ['августа', 8], ['август', 8],
  ['сентября', 9], ['сентябрь', 9],
  ['октября', 10], ['октябрь', 10],
  ['ноября', 11], ['ноябрь', 11],
  ['декабря', 12], ['декабрь', 12]
]);

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function findRussianDates(text) {
  const results = [];
  const source = String(text || '');
  const numeric = /\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-]((?:19|20)\d{2})\b/g;
  for (const match of source.matchAll(numeric)) {
    const value = isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
    if (value) results.push({ value, raw: match[0], index: match.index });
  }
  const words = /\b(0?[1-9]|[12]\d|3[01])\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+((?:19|20)\d{2})(?:\s*г(?:ода|\.)?)?/giu;
  for (const match of source.matchAll(words)) {
    const value = isoDate(Number(match[3]), months.get(match[2].toLowerCase()), Number(match[1]));
    if (value) results.push({ value, raw: match[0], index: match.index });
  }
  return results.sort((a, b) => a.index - b.index);
}

export function firstRussianDate(text) {
  return findRussianDates(text)[0] ?? null;
}
