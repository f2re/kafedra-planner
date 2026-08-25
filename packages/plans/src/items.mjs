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
  const column = mapping[name];
  return column === undefined ? null : row.cells.find((cell) => cell.column === column) || null;
}

export function sourceKeyForRow(row) {
  if (row.groupKind === 'sheet') return `sheet:${row.groupName}:row:${row.rowNumber}`;
  if (row.groupKind === 'table') return `table:${row.groupName}:row:${row.rowNumber}`;
  const loc = row.cells[0]?.locator || row.locator || {};
  if (loc.page) return `pdf:${loc.page}:line:${loc.line || row.rowNumber}`;
  if (loc.line) return `text:line:${loc.line}`;
  return `${row.groupKey}:row:${row.rowNumber}`;
}

export function rowLocatorForRow(row) {
  const first = row.cells[0]?.locator || row.locator || {};
  return {
    ...first,
    row: row.rowNumber,
    ...(row.groupKind === 'sheet' ? { sheet: row.groupName } : {}),
    ...(row.groupKind === 'table' ? { table: row.groupName } : {})
  };
}

function repeatedHeaderTitle(title, cells) {
  if (!classifyHeader(title)) return false;
  const companions = cells.filter(Boolean);
  return companions.length === 0 || companions.every((cell) => Boolean(classifyHeader(cell.text)));
}

function itemFromRow(row, mapping, period) {
  const numberCell = cellAt(row, mapping, 'number');
  const titleCell = cellAt(row, mapping, 'title');
  const descriptionCell = cellAt(row, mapping, 'description');
  const dateCell = cellAt(row, mapping, 'date');
  const deadlineCell = cellAt(row, mapping, 'deadline');
  const responsibleCell = cellAt(row, mapping, 'responsible');
  const directionCell = cellAt(row, mapping, 'direction');
  const resultCell = cellAt(row, mapping, 'result');
  const statusCell = cellAt(row, mapping, 'status');
  const title = clean(titleCell?.text);
  if (!title || repeatedHeaderTitle(title, [dateCell, deadlineCell, responsibleCell, resultCell]) || /^(?:итого|всего)$/iu.test(title)) return null;

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
  const fieldCount = [titleCell, descriptionCell, dateCell, deadlineCell, responsibleCell, resultCell].filter(Boolean).length;
  const confidence = clamp(0.45 + Math.min(0.25, fieldCount * 0.05) + (timePresent ? 0.2 : 0));
  const evidenceFields = {};
  for (const [name, cell] of Object.entries({
    itemNo: numberCell, title: titleCell, description: descriptionCell, date: dateCell,
    deadline: deadlineCell, responsible: responsibleCell, direction: directionCell,
    expectedResult: resultCell, sourceStatus: statusCell
  })) {
    if (cell) evidenceFields[name] = { raw: cell.text, locator: cell.locator || rowLocatorForRow(row) };
  }
  return {
    sourceItemKey: sourceKeyForRow(row), itemNo, title,
    description: clean(descriptionCell?.text) || null, startsAt, endsAt, dueDate,
    responsibleRaw, direction, expectedResult: clean(resultCell?.text) || null,
    confidence,
    evidence: { locator: rowLocatorForRow(row), fields: evidenceFields },
    warnings: timePresent ? [] : ['date_missing']
  };
}

function rowRole(row, header, rowIndex) {
  if (header && rowIndex === header.index) return 'header';
  if (bestHeader([row])) return 'header';
  return 'context';
}

export function extractPlanSourceRows(blocks, period) {
  const rows = allRows(blocks);
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.groupKey)) byGroup.set(row.groupKey, []);
    byGroup.get(row.groupKey).push(row);
  }

  const result = [];
  for (const groupRows of byGroup.values()) {
    const header = bestHeader(groupRows);
    const mappedColumns = new Set(Object.values(header?.mapping || {}));
    const headerLabels = new Map((header?.row?.cells || []).map((cell) => [cell.column, cell.text]));
    groupRows.forEach((row, index) => {
      if (!row.cells.length) return;
      let role = rowRole(row, header, index);
      let suggestion = null;
      if (header && index > header.index && role !== 'header') {
        suggestion = itemFromRow(row, header.mapping, period);
        if (suggestion) role = 'item';
      }
      const unmapped = role === 'header' ? [] : row.cells
        .filter((cell) => !mappedColumns.has(cell.column))
        .map((cell) => ({
          text: cell.text, column: cell.column, label: headerLabels.get(cell.column) || null, locator: cell.locator || {}
        }));
      result.push({
        sourceRowKey: sourceKeyForRow(row),
        groupKind: row.groupKind,
        groupName: row.groupName,
        rowNumber: row.rowNumber,
        role,
        rawText: row.cells.map((cell) => cell.text).filter(Boolean).join(' | '),
        cells: row.cells.map((cell) => ({
          text: cell.text, column: cell.column, label: headerLabels.get(cell.column) || null, locator: cell.locator || {}
        })),
        locator: rowLocatorForRow(row),
        suggestion,
        unmapped,
        confidence: suggestion?.confidence ?? (role === 'header' ? 1 : 0.25)
      });
    });
  }
  return result;
}

export function extractTableItems(blocks, period) {
  return extractPlanSourceRows(blocks, period)
    .filter((row) => row.role === 'item' && row.suggestion)
    .map((row) => row.suggestion);
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

export function sourceRowsForLineItems(items) {
  return (items || []).map((item, index) => ({
    sourceRowKey: item.sourceItemKey,
    groupKind: 'line',
    groupName: 'text',
    rowNumber: Number(item.evidence?.locator?.line || index + 1),
    role: 'item',
    rawText: item.evidence?.fields?.title?.raw || item.title,
    cells: [{ text: item.evidence?.fields?.title?.raw || item.title, column: 1, locator: item.evidence?.locator || {} }],
    locator: item.evidence?.locator || { line: index + 1 },
    suggestion: item,
    unmapped: [],
    confidence: item.confidence || 0
  }));
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
