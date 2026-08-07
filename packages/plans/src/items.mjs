import { findRussianDates } from '../../protocols/src/russian-date.mjs';
import { clean, clamp, lower, parsePlanDateWindow } from './date.mjs';
import { allRows, bestHeader, classifyHeader } from './rows.mjs';

function directionFor(text) {
  const value = lower(text);
  if (/науч|нир|исследован|конференц|публикац|стат|грант|патент/iu.test(value)) return 'science';
  if (/учеб|образован|занят|экзам|зачет|методич|студент|практик|гиа/iu.test(value)) return 'education';
  if (/хозяйств|бытов|ремонт|инвентар/iu.test(value)) return 'everyday';
  return 'organizational';
}

function cellAt(row, mapping, name) {
  const index = mapping[name];
  return index === undefined ? null : row.cells[index] || null;
}

function sourceKey(row) {
  if (row.groupKind === 'sheet') return `sheet:${row.groupName}:row:${row.rowNumber}`;
  if (row.groupKind === 'table') return `table:${row.groupName}:row:${row.rowNumber}`;
  const loc = row.cells[0]?.locator || row.locator || {};
  if (loc.page) return `pdf:${loc.page}:line:${loc.line || row.rowNumber}`;
  if (loc.line) return `text:line:${loc.line}`;
  return `${row.groupKey}:row:${row.rowNumber}`;
}

function rowLocator(row) {
  const first = row.cells[0]?.locator || row.locator || {};
  return {
    ...first,
    row: row.rowNumber,
    ...(row.groupKind === 'sheet' ? { sheet: row.groupName } : {}),
    ...(row.groupKind === 'table' ? { table: row.groupName } : {})
  };
}

function itemFromRow(row, mapping, period) {
  const numberCell = cellAt(row, mapping, 'number');
  const titleCell = cellAt(row, mapping, 'title');
  const dateCell = cellAt(row, mapping, 'date');
  const deadlineCell = cellAt(row, mapping, 'deadline');
  const responsibleCell = cellAt(row, mapping, 'responsible');
  const directionCell = cellAt(row, mapping, 'direction');
  const resultCell = cellAt(row, mapping, 'result');
  const title = clean(titleCell?.text);
  if (!title || classifyHeader(title) || /^(?:итого|всего)$/iu.test(title)) return null;

  const dateWindow = parsePlanDateWindow(dateCell?.text, period);
  const deadlineWindow = parsePlanDateWindow(deadlineCell?.text, period);
  const genericDeadline = dateCell && /(?:^|\s)до(?:\s|$)/iu.test(dateCell.text) && !deadlineCell;
  const startsAt = genericDeadline ? null : dateWindow.start;
  const endsAt = genericDeadline ? null : dateWindow.end;
  const dueDate = deadlineWindow.end || deadlineWindow.start || (genericDeadline ? (dateWindow.end || dateWindow.start) : null);
  const responsibleRaw = clean(responsibleCell?.text) || null;
  const explicitDirection = clean(directionCell?.text);
  const direction = explicitDirection ? directionFor(explicitDirection) : directionFor(title);
  const itemNo = clean(numberCell?.text) || null;
  const timePresent = Boolean(startsAt || dueDate);
  const fieldCount = [titleCell, dateCell, deadlineCell, responsibleCell, resultCell].filter(Boolean).length;
  const confidence = clamp(0.45 + Math.min(0.25, fieldCount * 0.05) + (timePresent ? 0.2 : 0));
  const evidenceFields = {};
  for (const [name, cell] of Object.entries({
    itemNo: numberCell, title: titleCell, date: dateCell, deadline: deadlineCell,
    responsible: responsibleCell, direction: directionCell, expectedResult: resultCell
  })) {
    if (cell) evidenceFields[name] = { raw: cell.text, locator: cell.locator || rowLocator(row) };
  }
  return {
    sourceItemKey: sourceKey(row), itemNo, title,
    description: null, startsAt, endsAt, dueDate,
    responsibleRaw, direction, expectedResult: clean(resultCell?.text) || null,
    confidence,
    evidence: { locator: rowLocator(row), fields: evidenceFields },
    warnings: timePresent ? [] : ['date_missing']
  };
}

export function extractTableItems(blocks, period) {
  const rows = allRows(blocks);
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.groupKey)) byGroup.set(row.groupKey, []);
    byGroup.get(row.groupKey).push(row);
  }
  const items = [];
  for (const groupRows of byGroup.values()) {
    const header = bestHeader(groupRows);
    if (!header) continue;
    for (const row of groupRows.slice(header.index + 1)) {
      if (bestHeader([row])) continue;
      const item = itemFromRow(row, header.mapping, period);
      if (item) items.push(item);
    }
  }
  return items;
}

export function extractLineItems(blocks, period) {
  const items = [];
  for (let index = 0; index < (blocks || []).length; index += 1) {
    const block = blocks[index];
    const text = clean(block?.text);
    if (text.length < 12 || /(^|[^а-яё])план(?=$|[^а-яё])/iu.test(text)) continue;
    if (classifyHeader(text) && text.length < 80 && findRussianDates(text).length === 0) continue;
    const window = parsePlanDateWindow(text, period);
    if (!window.start) continue;
    const number = text.match(/^\s*(\d+(?:\.\d+)*)[.)]?\s+/u);
    const responsible = text.match(/(?:ответственн(?:ый|ая|ые)?|исполнитель)\s*[:–—-]\s*([^.;]+)/iu);
    let title = text;
    if (number) title = title.slice(number[0].length);
    if (responsible) title = title.replace(responsible[0], '');
    if (window.raw) title = title.replace(window.raw, '');
    title = clean(title.replace(/(?:до|срок)\s*$/iu, '').replace(/[|;,.–—-]+$/u, ''));
    if (!title) continue;
    const isDeadline = /(?:^|\s)до(?:\s|$)|срок\s+(?:исполн|выполн|сдач)/iu.test(text);
    items.push({
      sourceItemKey: block?.locator?.page
        ? `pdf:${block.locator.page}:line:${block.locator.line || index + 1}`
        : `text:line:${block?.locator?.line || index + 1}`,
      itemNo: number?.[1] || null,
      title,
      description: null,
      startsAt: isDeadline ? null : window.start,
      endsAt: isDeadline ? null : window.end,
      dueDate: isDeadline ? (window.end || window.start) : null,
      responsibleRaw: clean(responsible?.[1]) || null,
      direction: directionFor(title), expectedResult: null,
      confidence: 0.68,
      evidence: { locator: block?.locator || { line: index + 1 }, fields: { title: { raw: text, locator: block?.locator || {} } } },
      warnings: []
    });
  }
  return items;
}

export function deduplicateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.sourceItemKey || `${lower(item.title)}|${item.startsAt || item.dueDate || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
