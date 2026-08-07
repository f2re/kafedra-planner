import { classifyHeader } from '../../plans/src/rows.mjs';
import { bodyChildren, tableRows, wordVisibleText } from './ooxml-shared.mjs';

const PLAN_KINDS = new Set(['department', 'faculty', 'personal', 'unit', 'organization']);
const PERIOD_KINDS = new Set(['academic', 'calendar']);

function normalize(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

function parseAcademicEnd(start, rawEnd) {
  if (String(rawEnd).length === 2) return Math.floor(start / 100) * 100 + Number(rawEnd);
  return Number(rawEnd);
}

function anchorScore(text) {
  const value = normalize(text);
  let score = 0;
  if (/план/u.test(value)) score += 2;
  if (/учебн/u.test(value)) score += 3;
  if (/календарн/u.test(value)) score += 2;
  if (/год/u.test(value)) score += 2;
  if (/кафедр|факультет|подразделен|сотрудник|преподавател/u.test(value)) score += 1;
  return score;
}

function periodCandidates(children) {
  const result = [];
  for (const child of children.filter((item) => item.tag === 'p')) {
    const text = wordVisibleText(child.xml);
    if (!text) continue;
    const score = anchorScore(text);
    for (const match of text.matchAll(/\b(20\d{2})\s*([/–—-])\s*(20\d{2}|\d{2})\b/gu)) {
      const yearStart = Number(match[1]);
      const yearEnd = parseAcademicEnd(yearStart, match[3]);
      if (yearEnd < yearStart || yearEnd > yearStart + 2) continue;
      result.push({
        kind: 'academic', paragraphIndex: child.paragraphIndex, text,
        yearStart, yearEnd, endDigits: match[3].length, score: score + 4,
        raw: match[0]
      });
    }
    if (/\b20\d{2}\s*[/–—-]\s*(?:20\d{2}|\d{2})\b/u.test(text)) continue;
    if (score < 2) continue;
    for (const match of text.matchAll(/\b(20\d{2})\b/gu)) {
      result.push({
        kind: 'calendar', paragraphIndex: child.paragraphIndex, text,
        yearStart: Number(match[1]), yearEnd: Number(match[1]), endDigits: 4,
        score: score + 1, raw: match[0]
      });
    }
  }
  return result.sort((a, b) => b.score - a.score || a.paragraphIndex - b.paragraphIndex);
}

function choosePeriod(candidates) {
  if (!candidates.length) return { selected: null, anchors: [], ambiguous: false };
  const best = candidates[0];
  const top = candidates.filter((item) => item.score === best.score);
  const values = new Set(top.map((item) => `${item.kind}:${item.yearStart}:${item.yearEnd}`));
  const ambiguous = values.size > 1;
  if (ambiguous) return { selected: null, anchors: [], ambiguous: true };
  const anchors = candidates.filter((item) =>
    item.kind === best.kind && item.yearStart === best.yearStart && item.yearEnd === best.yearEnd && item.score >= Math.max(2, best.score - 2)
  ).map((item) => ({
    paragraphIndex: item.paragraphIndex,
    kind: item.kind,
    sourceYearStart: item.yearStart,
    sourceYearEnd: item.yearEnd,
    endDigits: item.endDigits,
    raw: item.raw,
    text: item.text
  }));
  return { selected: best, anchors, ambiguous: false };
}

function extendedHeader(text) {
  const standard = classifyHeader(text);
  if (standard) return standard;
  const value = normalize(text);
  if (/примечан|комментар|описан/u.test(value)) return 'description';
  if (/отметк.*выполн|факт.*выполн|выполнено|статус/u.test(value)) return 'status';
  return null;
}

function classifyRow(row) {
  const columns = {};
  const unknownColumns = [];
  let score = 0;
  row.cells.forEach((cell, index) => {
    if (!cell.text) return;
    const field = extendedHeader(cell.text);
    if (!field) {
      unknownColumns.push({ column: index + 1, label: cell.text });
      return;
    }
    if (columns[field]) return;
    columns[field] = index + 1;
    score += ['title', 'date', 'deadline'].includes(field) ? 3 : 1;
  });
  const valid = Boolean(columns.title && (columns.date || columns.deadline));
  return { columns, unknownColumns, score, valid };
}

function footerRow(row) {
  const value = normalize(row.text);
  return /^(?:итого|всего|примечан|подпись|заведующ|утвержда)/u.test(value);
}

function tableCandidate(tableChild) {
  const rows = tableRows(tableChild.xml);
  let header = null;
  rows.forEach((row, index) => {
    const classified = classifyRow(row);
    if (!classified.valid) return;
    const candidate = { ...classified, row: index + 1, cellCount: row.cellCount, complex: row.complex };
    if (!header || candidate.score > header.score) header = candidate;
  });
  if (!header) return null;
  let templateRow = null;
  for (let index = header.row; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.cellCount !== header.cellCount || row.complex || footerRow(row)) continue;
    templateRow = index + 1;
    break;
  }
  let dataEndRow = templateRow;
  if (templateRow) {
    for (let index = templateRow; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.cellCount !== header.cellCount || row.complex || footerRow(row)) break;
      dataEndRow = index + 1;
    }
  }
  const issues = [];
  if (header.complex) issues.push('complex_header');
  if (!templateRow) issues.push('template_row_missing');
  if (header.unknownColumns.length) issues.push('unmapped_columns');
  const score = header.score + Object.keys(header.columns).length + (templateRow ? 3 : 0) - issues.length * 2;
  return {
    tableIndex: tableChild.tableIndex,
    headerRow: header.row,
    templateRow,
    dataStartRow: templateRow,
    dataEndRow,
    columns: header.columns,
    unknownColumns: header.unknownColumns,
    clearColumns: header.unknownColumns.map((item) => item.column),
    rowCount: rows.length,
    columnCount: header.cellCount,
    score,
    issues,
    preview: rows.slice(Math.max(0, header.row - 1), Math.min(rows.length, header.row + 3)).map((row, offset) => ({
      row: header.row + offset,
      cells: row.cells.map((cell) => cell.text)
    }))
  };
}

function chooseTable(candidates) {
  if (!candidates.length) return { selected: null, ambiguous: false };
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.tableIndex - b.tableIndex);
  const best = sorted[0];
  const competing = sorted.filter((item) => item.score === best.score);
  return { selected: competing.length === 1 ? best : null, ambiguous: competing.length > 1, sorted };
}

function normalizePlanKind(value) {
  return PLAN_KINDS.has(value) ? value : 'organization';
}

export function analyzePlanDocumentXml(xml, { planKind = 'organization' } = {}) {
  const children = bodyChildren(xml);
  const periods = periodCandidates(children);
  const period = choosePeriod(periods);
  const tableCandidates = children.filter((item) => item.tag === 'tbl')
    .map(tableCandidate).filter(Boolean);
  const table = chooseTable(tableCandidates);
  const issues = [];
  if (!period.selected) issues.push(period.ambiguous ? 'period_ambiguous' : 'period_missing');
  if (!table.selected) issues.push(table.ambiguous ? 'table_ambiguous' : 'table_missing');
  if (table.selected?.issues.length) issues.push(...table.selected.issues);
  const suggestedConfig = table.selected ? {
    planKind: normalizePlanKind(planKind),
    periodKind: period.selected?.kind || 'unknown',
    periodAnchors: period.anchors,
    tableIndex: table.selected.tableIndex,
    headerRow: table.selected.headerRow,
    templateRow: table.selected.templateRow,
    dataStartRow: table.selected.dataStartRow,
    dataEndRow: table.selected.dataEndRow,
    columns: table.selected.columns,
    clearColumns: table.selected.clearColumns,
    allowUnmappedColumns: false
  } : null;
  return {
    ready: issues.length === 0,
    planKind: normalizePlanKind(planKind),
    detectedPeriod: period.selected ? {
      kind: period.selected.kind,
      yearStart: period.selected.yearStart,
      yearEnd: period.selected.yearEnd
    } : null,
    periodCandidates: periods,
    tableCandidates: table.sorted || [],
    suggestedConfig,
    issues
  };
}

export function validatePlanTemplateConfig(xml, input) {
  const config = { ...input, columns: { ...(input?.columns || {}) } };
  if (!PLAN_KINDS.has(config.planKind)) throw new Error('plan_template_kind_invalid');
  if (!PERIOD_KINDS.has(config.periodKind)) throw new Error('plan_template_period_kind_invalid');
  const children = bodyChildren(xml);
  const table = children.find((item) => item.tag === 'tbl' && item.tableIndex === Number(config.tableIndex));
  if (!table) throw new Error('plan_template_table_invalid');
  const rows = tableRows(table.xml);
  const header = rows[Number(config.headerRow) - 1];
  const template = rows[Number(config.templateRow) - 1];
  const start = rows[Number(config.dataStartRow) - 1];
  const end = rows[Number(config.dataEndRow) - 1];
  if (!header || !template || !start || !end || Number(config.dataStartRow) > Number(config.dataEndRow)) {
    throw new Error('plan_template_rows_invalid');
  }
  if (template.complex) throw new Error('plan_template_row_complex');
  const columns = Object.entries(config.columns);
  if (!config.columns.title || (!config.columns.date && !config.columns.deadline)) {
    throw new Error('plan_template_columns_required');
  }
  for (const [, column] of columns) {
    const value = Number(column);
    if (!Number.isInteger(value) || value < 1 || value > template.cellCount) throw new Error('plan_template_column_invalid');
  }
  const clearColumns = [...new Set((config.clearColumns || []).map(Number))];
  if (clearColumns.some((column) => !Number.isInteger(column) || column < 1 || column > template.cellCount)) {
    throw new Error('plan_template_clear_column_invalid');
  }
  const analysis = analyzePlanDocumentXml(xml, { planKind: config.planKind });
  const candidate = analysis.tableCandidates.find((item) => item.tableIndex === Number(config.tableIndex));
  if (candidate?.unknownColumns.length && !config.allowUnmappedColumns) throw new Error('plan_template_unmapped_columns');
  const anchors = Array.isArray(config.periodAnchors) ? config.periodAnchors : [];
  if (!anchors.length) throw new Error('plan_template_period_anchor_required');
  for (const anchor of anchors) {
    const paragraph = children.find((item) => item.tag === 'p' && item.paragraphIndex === Number(anchor.paragraphIndex));
    if (!paragraph) throw new Error('plan_template_period_anchor_invalid');
    const text = wordVisibleText(paragraph.xml);
    if (!text.includes(String(anchor.sourceYearStart))) throw new Error('plan_template_period_anchor_invalid');
    if (anchor.kind === 'academic' && !text.includes(String(anchor.sourceYearEnd).slice(-(anchor.endDigits || 4)))) {
      throw new Error('plan_template_period_anchor_invalid');
    }
  }
  return {
    ...config,
    tableIndex: Number(config.tableIndex),
    headerRow: Number(config.headerRow),
    templateRow: Number(config.templateRow),
    dataStartRow: Number(config.dataStartRow),
    dataEndRow: Number(config.dataEndRow),
    clearColumns,
    periodAnchors: anchors,
    allowUnmappedColumns: Boolean(config.allowUnmappedColumns)
  };
}
