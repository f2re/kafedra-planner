import { bodyChildren, replaceBodyChild, replaceTableRows, replaceVisibleText, rowCells, setCellText, tableRows } from './ooxml-shared.mjs';
import { validatePlanTemplateConfig } from './analyzer.mjs';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
const DIRECTIONS = {
  education: 'Образование',
  science: 'Наука',
  everyday: 'Повседневная работа',
  organizational: 'Организационная работа'
};

function isoParts(value) {
  const match = String(value || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatRussianDate(value) {
  const parts = isoParts(value);
  if (!parts) return String(value || '');
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

function formatRange(start, end) {
  const left = isoParts(start);
  const right = isoParts(end);
  if (!left) return '';
  if (!right || start === end) return formatRussianDate(start);
  if (left.year === right.year && left.month === right.month) {
    return `${left.day}–${right.day} ${MONTHS[left.month - 1]} ${left.year}`;
  }
  return `${formatRussianDate(start)} – ${formatRussianDate(end)}`;
}

function parseAcademicKey(value) {
  const match = String(value || '').match(/^\s*(20\d{2})\s*[/–—-]\s*(20\d{2}|\d{2})\s*$/u);
  if (!match) return null;
  const yearStart = Number(match[1]);
  const yearEnd = match[2].length === 2 ? Math.floor(yearStart / 100) * 100 + Number(match[2]) : Number(match[2]);
  if (yearEnd < yearStart || yearEnd > yearStart + 2) return null;
  return { periodKind: 'academic', periodKey: `${yearStart}/${String(yearEnd).slice(-2)}`, yearStart, yearEnd };
}

export function normalizeTargetPeriod(input, expectedKind) {
  const kind = input?.periodKind || expectedKind;
  if (kind !== expectedKind) throw new Error('plan_generation_period_kind_mismatch');
  if (kind === 'academic') {
    const parsed = parseAcademicKey(input?.periodKey);
    const yearStart = Number(input?.yearStart || parsed?.yearStart);
    const yearEnd = Number(input?.yearEnd || parsed?.yearEnd);
    if (!yearStart || !yearEnd || yearEnd < yearStart || yearEnd > yearStart + 2) {
      throw new Error('plan_generation_period_invalid');
    }
    return { periodKind: kind, periodKey: `${yearStart}/${String(yearEnd).slice(-2)}`, yearStart, yearEnd };
  }
  if (kind === 'calendar') {
    const year = Number(input?.yearStart || input?.periodKey);
    if (!Number.isInteger(year) || year < 2000 || year > 2099) throw new Error('plan_generation_period_invalid');
    return { periodKind: kind, periodKey: String(year), yearStart: year, yearEnd: year };
  }
  throw new Error('plan_generation_period_invalid');
}

function itemValues(item, index, columns) {
  const startsAt = item.startsAt || item.starts_at || null;
  const endsAt = item.endsAt || item.ends_at || null;
  const dueDate = item.dueDate || item.due_date || null;
  const responsible = item.responsibleRaw || item.responsible_raw || item.responsible || '';
  const expectedResult = item.expectedResult || item.expected_result || '';
  const values = {
    number: item.itemNo || item.item_no || String(index + 1),
    title: String(item.title || '').trim(),
    description: item.description || '',
    responsible,
    direction: DIRECTIONS[item.direction] || item.direction || '',
    result: expectedResult,
    status: ''
  };
  values.date = item.dateText || (startsAt ? formatRange(startsAt, endsAt) : '');
  if (!values.date && dueDate && !columns.deadline) values.date = `до ${formatRussianDate(dueDate)}`;
  values.deadline = item.deadlineText || (dueDate ? formatRussianDate(dueDate) : '');
  return values;
}

function buildRow(templateXml, config, item, index) {
  const cells = rowCells(templateXml);
  const values = itemValues(item, index, config.columns);
  const byColumn = new Map();
  for (const [field, column] of Object.entries(config.columns)) byColumn.set(Number(column), values[field] ?? '');
  for (const column of config.clearColumns || []) if (!byColumn.has(Number(column))) byColumn.set(Number(column), '');
  let rowXml = templateXml;
  const changes = [];
  for (const [column, value] of byColumn) {
    const cell = cells[column - 1];
    if (!cell) throw new Error('plan_generation_column_invalid');
    changes.push({ start: cell.start, end: cell.end, xml: setCellText(cell.xml, value) });
  }
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    rowXml = rowXml.slice(0, change.start) + change.xml + rowXml.slice(change.end);
  }
  return rowXml;
}

function replacePeriodParagraph(paragraphXml, anchor, target) {
  let result = paragraphXml;
  if (anchor.kind === 'academic') {
    const sourceEnd = String(anchor.sourceYearEnd).slice(-(anchor.endDigits || 4));
    const targetEnd = String(target.yearEnd).slice(-(anchor.endDigits || 4));
    const endChange = replaceVisibleText(result, sourceEnd, targetEnd);
    if (!endChange.changed) throw new Error('plan_generation_period_anchor_changed');
    result = endChange.xml;
  }
  const startChange = replaceVisibleText(result, String(anchor.sourceYearStart), String(target.yearStart));
  if (!startChange.changed) throw new Error('plan_generation_period_anchor_changed');
  return startChange.xml;
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('plan_generation_items_required');
  if (items.length > 5000) throw new Error('plan_generation_items_too_many');
  items.forEach((item) => {
    if (!String(item?.title || '').trim()) throw new Error('plan_generation_item_title_required');
    for (const field of ['startsAt', 'starts_at', 'endsAt', 'ends_at', 'dueDate', 'due_date']) {
      if (item[field] && !isoParts(item[field])) throw new Error('plan_generation_item_date_invalid');
    }
  });
}

export function generatePlanDocumentXml(xml, input) {
  const config = validatePlanTemplateConfig(xml, input.config);
  const targetPeriod = normalizeTargetPeriod(input.targetPeriod, config.periodKind);
  validateItems(input.items);
  const children = bodyChildren(xml);
  const replacements = new Map();

  for (const anchor of config.periodAnchors) {
    const child = children.find((item) => item.tag === 'p' && item.paragraphIndex === Number(anchor.paragraphIndex));
    if (!child) throw new Error('plan_generation_period_anchor_changed');
    const current = replacements.get(child) || child.xml;
    replacements.set(child, replacePeriodParagraph(current, anchor, targetPeriod));
  }

  const table = children.find((item) => item.tag === 'tbl' && item.tableIndex === config.tableIndex);
  if (!table) throw new Error('plan_generation_table_changed');
  const rows = tableRows(table.xml);
  const template = rows[config.templateRow - 1];
  if (!template) throw new Error('plan_generation_template_row_changed');
  const generatedRows = input.items.map((item, index) => buildRow(template.xml, config, item, index));
  replacements.set(table, replaceTableRows(table.xml, config.dataStartRow, config.dataEndRow, generatedRows));

  let output = String(xml || '');
  for (const [child, replacement] of [...replacements.entries()].sort((a, b) => b[0].start - a[0].start)) {
    output = replaceBodyChild(output, child, replacement);
  }
  return { xml: output, config, targetPeriod, itemCount: input.items.length };
}
