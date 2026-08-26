import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { newId } from '../../core/src/ids.mjs';
import { ensureObjectPolicy } from '../../access-control/src/service.mjs';
import { storeIncomingStream } from '../../document-intake/src/blob-store.mjs';
import { decodeXmlEntities } from '../../document-intake/src/xml-text.mjs';
import {
  DOCUMENT_XML,
  bodyChildren,
  directElements,
  escapeXmlText,
  replaceBodyChild,
  replaceTableRows,
  tableRows
} from '../../plan-docx/src/ooxml-shared.mjs';
import { readZipEntry } from '../../plan-docx/src/archive.mjs';
import { assertDocxTemplate, fail, writeAudit } from './meeting-common.mjs';

const PROFILE_SCHEMA = 1;
const MAX_BINDINGS = 64;
const PROFILE_MEDIA_TYPE = 'application/json';

export const MEETING_TEMPLATE_FIELDS = Object.freeze([
  { key: 'document_kind', label: 'Вид документа', scope: 'document', required: false },
  { key: 'protocol_number', label: 'Номер протокола', scope: 'document', required: true },
  { key: 'meeting_date', label: 'Дата заседания', scope: 'document', required: true },
  { key: 'meeting_title', label: 'Название заседания', scope: 'document', required: true },
  { key: 'chairperson', label: 'Председатель', scope: 'document', required: true },
  { key: 'secretary', label: 'Секретарь', scope: 'document', required: true },
  { key: 'quorum', label: 'Кворум', scope: 'document', required: true },
  { key: 'item_no', label: 'Номер вопроса', scope: 'agenda', required: true },
  { key: 'title', label: 'Вопрос повестки', scope: 'agenda', required: true },
  { key: 'heard', label: 'Слушали', scope: 'agenda', required: true },
  { key: 'discussed', label: 'Обсудили / выступили', scope: 'agenda', required: false },
  { key: 'decision', label: 'Решили', scope: 'agenda', required: true }
]);

const FIELD_BY_KEY = new Map(MEETING_TEMPLATE_FIELDS.map((field) => [field.key, field]));
const REQUIRED_FIELDS = MEETING_TEMPLATE_FIELDS.filter((field) => field.required).map((field) => field.key);
const LEGACY_MARKERS = Object.freeze({
  '{{DOCUMENT_KIND}}': 'document_kind',
  '{{PROTOCOL_NUMBER}}': 'protocol_number',
  '{{MEETING_DATE}}': 'meeting_date',
  '{{MEETING_TITLE}}': 'meeting_title',
  '{{CHAIRPERSON}}': 'chairperson',
  '{{SECRETARY}}': 'secretary',
  '{{QUORUM}}': 'quorum'
});
const AGENDA_MARKERS = Object.freeze({
  '{{ITEM_NO}}': 'item_no',
  '{{AGENDA_TITLE}}': 'title',
  '{{HEARD}}': 'heard',
  '{{DISCUSSED}}': 'discussed',
  '{{DECISION}}': 'decision'
});

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function attribute(xml, name) {
  const match = new RegExp(`\\bw:${name}="([^"]*)"`, 'iu').exec(String(xml || ''));
  return match ? match[1] : null;
}

function integerProperty(xml, tag, name = 'val') {
  const match = new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="(-?\\d+)"[^>]*/?>`, 'iu').exec(String(xml || ''));
  return match ? Number(match[1]) : null;
}

function twipsToPt(value) {
  return Number.isFinite(value) ? Math.round((value / 20) * 100) / 100 : null;
}

function halfPointsToPt(value) {
  return Number.isFinite(value) ? Math.round((value / 2) * 100) / 100 : null;
}

function normalizedColor(value) {
  const text = String(value || '').trim().replace(/^#/u, '');
  return /^[0-9a-f]{6}$/iu.test(text) ? `#${text.toUpperCase()}` : null;
}

function enabledProperty(xml, tag) {
  const match = new RegExp(`<w:${tag}\\b([^>]*)/?>`, 'iu').exec(String(xml || ''));
  if (!match) return false;
  const value = attribute(match[0], 'val');
  return value === null || !['0', 'false', 'off', 'none'].includes(String(value).toLowerCase());
}

function runStyle(runXml) {
  const properties = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/iu.exec(String(runXml || ''))?.[0] || '';
  const family = /<w:rFonts\b[^>]*(?:w:ascii|w:hAnsi|w:cs)="([^"]+)"/iu.exec(properties)?.[1] || null;
  const size = integerProperty(properties, 'sz');
  const color = /<w:color\b[^>]*w:val="([^"]+)"/iu.exec(properties)?.[1] || null;
  const highlight = /<w:highlight\b[^>]*w:val="([^"]+)"/iu.exec(properties)?.[1] || null;
  return {
    bold: enabledProperty(properties, 'b'),
    italic: enabledProperty(properties, 'i'),
    underline: enabledProperty(properties, 'u'),
    strike: enabledProperty(properties, 'strike'),
    fontFamily: family,
    fontSizePt: halfPointsToPt(size),
    color: normalizedColor(color),
    backgroundColor: normalizedColor(highlight)
  };
}

function optionalTwips(xml, name) {
  const value = attribute(xml, name);
  return value === null ? null : twipsToPt(Number(value));
}

function paragraphStyle(paragraphXml) {
  const properties = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/iu.exec(String(paragraphXml || ''))?.[0] || '';
  const alignment = /<w:jc\b[^>]*w:val="([^"]+)"/iu.exec(properties)?.[1] || null;
  const indent = /<w:ind\b[^>]*\/?>/iu.exec(properties)?.[0] || '';
  const spacing = /<w:spacing\b[^>]*\/?>/iu.exec(properties)?.[0] || '';
  const numId = integerProperty(properties, 'numId');
  const level = integerProperty(properties, 'ilvl');
  return {
    alignment: ['left', 'center', 'right', 'both', 'justify'].includes(alignment) ? alignment : null,
    marginLeftPt: optionalTwips(indent, 'left'),
    marginRightPt: optionalTwips(indent, 'right'),
    firstLinePt: optionalTwips(indent, 'firstLine'),
    hangingPt: optionalTwips(indent, 'hanging'),
    spaceBeforePt: optionalTwips(spacing, 'before'),
    spaceAfterPt: optionalTwips(spacing, 'after'),
    linePt: optionalTwips(spacing, 'line'),
    numbering: Number.isInteger(numId) ? { numId, level: Number.isInteger(level) ? level : 0 } : null
  };
}

function visibleTextNodes(xml) {
  const nodes = [];
  for (const match of String(xml || '').matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/giu)) {
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      attrs: match[1] || '',
      text: decodeXmlEntities(match[2] || '')
    });
  }
  return nodes;
}

function exactVisibleText(xml) {
  return visibleTextNodes(xml).map((node) => node.text).join('');
}

export function replaceVisibleRange(xml, startOffset, endOffset, replacement) {
  const source = String(xml || '');
  const nodes = visibleTextNodes(source);
  let cursor = 0;
  for (const node of nodes) {
    node.textStart = cursor;
    cursor += node.text.length;
    node.textEnd = cursor;
  }
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)
    || startOffset < 0 || endOffset <= startOffset || endOffset > cursor) {
    fail('meeting_template_range_invalid');
  }
  const changes = [];
  let inserted = false;
  for (const node of nodes) {
    if (node.textEnd <= startOffset || node.textStart >= endOffset) continue;
    const localStart = Math.max(0, startOffset - node.textStart);
    const localEnd = Math.min(node.text.length, endOffset - node.textStart);
    let value = node.text.slice(0, localStart);
    if (!inserted) {
      value += String(replacement ?? '');
      inserted = true;
    }
    value += node.text.slice(localEnd);
    changes.push({
      start: node.start,
      end: node.end,
      value: `<w:t${node.attrs}>${escapeXmlText(value)}</w:t>`
    });
  }
  if (!inserted) fail('meeting_template_range_invalid');
  let result = source;
  for (const change of changes.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, change.start) + change.value + result.slice(change.end);
  }
  return result;
}

function paragraphProjection(xml, elementId) {
  const runs = [];
  let offset = 0;
  for (const run of directElements(xml, 'r')) {
    const text = exactVisibleText(run.xml);
    if (!text) continue;
    runs.push({ startOffset: offset, endOffset: offset + text.length, text, style: runStyle(run.xml) });
    offset += text.length;
  }
  const text = exactVisibleText(xml);
  if (!runs.length && text) runs.push({ startOffset: 0, endOffset: text.length, text, style: runStyle('') });
  return { elementId, kind: 'paragraph', text, style: paragraphStyle(xml), runs };
}

function cellStyle(cellXml) {
  const properties = /<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/iu.exec(String(cellXml || ''))?.[0] || '';
  const widthValue = /<w:tcW\b[^>]*w:w="(-?\d+)"/iu.exec(properties)?.[1];
  const span = integerProperty(properties, 'gridSpan');
  const merge = /<w:vMerge\b([^>]*)/iu.exec(properties);
  const mergeValue = merge ? attribute(merge[0], 'val') : null;
  const fill = /<w:shd\b[^>]*w:fill="([^"]+)"/iu.exec(properties)?.[1] || null;
  return {
    widthPt: widthValue === undefined ? null : twipsToPt(Number(widthValue)),
    columnSpan: Number.isInteger(span) && span > 1 ? span : 1,
    verticalMerge: merge ? (mergeValue === 'restart' ? 'restart' : 'continue') : null,
    backgroundColor: normalizedColor(fill)
  };
}

function projectDocumentXml(xml) {
  const blocks = [];
  const elements = [];
  for (const child of bodyChildren(xml)) {
    if (child.tag === 'p') {
      const paragraph = paragraphProjection(child.xml, `${DOCUMENT_XML}#body/p:${child.paragraphIndex}`);
      blocks.push(paragraph);
      elements.push(paragraph);
      continue;
    }
    const rows = tableRows(child.xml).map((row, rowIndex) => ({
      rowIndex: rowIndex + 1,
      cells: row.cells.map((cell, cellIndex) => {
        const paragraphs = directElements(cell.xml, 'p').map((paragraph, paragraphIndex) => {
          const projected = paragraphProjection(
            paragraph.xml,
            `${DOCUMENT_XML}#table:${child.tableIndex}/row:${rowIndex + 1}/cell:${cellIndex + 1}/p:${paragraphIndex + 1}`
          );
          elements.push(projected);
          return projected;
        });
        return { cellIndex: cellIndex + 1, ...cellStyle(cell.xml), paragraphs };
      })
    }));
    blocks.push({ kind: 'table', tableIndex: child.tableIndex, rows });
  }
  return { blocks, elements };
}

function capture(element, field, match, captureIndex, confidence, reason) {
  if (!match || !match[captureIndex]) return null;
  const value = match[captureIndex];
  const inside = match[0].lastIndexOf(value);
  const startOffset = Number(match.index || 0) + Math.max(0, inside);
  return {
    field,
    elementId: element.elementId,
    startOffset,
    endOffset: startOffset + value.length,
    expectedText: value,
    confidence,
    reason
  };
}

function suggestions(elements) {
  const candidates = [];
  for (const element of elements) {
    const text = element.text;
    if (!text) continue;
    for (const [marker, field] of Object.entries({ ...LEGACY_MARKERS, ...AGENDA_MARKERS })) {
      const index = text.indexOf(marker);
      if (index >= 0) {
        candidates.push({
          field, elementId: element.elementId, startOffset: index, endOffset: index + marker.length,
          expectedText: marker, confidence: 1, reason: 'Служебный маркер найден в исходном DOCX.'
        });
      }
    }
    const rules = [
      ['protocol_number', /(?:протокол\s*№|№)\s*([\p{L}\p{N}./-]+)/iu, 1, 0.93, 'Номер после подписи протокола.'],
      ['meeting_date', /(?:дата|от)\s*:?\s*([0-3]?\d(?:[.\s-]+)[^\n]{3,36})/iu, 1, 0.86, 'Дата после подписи.'],
      ['chairperson', /председатель\s*:?\s*(.+)$/iu, 1, 0.94, 'Значение после подписи «Председатель».'],
      ['secretary', /секретар[ьия]\s*:?\s*(.+)$/iu, 1, 0.94, 'Значение после подписи «Секретарь».'],
      ['quorum', /кворум\s*:?\s*([\p{L}\p{N}\s-]+)/iu, 1, 0.91, 'Значение после подписи «Кворум».'],
      ['heard', /^\s*слушали\s*:?\s*(.+)$/iu, 1, 0.97, 'Текст раздела «Слушали».'],
      ['discussed', /^\s*(?:обсудили|выступили)\s*:?\s*(.+)$/iu, 1, 0.97, 'Текст раздела обсуждения.'],
      ['decision', /^\s*решили\s*:?\s*(.+)$/iu, 1, 0.97, 'Текст раздела «Решили».']
    ];
    for (const [field, pattern, group, confidence, reason] of rules) {
      const candidate = capture(element, field, pattern.exec(text), group, confidence, reason);
      if (candidate) candidates.push(candidate);
    }
    const agenda = /^\s*(\d+[.)])\s+(.+)$/u.exec(text);
    const number = capture(element, 'item_no', agenda, 1, 0.9, 'Номер в начале вопроса повестки.');
    const title = capture(element, 'title', agenda, 2, 0.88, 'Формулировка после номера вопроса.');
    if (number) candidates.push(number);
    if (title) candidates.push(title);
    if (/заседани[ея]\s+кафедр/iu.test(text) && text.length <= 240) {
      candidates.push({
        field: 'meeting_title', elementId: element.elementId, startOffset: 0, endOffset: text.length,
        expectedText: text, confidence: 0.82, reason: 'Строка похожа на название заседания.'
      });
    }
  }
  const best = new Map();
  for (const candidate of candidates) {
    const current = best.get(candidate.field);
    if (!current || candidate.confidence > current.confidence) best.set(candidate.field, candidate);
  }
  return [...best.values()].sort((left, right) => {
    const a = MEETING_TEMPLATE_FIELDS.findIndex((field) => field.key === left.field);
    const b = MEETING_TEMPLATE_FIELDS.findIndex((field) => field.key === right.field);
    return a - b;
  });
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseLocator(elementId) {
  const body = new RegExp(`^${escapedPattern(DOCUMENT_XML)}#body/p:(\\d+)$`, 'u').exec(elementId);
  if (body) return { kind: 'body_paragraph', paragraphIndex: Number(body[1]) };
  const table = new RegExp(`^${escapedPattern(DOCUMENT_XML)}#table:(\\d+)/row:(\\d+)/cell:(\\d+)/p:(\\d+)$`, 'u').exec(elementId);
  if (table) {
    return {
      kind: 'table_paragraph', tableIndex: Number(table[1]), rowIndex: Number(table[2]),
      cellIndex: Number(table[3]), paragraphIndex: Number(table[4])
    };
  }
  return null;
}

function normalizeBindings(input, analysis) {
  const items = Array.isArray(input) ? input : [];
  if (!items.length) fail('meeting_template_bindings_required');
  if (items.length > MAX_BINDINGS) fail('meeting_template_bindings_too_many');
  const elements = new Map(analysis.elements.map((element) => [element.elementId, element]));
  const fields = new Set();
  const bindings = items.map((raw) => {
    const field = String(raw?.field || '').trim();
    if (!FIELD_BY_KEY.has(field)) fail('meeting_template_field_invalid');
    if (fields.has(field)) fail('meeting_template_field_duplicate');
    fields.add(field);
    const elementId = String(raw?.elementId || '').trim();
    const element = elements.get(elementId);
    if (!element) fail('meeting_template_locator_stale');
    const startOffset = Number(raw?.startOffset);
    const endOffset = Number(raw?.endOffset);
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)
      || startOffset < 0 || endOffset <= startOffset || endOffset > element.text.length) {
      fail('meeting_template_range_invalid');
    }
    const expectedText = element.text.slice(startOffset, endOffset);
    if (raw?.expectedText !== undefined && String(raw.expectedText) !== expectedText) {
      fail('meeting_template_locator_stale');
    }
    return { field, elementId, startOffset, endOffset, expectedText };
  });
  const byElement = new Map();
  for (const binding of bindings) {
    const list = byElement.get(binding.elementId) || [];
    list.push(binding);
    byElement.set(binding.elementId, list);
  }
  for (const list of byElement.values()) {
    list.sort((left, right) => left.startOffset - right.startOffset);
    for (let index = 1; index < list.length; index += 1) {
      if (list[index].startOffset < list[index - 1].endOffset) fail('meeting_template_ranges_overlap');
    }
  }
  return bindings.sort((left, right) => left.field.localeCompare(right.field, 'en'));
}

function inferRepeat(bindings) {
  const agenda = bindings.filter((binding) => FIELD_BY_KEY.get(binding.field)?.scope === 'agenda');
  if (!agenda.length) return null;
  const locators = agenda.map((binding) => parseLocator(binding.elementId));
  if (locators.some((locator) => !locator)) fail('meeting_template_repeat_incompatible');
  if (locators.every((locator) => locator.kind === 'table_paragraph')) {
    const first = locators[0];
    if (!locators.every((locator) => locator.tableIndex === first.tableIndex && locator.rowIndex === first.rowIndex)) {
      fail('meeting_template_repeat_incompatible');
    }
    return { kind: 'table_row', tableIndex: first.tableIndex, rowIndex: first.rowIndex };
  }
  if (locators.every((locator) => locator.kind === 'body_paragraph')) {
    return {
      kind: 'paragraph_range',
      startParagraphIndex: Math.min(...locators.map((locator) => locator.paragraphIndex)),
      endParagraphIndex: Math.max(...locators.map((locator) => locator.paragraphIndex))
    };
  }
  fail('meeting_template_repeat_incompatible');
}

function validateRepeat(repeat, bindings, analysis) {
  const agenda = bindings.filter((binding) => FIELD_BY_KEY.get(binding.field)?.scope === 'agenda');
  if (!agenda.length) return null;
  const value = repeat || inferRepeat(bindings);
  if (!value || !['table_row', 'paragraph_range'].includes(value.kind)) fail('meeting_template_repeat_required');
  const locators = agenda.map((binding) => parseLocator(binding.elementId));
  if (value.kind === 'table_row') {
    const tableIndex = Number(value.tableIndex);
    const rowIndex = Number(value.rowIndex);
    const table = analysis.blocks.find((block) => block.kind === 'table' && block.tableIndex === tableIndex);
    if (!table || !table.rows.some((row) => row.rowIndex === rowIndex)) fail('meeting_template_repeat_invalid');
    if (!locators.every((locator) => locator?.kind === 'table_paragraph'
      && locator.tableIndex === tableIndex && locator.rowIndex === rowIndex)) {
      fail('meeting_template_repeat_incompatible');
    }
    return { kind: 'table_row', tableIndex, rowIndex };
  }
  const startParagraphIndex = Number(value.startParagraphIndex);
  const endParagraphIndex = Number(value.endParagraphIndex);
  if (!Number.isInteger(startParagraphIndex) || !Number.isInteger(endParagraphIndex)
    || startParagraphIndex <= 0 || endParagraphIndex < startParagraphIndex) {
    fail('meeting_template_repeat_invalid');
  }
  if (!locators.every((locator) => locator?.kind === 'body_paragraph'
    && locator.paragraphIndex >= startParagraphIndex && locator.paragraphIndex <= endParagraphIndex)) {
    fail('meeting_template_repeat_incompatible');
  }
  return { kind: 'paragraph_range', startParagraphIndex, endParagraphIndex };
}

function missingFields(bindings) {
  const present = new Set(bindings.map((binding) => binding.field));
  return REQUIRED_FIELDS.filter((field) => !present.has(field));
}

function profilePrefix(templateVersionId, documentKind) {
  return `meeting-template-profile:${templateVersionId}:${documentKind}:`;
}

function profileRows(database, workspaceId, templateVersionId, documentKind) {
  return database.all(`
    SELECT d.id AS profile_document_id, dv.id AS profile_version_id, dv.extracted_text,
      dv.upload_key, dv.uploaded_at
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.document_type = 'meeting_template_profile'
      AND dv.upload_key LIKE ?
    ORDER BY dv.uploaded_at DESC, dv.id DESC
  `, workspaceId, `${profilePrefix(templateVersionId, documentKind)}%`).map((row) => {
    try {
      return { ...JSON.parse(row.extracted_text || '{}'), ...row };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function listMeetingTemplateProfiles(database, workspaceId, templateVersionId, documentKind) {
  if (!['protocol', 'extract'].includes(documentKind)) fail('meeting_template_kind_invalid');
  return profileRows(database, workspaceId, templateVersionId, documentKind);
}

export function latestMeetingTemplateProfile(database, workspaceId, templateVersionId, documentKind, readyOnly = false) {
  return listMeetingTemplateProfiles(database, workspaceId, templateVersionId, documentKind)
    .find((profile) => !readyOnly || profile.status === 'ready') || null;
}

export function meetingTemplateProfileByVersion(database, workspaceId, profileVersionId) {
  if (!profileVersionId) return null;
  const row = database.get(`
    SELECT d.id AS profile_document_id, dv.id AS profile_version_id, dv.extracted_text,
      dv.upload_key, dv.uploaded_at
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.document_type = 'meeting_template_profile' AND dv.id = ?
  `, workspaceId, profileVersionId);
  if (!row) return null;
  try {
    return { ...JSON.parse(row.extracted_text || '{}'), ...row };
  } catch {
    return null;
  }
}

export async function analyzeMeetingTemplatePath(path, sourceSha256 = null) {
  const xml = (await readZipEntry(path, DOCUMENT_XML)).toString('utf8');
  const projection = projectDocumentXml(xml);
  const visible = projection.elements.map((element) => element.text).filter(Boolean).join('\n');
  const legacyMarkers = [...Object.keys(LEGACY_MARKERS), '{{AGENDA}}']
    .filter((marker) => visible.includes(marker));
  return {
    schema: PROFILE_SCHEMA,
    sourceSha256,
    structureSha256: hash(xml),
    text: visible,
    legacyMarkers,
    legacyReady: legacyMarkers.includes('{{AGENDA}}'),
    fields: MEETING_TEMPLATE_FIELDS,
    suggestions: suggestions(projection.elements),
    ...projection
  };
}

export async function analyzeMeetingTemplate(database, workspaceId, templateVersionId, documentKind) {
  if (!['protocol', 'extract'].includes(documentKind)) fail('meeting_template_kind_invalid');
  const template = assertDocxTemplate(database, workspaceId, templateVersionId);
  const analysis = await analyzeMeetingTemplatePath(template.storage_path, template.blob_sha256);
  const profiles = listMeetingTemplateProfiles(database, workspaceId, templateVersionId, documentKind);
  return { ...analysis, templateVersionId, documentKind, profiles, latestProfile: profiles[0] || null };
}

export async function saveMeetingTemplateProfile(database, config, workspaceId, templateVersionId, documentKind, input, actorPersonId = null) {
  const analysis = await analyzeMeetingTemplate(database, workspaceId, templateVersionId, documentKind);
  if (input?.structureSha256 && String(input.structureSha256) !== analysis.structureSha256) {
    fail('meeting_template_structure_changed');
  }
  const bindings = normalizeBindings(input?.bindings, analysis);
  const repeat = validateRepeat(input?.repeat || null, bindings, analysis);
  const missing = missingFields(bindings);
  const canonical = {
    schema: PROFILE_SCHEMA,
    templateVersionId,
    documentKind,
    sourceSha256: analysis.sourceSha256,
    structureSha256: analysis.structureSha256,
    bindings,
    repeat,
    status: missing.length ? 'draft' : 'ready',
    missingFields: missing
  };
  const profileSha256 = hash(stableJson(canonical));
  const uploadKey = `${profilePrefix(templateVersionId, documentKind)}${profileSha256}`;
  const existing = database.get(`
    SELECT dv.id AS profile_version_id
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND d.document_type = 'meeting_template_profile' AND dv.upload_key = ?
  `, workspaceId, uploadKey);
  if (existing) {
    return { ...meetingTemplateProfileByVersion(database, workspaceId, existing.profile_version_id), duplicateRequest: true };
  }
  const previous = listMeetingTemplateProfiles(database, workspaceId, templateVersionId, documentKind);
  const revision = Math.max(0, ...previous.map((profile) => Number(profile.revision) || 0)) + 1;
  const now = new Date().toISOString();
  const payload = { ...canonical, profileSha256, revision, createdAt: now, createdByPersonId: actorPersonId };
  const serialized = JSON.stringify(payload);
  const blob = await storeIncomingStream(Readable.from([Buffer.from(serialized, 'utf8')]), {
    blobDir: config.blobDir,
    tempDir: config.tempDir,
    maxBytes: Math.min(Number(config.maxUploadBytes) || 2 * 1024 * 1024, 2 * 1024 * 1024),
    mediaType: PROFILE_MEDIA_TYPE
  });
  const documentId = newId('doc');
  const versionId = newId('docv');
  const title = `${documentKind === 'protocol' ? 'Профиль шаблона протокола' : 'Профиль шаблона выписки'} · редакция ${revision}`;
  database.transaction(() => {
    database.run(`
      INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, blob.sha256, blob.sizeBytes, blob.mediaType, blob.storagePath, now);
    database.run(`
      INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, 'meeting_template_profile', 'processed', ?, ?, ?)
    `, documentId, workspaceId, title, versionId, now, now);
    database.run(`
      INSERT INTO document_versions(
        id, document_id, version_no, blob_sha256, original_name, media_type, detected_format,
        processing_status, extracted_text, extraction_error, upload_key, uploaded_at,
        structure_status, ocr_status, preview_status
      ) VALUES (?, ?, 1, ?, ?, ?, 'json', 'processed', ?, NULL, ?, ?, 'template_profile', 'not_needed', 'not_needed')
    `, versionId, documentId, blob.sha256, `${title}.json`, PROFILE_MEDIA_TYPE, serialized, uploadKey, now);
    ensureObjectPolicy(database, {
      workspaceId, objectKind: 'document', objectId: documentId,
      ownerPersonId: actorPersonId, accessScope: 'workspace', now
    });
    writeAudit(database, workspaceId, actorPersonId, 'meeting.template_profile.created', 'document', documentId, {
      templateVersionId, documentKind, profileVersionId: versionId, profileSha256,
      revision, status: payload.status, missingFields: payload.missingFields
    }, now);
  });
  return {
    ...payload,
    profile_document_id: documentId,
    profile_version_id: versionId,
    uploaded_at: now,
    duplicateRequest: false
  };
}

function locateBodyParagraph(xml, paragraphIndex) {
  return bodyChildren(xml).find((child) => child.tag === 'p' && child.paragraphIndex === paragraphIndex) || null;
}

function locateTable(xml, tableIndex) {
  return bodyChildren(xml).find((child) => child.tag === 'tbl' && child.tableIndex === tableIndex) || null;
}

function replaceElementInDocument(xml, elementId, transform) {
  const locator = parseLocator(elementId);
  if (!locator) fail('meeting_template_locator_stale');
  if (locator.kind === 'body_paragraph') {
    const paragraph = locateBodyParagraph(xml, locator.paragraphIndex);
    if (!paragraph) fail('meeting_template_locator_stale');
    return replaceBodyChild(xml, paragraph, transform(paragraph.xml));
  }
  const table = locateTable(xml, locator.tableIndex);
  if (!table) fail('meeting_template_locator_stale');
  const rows = tableRows(table.xml);
  const row = rows[locator.rowIndex - 1];
  const cell = row?.cells?.[locator.cellIndex - 1];
  const paragraph = cell ? directElements(cell.xml, 'p')[locator.paragraphIndex - 1] : null;
  if (!row || !cell || !paragraph) fail('meeting_template_locator_stale');
  const cellXml = cell.xml.slice(0, paragraph.start) + transform(paragraph.xml) + cell.xml.slice(paragraph.end);
  const rowXml = row.xml.slice(0, cell.start) + cellXml + row.xml.slice(cell.end);
  const tableXml = table.xml.slice(0, row.start) + rowXml + table.xml.slice(row.end);
  return replaceBodyChild(xml, table, tableXml);
}

function applyRanges(elementXml, bindings, values) {
  let result = elementXml;
  for (const binding of [...bindings].sort((left, right) => right.startOffset - left.startOffset)) {
    result = replaceVisibleRange(result, binding.startOffset, binding.endOffset, values[binding.field] ?? '');
  }
  return result;
}

function applyDocumentBindings(xml, bindings, values) {
  const grouped = new Map();
  for (const binding of bindings) {
    const list = grouped.get(binding.elementId) || [];
    list.push(binding);
    grouped.set(binding.elementId, list);
  }
  let result = xml;
  for (const [elementId, group] of grouped) {
    result = replaceElementInDocument(result, elementId, (elementXml) => applyRanges(elementXml, group, values));
  }
  return result;
}

function applyRowBindings(rowXml, bindings, values) {
  const grouped = new Map();
  for (const binding of bindings) {
    const locator = parseLocator(binding.elementId);
    const key = `${locator.cellIndex}:${locator.paragraphIndex}`;
    const list = grouped.get(key) || [];
    list.push(binding);
    grouped.set(key, list);
  }
  let result = rowXml;
  for (const [key, group] of grouped) {
    const [cellIndex, paragraphIndex] = key.split(':').map(Number);
    const cell = directElements(result, 'tc')[cellIndex - 1];
    const paragraph = cell ? directElements(cell.xml, 'p')[paragraphIndex - 1] : null;
    if (!cell || !paragraph) fail('meeting_template_locator_stale');
    const cellXml = cell.xml.slice(0, paragraph.start)
      + applyRanges(paragraph.xml, group, values)
      + cell.xml.slice(paragraph.end);
    result = result.slice(0, cell.start) + cellXml + result.slice(cell.end);
  }
  return result;
}

function renderParagraphBlock(xml, repeat, bindings, items) {
  const paragraphs = bodyChildren(xml).filter((child) => child.tag === 'p');
  const first = paragraphs[repeat.startParagraphIndex - 1];
  const last = paragraphs[repeat.endParagraphIndex - 1];
  if (!first || !last) fail('meeting_template_repeat_invalid');
  const rendered = [];
  for (const values of items) {
    for (let paragraphIndex = repeat.startParagraphIndex; paragraphIndex <= repeat.endParagraphIndex; paragraphIndex += 1) {
      const source = paragraphs[paragraphIndex - 1];
      const group = bindings.filter((binding) => parseLocator(binding.elementId)?.paragraphIndex === paragraphIndex);
      rendered.push(applyRanges(source.xml, group, values));
    }
  }
  return xml.slice(0, first.start) + rendered.join('') + xml.slice(last.end);
}

function renderTableRowBlock(xml, repeat, bindings, items) {
  const table = locateTable(xml, repeat.tableIndex);
  if (!table) fail('meeting_template_repeat_invalid');
  const rows = tableRows(table.xml);
  const prototype = rows[repeat.rowIndex - 1];
  if (!prototype) fail('meeting_template_repeat_invalid');
  const renderedRows = items.map((values) => applyRowBindings(prototype.xml, bindings, values));
  const tableXml = replaceTableRows(table.xml, repeat.rowIndex, repeat.rowIndex, renderedRows);
  return replaceBodyChild(xml, table, tableXml);
}

export function renderVisualMeetingTemplateXml(templateXml, profile, globalValues, agendaValues) {
  if (!profile || profile.status !== 'ready') fail('meeting_template_profile_incomplete');
  const bindings = Array.isArray(profile.bindings) ? profile.bindings : [];
  const documentBindings = bindings.filter((binding) => FIELD_BY_KEY.get(binding.field)?.scope === 'document');
  const agendaBindings = bindings.filter((binding) => FIELD_BY_KEY.get(binding.field)?.scope === 'agenda');
  let xml = applyDocumentBindings(String(templateXml || ''), documentBindings, globalValues || {});
  if (!Array.isArray(agendaValues) || !agendaValues.length) fail('meeting_agenda_empty');
  if (profile.repeat?.kind === 'table_row') {
    xml = renderTableRowBlock(xml, profile.repeat, agendaBindings, agendaValues);
  } else if (profile.repeat?.kind === 'paragraph_range') {
    xml = renderParagraphBlock(xml, profile.repeat, agendaBindings, agendaValues);
  } else {
    fail('meeting_template_repeat_required');
  }
  return xml;
}
