import { findRussianDates } from '../../protocols/src/russian-date.mjs';
import { clean, clamp, extractPlanPeriod, lower } from './date.mjs';
export { parsePlanDateWindow } from './date.mjs';
import { allRows, bestHeader } from './rows.mjs';
import {
  deduplicateItems, extractLineItems, extractPlanSourceRows, sourceRowsForLineItems
} from './items.mjs';

const REQUESTED_KINDS = new Map([
  ['department_plan', 'department'],
  ['faculty_plan', 'faculty'],
  ['personal_plan', 'personal'],
  ['unit_plan', 'unit'],
  ['organization_plan', 'organization']
]);

function requestedKind(requestedType) {
  if (REQUESTED_KINDS.has(requestedType)) return { kind: REQUESTED_KINDS.get(requestedType), confidence: 1, forced: true };
  return null;
}

function inferPlanKind(source, requestedType) {
  const forced = requestedKind(requestedType);
  if (forced) return forced;
  const value = lower(source);
  if (/индивидуальн\w*\s+план|личн\w*\s+план|план\s+работы\s+(?:преподавателя|сотрудника)/iu.test(value)) {
    return { kind: 'personal', confidence: 0.94, forced: false };
  }
  if (/план[^\n]{0,100}факультет|факультет[^\n]{0,100}план/iu.test(value)) return { kind: 'faculty', confidence: 0.93, forced: false };
  if (/план[^\n]{0,100}кафедр|кафедр[^\n]{0,100}план/iu.test(value)) return { kind: 'department', confidence: 0.96, forced: false };
  if (/план[^\n]{0,100}подразделен|подразделен[^\n]{0,100}план/iu.test(value)) return { kind: 'unit', confidence: 0.86, forced: false };
  if (/план\s+(?:работы|мероприятий|деятельности)/iu.test(value)) return { kind: 'organization', confidence: 0.65, forced: false };
  if (requestedType === 'plan') return { kind: 'organization', confidence: 0.55, forced: true };
  return { kind: 'organization', confidence: 0.35, forced: false };
}

function ownerFromText(source) {
  const match = String(source || '').match(/(?:Ф\.?И\.?О\.?|сотрудник|преподаватель|владелец\s+плана)\s*[:–—-]\s*([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2})/u);
  return match ? { raw: clean(match[1]), evidence: { raw: match[0], source: 'document_text' } } : { raw: null, evidence: null };
}

export function looksLikePlan(text, blocks = [], title = '') {
  const source = clean(`${title}\n${text}`);
  if (!/(^|[^а-яё])план(?:а|е|ом|у)?(?=$|[^а-яё])/iu.test(source)) return false;
  const rows = allRows(blocks);
  if (bestHeader(rows)) return true;
  const strongHeading = /план\s+(?:работы|мероприятий|деятельности|основных\s+мероприятий)/iu.test(source);
  return strongHeading && (findRussianDates(source).length >= 2 || /(?:срок|дата|ответствен)/iu.test(source));
}

export function extractPlan({ text = '', blocks = [], title = '', requestedType = 'auto' } = {}) {
  const source = clean(`${title}\n${text}`);
  const kind = inferPlanKind(source, requestedType);
  const period = extractPlanPeriod(text, title);
  const owner = kind.kind === 'personal' ? ownerFromText(source) : { raw: null, evidence: null };
  let sourceRows = extractPlanSourceRows(blocks, period);
  let items = sourceRows.filter((row) => row.role === 'item' && row.suggestion).map((row) => row.suggestion);
  if (!items.length) {
    items = extractLineItems(blocks, period);
    if (!sourceRows.length) sourceRows = sourceRowsForLineItems(items);
  }
  items = deduplicateItems(items);

  const warnings = [];
  if (!items.length) warnings.push('items_missing');
  if (items.some((item) => item.warnings.includes('date_missing'))) warnings.push('items_without_date');
  if (period.kind === 'unknown' || period.confidence < 0.6) warnings.push('period_uncertain');
  if (kind.confidence < 0.6) warnings.push('kind_uncertain');
  if (kind.kind === 'personal' && !owner.raw) warnings.push('owner_missing');

  const itemConfidence = items.length
    ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
    : 0;
  const confidence = clamp(kind.confidence * 0.25 + period.confidence * 0.25 + itemConfidence * 0.5);
  return {
    kind: kind.kind,
    documentType: `${kind.kind}_plan`,
    title: clean(title) || 'План',
    periodKind: period.kind,
    periodKey: period.key,
    yearStart: period.yearStart,
    yearEnd: period.yearEnd,
    ownerRaw: owner.raw,
    confidence,
    evidence: {
      kind: { source: 'document_text', confidence: kind.confidence, forced: kind.forced },
      period: period.evidence,
      owner: owner.evidence
    },
    items,
    sourceRows,
    warnings,
    requiresReview: warnings.length > 0
  };
}
