import { clean, lower } from './date.mjs';

function columnNumber(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return Number(value) || 0;
  let result = 0;
  for (const char of text) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function structuredRows(blocks) {
  const groups = new Map();
  for (const block of blocks || []) {
    const row = Number(block?.metadata?.row || 0);
    if (!row) continue;
    const table = block.metadata?.table;
    const sheet = block.metadata?.sheet;
    if (table === undefined && !sheet) continue;
    const groupKey = sheet ? `sheet:${sheet}` : `table:${String(table)}`;
    if (!groups.has(groupKey)) groups.set(groupKey, new Map());
    const rows = groups.get(groupKey);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push({
      text: clean(block.text),
      locator: block.locator || {},
      column: columnNumber(block.metadata?.column || block.metadata?.cell?.match(/[A-Z]+/i)?.[0] || 0)
    });
  }
  const result = [];
  for (const [groupKey, rows] of groups) {
    const [kind, ...nameParts] = groupKey.split(':');
    for (const [rowNumber, cells] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
      result.push({
        groupKey,
        groupKind: kind,
        groupName: nameParts.join(':'),
        rowNumber,
        cells: cells.filter((cell) => cell.text).sort((a, b) => a.column - b.column)
      });
    }
  }
  return result;
}

function delimitedRows(blocks) {
  const rows = [];
  for (let index = 0; index < (blocks || []).length; index += 1) {
    const block = blocks[index];
    const text = clean(block?.text);
    if (!text) continue;
    let parts = null;
    if (text.includes('|')) parts = text.split('|');
    else if (text.includes('\t')) parts = text.split('\t');
    else if ((text.match(/;/g) || []).length >= 2) parts = text.split(';');
    if (!parts || parts.length < 2) continue;
    const cells = parts.map((part, column) => ({
      text: clean(part), locator: block.locator || {}, column: column + 1
    })).filter((cell) => cell.text);
    if (cells.length >= 2) rows.push({
      groupKey: 'delimited:text', groupKind: 'delimited', groupName: 'text',
      rowNumber: index + 1, cells, locator: block.locator || {}
    });
  }
  return rows;
}

export function allRows(blocks) {
  return [...structuredRows(blocks), ...delimitedRows(blocks)];
}

export function classifyHeader(text) {
  const value = lower(text);
  if (/^(?:№|n|п\/?п|номер)/u.test(value)) return 'number';
  if (/контрол.*срок|срок\s+(?:исполн|выполн|представлен|сдач)|дедлайн/iu.test(value)) return 'deadline';
  if (/срок|дата|период|время\s+проведен/iu.test(value)) return 'date';
  if (/ответствен|исполнител|куратор/iu.test(value)) return 'responsible';
  if (/результат|форма\s+отчет|отчетн|подтвержден/iu.test(value)) return 'result';
  if (/направлен|раздел|вид\s+деятельност/iu.test(value)) return 'direction';
  if (/мероприят|наименован|содержан|вид\s+работ|задач|работа/iu.test(value)) return 'title';
  return null;
}

function headerMap(row) {
  const mapping = {};
  let score = 0;
  for (let index = 0; index < row.cells.length; index += 1) {
    const field = classifyHeader(row.cells[index].text);
    if (!field || Object.prototype.hasOwnProperty.call(mapping, field)) continue;
    mapping[field] = index;
    score += field === 'title' || field === 'date' || field === 'deadline' ? 2 : 1;
  }
  return { mapping, score };
}

export function bestHeader(rows) {
  let best = null;
  rows.forEach((row, index) => {
    const candidate = headerMap(row);
    const hasSubject = candidate.mapping.title !== undefined;
    const hasTime = candidate.mapping.date !== undefined || candidate.mapping.deadline !== undefined;
    if (!hasSubject || !hasTime || candidate.score < 4) return;
    if (!best || candidate.score > best.score) best = { ...candidate, index, row };
  });
  return best;
}
