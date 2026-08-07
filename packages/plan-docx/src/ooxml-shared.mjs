import { cleanupText, decodeXmlEntities } from '../../document-intake/src/xml-text.mjs';
import { readZipEntry } from './archive.mjs';

export const DOCUMENT_XML = 'word/document.xml';

function tagTokenPattern(tag) {
  return new RegExp(`<w:${tag}\\b[^>]*\\/?\\s*>|<\\/w:${tag}>`, 'giu');
}

function elementEnd(source, start, tag) {
  const pattern = tagTokenPattern(tag);
  pattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const token = match[0];
    const closing = token.startsWith('</');
    const selfClosing = /\/\s*>$/.test(token);
    if (!closing && !selfClosing) depth += 1;
    if (closing) depth -= 1;
    if ((!closing && selfClosing && depth === 0) || (closing && depth === 0)) return pattern.lastIndex;
  }
  throw new Error(`ooxml_${tag}_unclosed`);
}

function nextElementStart(source, cursor, tags) {
  let best = null;
  for (const tag of tags) {
    const match = new RegExp(`<w:${tag}\\b`, 'iu').exec(source.slice(cursor));
    if (!match) continue;
    const index = cursor + match.index;
    if (!best || index < best.index) best = { tag, index };
  }
  return best;
}

export function bodyBounds(xml) {
  const source = String(xml || '');
  const open = /<w:body\b[^>]*>/iu.exec(source);
  if (!open) throw new Error('ooxml_body_missing');
  const start = open.index + open[0].length;
  const end = source.indexOf('</w:body>', start);
  if (end < 0) throw new Error('ooxml_body_unclosed');
  return { start, end };
}

export function bodyChildren(xml) {
  const source = String(xml || '');
  const bounds = bodyBounds(source);
  const content = source.slice(bounds.start, bounds.end);
  const children = [];
  let cursor = 0;
  let paragraphIndex = 0;
  let tableIndex = 0;
  while (cursor < content.length) {
    const next = nextElementStart(content, cursor, ['p', 'tbl']);
    if (!next) break;
    const end = elementEnd(content, next.index, next.tag);
    const value = content.slice(next.index, end);
    const entry = {
      tag: next.tag,
      start: bounds.start + next.index,
      end: bounds.start + end,
      xml: value
    };
    if (next.tag === 'p') entry.paragraphIndex = ++paragraphIndex;
    if (next.tag === 'tbl') entry.tableIndex = ++tableIndex;
    children.push(entry);
    cursor = end;
  }
  return children;
}

export function directElements(source, tag) {
  const value = String(source || '');
  const elements = [];
  let cursor = 0;
  while (cursor < value.length) {
    const match = new RegExp(`<w:${tag}\\b`, 'iu').exec(value.slice(cursor));
    if (!match) break;
    const start = cursor + match.index;
    const end = elementEnd(value, start, tag);
    elements.push({ index: elements.length + 1, start, end, xml: value.slice(start, end) });
    cursor = end;
  }
  return elements;
}

export function wordVisibleText(xml) {
  const pieces = [];
  const source = String(xml || '')
    .replace(/<w:tab\b[^>]*\/>/giu, '\t')
    .replace(/<w:br\b[^>]*\/>/giu, '\n');
  for (const match of source.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/giu)) {
    pieces.push(decodeXmlEntities(match[1]));
  }
  return cleanupText(pieces.join(''));
}

export function rowCells(rowXml) {
  return directElements(rowXml, 'tc').map((cell) => ({
    ...cell,
    text: wordVisibleText(cell.xml),
    complex: /<w:(?:gridSpan|vMerge)\b/iu.test(cell.xml)
  }));
}

export function tableRows(tableXml) {
  return directElements(tableXml, 'tr').map((row) => {
    const cells = rowCells(row.xml);
    return {
      ...row,
      cells,
      cellCount: cells.length,
      complex: cells.some((cell) => cell.complex),
      text: cleanupText(cells.map((cell) => cell.text).filter(Boolean).join(' | '))
    };
  });
}

export function escapeXmlText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function textNodes(xml) {
  const nodes = [];
  for (const match of String(xml || '').matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/giu)) {
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      attrs: match[1] || '',
      raw: match[2] || '',
      text: decodeXmlEntities(match[2] || '')
    });
  }
  return nodes;
}

export function replaceVisibleText(xml, search, replacement) {
  const source = String(xml || '');
  const nodes = textNodes(source);
  if (!nodes.length) return { xml: source, changed: false };
  let offset = 0;
  for (const node of nodes) {
    node.textStart = offset;
    offset += node.text.length;
    node.textEnd = offset;
  }
  const visible = nodes.map((node) => node.text).join('');
  const start = visible.indexOf(String(search || ''));
  if (start < 0 || !String(search || '').length) return { xml: source, changed: false };
  const end = start + String(search).length;
  let inserted = false;
  const replacements = [];
  for (const node of nodes) {
    if (node.textEnd <= start || node.textStart >= end) continue;
    const localStart = Math.max(0, start - node.textStart);
    const localEnd = Math.min(node.text.length, end - node.textStart);
    const prefix = node.text.slice(0, localStart);
    const suffix = node.text.slice(localEnd);
    let text = prefix;
    if (!inserted) {
      text += String(replacement ?? '');
      inserted = true;
    }
    text += suffix;
    replacements.push({
      start: node.start,
      end: node.end,
      value: `<w:t${node.attrs}>${escapeXmlText(text)}</w:t>`
    });
  }
  let result = source;
  for (const item of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, item.start) + item.value + result.slice(item.end);
  }
  return { xml: result, changed: true };
}

export function setCellText(cellXml, value) {
  const source = String(cellXml || '');
  const nodes = textNodes(source);
  const text = escapeXmlText(value ?? '');
  if (nodes.length) {
    let result = source;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const replacement = `<w:t${node.attrs}>${index === 0 ? text : ''}</w:t>`;
      result = result.slice(0, node.start) + replacement + result.slice(node.end);
    }
    return result;
  }
  const runEnd = source.indexOf('</w:r>');
  if (runEnd >= 0) return source.slice(0, runEnd) + `<w:t>${text}</w:t>` + source.slice(runEnd);
  const paragraphEnd = source.indexOf('</w:p>');
  if (paragraphEnd >= 0) return source.slice(0, paragraphEnd) + `<w:r><w:t>${text}</w:t></w:r>` + source.slice(paragraphEnd);
  const selfClosing = source.match(/<w:p\b([^>]*)\/>/iu);
  if (selfClosing) {
    return source.replace(selfClosing[0], `<w:p${selfClosing[1]}><w:r><w:t>${text}</w:t></w:r></w:p>`);
  }
  const cellEnd = source.indexOf('</w:tc>');
  if (cellEnd >= 0) return source.slice(0, cellEnd) + `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` + source.slice(cellEnd);
  throw new Error('ooxml_cell_invalid');
}

export function replaceTableRows(tableXml, startRow, endRow, newRows) {
  const rows = tableRows(tableXml);
  if (!rows.length) throw new Error('ooxml_table_rows_missing');
  const first = rows[startRow - 1];
  const last = rows[endRow - 1];
  if (!first || !last || startRow > endRow) throw new Error('ooxml_row_range_invalid');
  return String(tableXml).slice(0, first.start)
    + newRows.join('')
    + String(tableXml).slice(last.end);
}

export function replaceBodyChild(xml, child, replacement) {
  const source = String(xml || '');
  return source.slice(0, child.start) + replacement + source.slice(child.end);
}

export async function readDocumentXml(path) {
  return (await readZipEntry(path, DOCUMENT_XML)).toString('utf8');
}
