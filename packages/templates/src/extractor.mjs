import { firstRussianDate } from '../../protocols/src/russian-date.mjs';

export function textLines(text) {
  return String(text || '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((text, index) => ({ number: index + 1, text }));
}

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function nextNonEmpty(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].text.trim()) return lines[index];
  }
  return null;
}

function lineContaining(lines, anchor) {
  const needle = normalized(anchor);
  if (!needle) return null;
  return lines.find((line) => normalized(line.text).includes(needle)) || null;
}

function locatorKeys(locator) {
  switch (locator?.kind) {
    case 'xlsx_cell':
      return ['kind', 'sheet', 'cell'];
    case 'docx_paragraph':
      return ['kind', 'paragraph'];
    case 'docx_table_cell':
      return ['kind', 'table', 'row', 'column'];
    case 'odf_paragraph':
      return ['kind', 'paragraph'];
    case 'odf_table_cell':
      return ['kind', 'table', 'row', 'column'];
    case 'pdf_bbox':
    case 'ocr_bbox':
      return ['kind', 'page', 'line'];
    case 'text_line':
      return ['kind', 'line'];
    default:
      return ['kind'];
  }
}

function sameLocator(candidate, expected) {
  if (!candidate || !expected) return false;
  return locatorKeys(expected).every((key) => String(candidate[key] ?? '') === String(expected[key] ?? ''));
}

function findBlockByLocator(blocks, locator) {
  if (!locator || !Array.isArray(blocks) || !blocks.length) return null;
  const exact = blocks.find((block) => sameLocator(block.locator, locator));
  if (exact) return exact;

  if (locator.page && locator.geometry) {
    const expectedX = Number(locator.geometry.x || 0);
    const expectedY = Number(locator.geometry.y || 0);
    return blocks
      .filter((block) => Number(block.locator?.page) === Number(locator.page) && block.geometry)
      .sort((left, right) => {
        const leftDistance = Math.abs(Number(left.geometry.x || 0) - expectedX)
          + Math.abs(Number(left.geometry.y || 0) - expectedY);
        const rightDistance = Math.abs(Number(right.geometry.x || 0) - expectedX)
          + Math.abs(Number(right.geometry.y || 0) - expectedY);
        return leftDistance - rightDistance;
      })[0] || null;
  }
  return null;
}

function extractAfterAnchor(source, anchor) {
  const sourceLower = String(source).toLocaleLowerCase('ru-RU');
  const anchorLower = String(anchor || '').toLocaleLowerCase('ru-RU');
  const offset = sourceLower.indexOf(anchorLower);
  if (offset < 0) return '';
  return source
    .slice(offset + String(anchor || '').length)
    .replace(/^\s*[:—–-]?\s*/, '')
    .trim();
}

function extractFromBlock(field, block, blocks) {
  const strategy = field.strategy || 'after_label';
  const locator = { ...(block.locator || {}), blockId: block.id || undefined };
  if (strategy === 'block' || strategy === 'line') {
    return { value: String(block.text || '').trim(), locator };
  }
  if (strategy === 'after_label') {
    const value = extractAfterAnchor(block.text, field.anchor);
    return value
      ? { value, locator }
      : { value: null, locator, reason: 'value_empty' };
  }
  if (strategy === 'next_line') {
    const index = blocks.indexOf(block);
    const next = blocks.slice(index + 1).find((item) => String(item.text || '').trim());
    return next
      ? { value: String(next.text).trim(), locator: { ...(next.locator || {}), blockId: next.id || undefined } }
      : { value: null, locator, reason: 'next_line_empty' };
  }
  return { value: null, locator, reason: 'locator_strategy_unsupported' };
}

function extractRawValue(field, lines, blocks) {
  if (field.sourceLocator) {
    const block = findBlockByLocator(blocks, field.sourceLocator);
    if (block) {
      const fromBlock = extractFromBlock(field, block, blocks);
      if (fromBlock.value !== null && fromBlock.value !== '') return fromBlock;
    }
  }

  const strategy = field.strategy || 'after_label';
  const anchorLine = lineContaining(lines, field.anchor);
  if (!anchorLine) return { value: null, locator: null, reason: 'anchor_not_found' };
  const lineIndex = anchorLine.number - 1;

  if (strategy === 'line' || strategy === 'block') {
    return { value: anchorLine.text.trim(), locator: { startLine: anchorLine.number, endLine: anchorLine.number } };
  }

  if (strategy === 'next_line') {
    const next = nextNonEmpty(lines, lineIndex + 1);
    return next
      ? { value: next.text.trim(), locator: { startLine: next.number, endLine: next.number } }
      : { value: null, locator: { startLine: anchorLine.number, endLine: anchorLine.number }, reason: 'next_line_empty' };
  }

  if (strategy === 'between') {
    const endAnchor = normalized(field.endAnchor);
    if (!endAnchor) return { value: null, locator: null, reason: 'end_anchor_required' };
    const collected = [];
    let endLine = anchorLine.number;
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      if (normalized(lines[index].text).includes(endAnchor)) break;
      if (lines[index].text.trim()) collected.push(lines[index].text.trim());
      endLine = lines[index].number;
    }
    return collected.length
      ? { value: collected.join('\n'), locator: { startLine: anchorLine.number + 1, endLine } }
      : { value: null, locator: { startLine: anchorLine.number, endLine: anchorLine.number }, reason: 'between_empty' };
  }

  let value = extractAfterAnchor(anchorLine.text, field.anchor);
  if (!value) {
    const next = nextNonEmpty(lines, lineIndex + 1);
    if (next) return { value: next.text.trim(), locator: { startLine: next.number, endLine: next.number } };
  }
  return value
    ? { value, locator: { startLine: anchorLine.number, endLine: anchorLine.number } }
    : { value: null, locator: { startLine: anchorLine.number, endLine: anchorLine.number }, reason: 'value_empty' };
}

function coerceValue(raw, type) {
  if (raw === null || raw === undefined || raw === '') return { value: null, valid: false };
  switch (type) {
    case 'date': {
      const parsed = firstRussianDate(raw);
      return parsed ? { value: parsed.value, valid: true, raw } : { value: raw, valid: false };
    }
    case 'number': {
      const parsed = Number(String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^0-9+-.]/g, ''));
      return Number.isFinite(parsed) ? { value: parsed, valid: true, raw } : { value: raw, valid: false };
    }
    case 'boolean': {
      const value = normalized(raw);
      if (['да', 'есть', 'истина', 'true', '1'].includes(value)) return { value: true, valid: true, raw };
      if (['нет', 'отсутствует', 'ложь', 'false', '0'].includes(value)) return { value: false, valid: true, raw };
      return { value: raw, valid: false };
    }
    default:
      return { value: String(raw).trim(), valid: true, raw };
  }
}

export function matchesTemplate(template, { text, originalName = '' }) {
  const matcher = typeof template.matcher_json === 'string' ? JSON.parse(template.matcher_json) : (template.matcher || {});
  const haystack = normalized(text);
  const filename = normalized(originalName);
  if (matcher.filenameContains && !filename.includes(normalized(matcher.filenameContains))) return false;
  const phrases = Array.isArray(matcher.requiredPhrases) ? matcher.requiredPhrases.filter(Boolean) : [];
  return phrases.every((phrase) => haystack.includes(normalized(phrase)));
}

export function applyTemplate(template, { text, originalName = '', blocks = [] }) {
  const fields = typeof template.fields_json === 'string' ? JSON.parse(template.fields_json) : (template.fields || []);
  const lines = textLines(text);
  const values = {};
  const evidence = {};
  const missing = [];
  let score = 0;
  let weight = 0;

  for (const field of fields) {
    const requiredWeight = field.required === false ? 0.5 : 1;
    weight += requiredWeight;
    const extracted = extractRawValue(field, lines, blocks);
    const typed = coerceValue(extracted.value, field.type || 'string');
    if (typed.value !== null && typed.value !== '') {
      values[field.key] = typed.value;
      evidence[field.key] = {
        locator: extracted.locator,
        raw: typed.raw ?? extracted.value,
        valid: typed.valid,
        strategy: field.strategy || 'after_label',
        anchor: field.anchor,
        sourceLocator: field.sourceLocator || null
      };
      score += typed.valid ? requiredWeight : requiredWeight * 0.6;
    } else if (field.required !== false) {
      missing.push({ key: field.key, label: field.label, reason: extracted.reason || 'not_found' });
    }
  }

  return {
    matched: matchesTemplate(template, { text, originalName }),
    values,
    evidence,
    missing,
    confidence: weight ? Number((score / weight).toFixed(3)) : 0
  };
}

function normalizedLocator(locator) {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) return null;
  const result = {};
  for (const [key, value] of Object.entries(locator)) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'blockId') continue;
    result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

export function normalizeTemplateInput(input) {
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const normalizedFields = fields
    .map((field, index) => ({
      key: String(field.key || `field_${index + 1}`).trim(),
      label: String(field.label || `Поле ${index + 1}`).trim(),
      type: ['string', 'text', 'date', 'number', 'boolean'].includes(field.type) ? field.type : 'string',
      strategy: ['after_label', 'next_line', 'line', 'between', 'block'].includes(field.strategy) ? field.strategy : 'after_label',
      anchor: String(field.anchor || '').trim(),
      endAnchor: field.endAnchor ? String(field.endAnchor).trim() : null,
      required: field.required !== false,
      sample: field.sample ? String(field.sample).trim() : null,
      sourceLocator: normalizedLocator(field.sourceLocator),
      sourceBlockType: field.sourceBlockType ? String(field.sourceBlockType).trim() : null
    }))
    .filter((field) => field.key && field.label && (field.anchor || field.sourceLocator));
  const requiredPhrases = Array.isArray(input.matcher?.requiredPhrases)
    ? [...new Set(input.matcher.requiredPhrases.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  return {
    name: String(input.name || '').trim(),
    code: String(input.code || '').trim(),
    documentType: String(input.documentType || 'custom_document').trim(),
    matcher: {
      filenameContains: input.matcher?.filenameContains ? String(input.matcher.filenameContains).trim() : '',
      requiredPhrases
    },
    fields: normalizedFields
  };
}
