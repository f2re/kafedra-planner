import { cleanupText, decodeXmlEntities } from './xml-text.mjs';

function attr(source, name) {
  const match = String(source || '').match(new RegExp(`\\b${name.replace(':', '\\:')}=["']([^"']*)["']`, 'i'));
  return match ? decodeXmlEntities(match[1]) : null;
}

function stripXml(value) {
  return cleanupText(decodeXmlEntities(String(value || '').replace(/<[^>]+>/g, '')));
}

function wordText(xml) {
  const prepared = String(xml || '')
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n');
  const values = [];
  for (const match of prepared.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)) {
    values.push(decodeXmlEntities(match[1]));
  }
  return cleanupText(values.join(''));
}

function block(type, text, locator, geometry = null, metadata = {}) {
  return {
    type,
    text: cleanupText(text),
    locator,
    geometry,
    metadata
  };
}

export function plainTextToBlocks(text) {
  return String(text || '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((text, index) => block('line', text, { kind: 'text_line', line: index + 1 }))
    .filter((item) => item.text);
}

export function docxXmlToBlocks(xml) {
  const source = String(xml || '');
  const bodyMatch = source.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
  const body = bodyMatch ? bodyMatch[1] : source;
  const blocks = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  let cursor = 0;

  while (cursor < body.length) {
    const paragraphStart = body.indexOf('<w:p', cursor);
    const tableStart = body.indexOf('<w:tbl', cursor);
    if (paragraphStart < 0 && tableStart < 0) break;

    if (tableStart >= 0 && (paragraphStart < 0 || tableStart < paragraphStart)) {
      const tableEnd = body.indexOf('</w:tbl>', tableStart);
      if (tableEnd < 0) break;
      const tableXml = body.slice(tableStart, tableEnd + 8);
      let rowIndex = 0;
      for (const rowMatch of tableXml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi)) {
        let columnIndex = 0;
        for (const cellMatch of rowMatch[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi)) {
          const text = wordText(cellMatch[1]);
          if (text) {
            blocks.push(block('table_cell', text, {
              kind: 'docx_table_cell',
              table: tableIndex + 1,
              row: rowIndex + 1,
              column: columnIndex + 1
            }, null, { table: tableIndex + 1, row: rowIndex + 1, column: columnIndex + 1 }));
          }
          columnIndex += 1;
        }
        rowIndex += 1;
      }
      tableIndex += 1;
      cursor = tableEnd + 8;
      continue;
    }

    const paragraphEnd = body.indexOf('</w:p>', paragraphStart);
    if (paragraphEnd < 0) break;
    const paragraphXml = body.slice(paragraphStart, paragraphEnd + 6);
    const text = wordText(paragraphXml);
    paragraphIndex += 1;
    if (text) {
      const styleMatch = paragraphXml.match(/<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i);
      blocks.push(block(styleMatch ? 'heading' : 'paragraph', text, {
        kind: 'docx_paragraph',
        paragraph: paragraphIndex
      }, null, styleMatch ? { style: decodeXmlEntities(styleMatch[1]) } : {}));
    }
    cursor = paragraphEnd + 6;
  }
  return blocks;
}

function odfNodeText(xml) {
  return cleanupText(decodeXmlEntities(String(xml || '')
    .replace(/<text:tab\b[^>]*\/>/gi, '\t')
    .replace(/<text:line-break\b[^>]*\/>/gi, '\n')
    .replace(/<text:s\b[^>]*text:c=["'](\d+)["'][^>]*\/>/gi, (_, count) => ' '.repeat(Number(count)))
    .replace(/<text:s\b[^>]*\/>/gi, ' ')
    .replace(/<[^>]+>/g, '')));
}

export function odtXmlToBlocks(xml) {
  const source = String(xml || '');
  const blocks = [];
  let paragraph = 0;
  let table = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const paragraphMatch = /<text:(p|h)\b[^>]*>[\s\S]*?<\/text:\1>/gi;
    paragraphMatch.lastIndex = cursor;
    const nextParagraph = paragraphMatch.exec(source);
    const tableStart = source.indexOf('<table:table', cursor);

    if (!nextParagraph && tableStart < 0) break;
    if (tableStart >= 0 && (!nextParagraph || tableStart < nextParagraph.index)) {
      const tableEnd = source.indexOf('</table:table>', tableStart);
      if (tableEnd < 0) break;
      const tableXml = source.slice(tableStart, tableEnd + 14);
      const tableName = attr(tableXml.slice(0, tableXml.indexOf('>') + 1), 'table:name') || `Таблица ${table + 1}`;
      let row = 0;
      for (const rowMatch of tableXml.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi)) {
        let column = 0;
        for (const cellMatch of rowMatch[1].matchAll(/<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>/gi)) {
          const repeat = Math.max(1, Number(attr(cellMatch[1], 'table:number-columns-repeated') || 1));
          const text = odfNodeText(cellMatch[2]);
          for (let index = 0; index < repeat; index += 1) {
            if (text) {
              blocks.push(block('table_cell', text, {
                kind: 'odf_table_cell', table: tableName, row: row + 1, column: column + 1
              }, null, { table: tableName, row: row + 1, column: column + 1 }));
            }
            column += 1;
          }
        }
        row += 1;
      }
      table += 1;
      cursor = tableEnd + 14;
      continue;
    }

    paragraph += 1;
    const type = nextParagraph[1].toLowerCase() === 'h' ? 'heading' : 'paragraph';
    const text = odfNodeText(nextParagraph[0]);
    if (text) blocks.push(block(type, text, { kind: 'odf_paragraph', paragraph }));
    cursor = nextParagraph.index + nextParagraph[0].length;
  }
  return blocks;
}

export function xlsxSharedStrings(xml) {
  if (!xml) return [];
  const values = [];
  for (const match of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const pieces = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXmlEntities(item[1]));
    values.push(cleanupText(pieces.join('')));
  }
  return values;
}

export function xlsxWorkbookSheets(workbookXml, relsXml) {
  const relations = new Map();
  for (const match of String(relsXml || '').matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gi)) {
    const id = attr(match[1], 'Id');
    const target = attr(match[1], 'Target');
    if (id && target) relations.set(id, target.replace(/^\//, ''));
  }
  const sheets = [];
  for (const match of String(workbookXml || '').matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/gi)) {
    const name = attr(match[1], 'name') || `Лист ${sheets.length + 1}`;
    const relId = attr(match[1], 'r:id');
    let target = relations.get(relId) || `worksheets/sheet${sheets.length + 1}.xml`;
    if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`;
    target = target.replace(/xl\/worksheets\/\.\.\//, 'xl/');
    sheets.push({ name, target });
  }
  return sheets;
}

function spreadsheetCellText(cellXml, type, sharedStrings) {
  if (type === 'inlineStr') {
    return cleanupText([...String(cellXml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((item) => decodeXmlEntities(item[1])).join(''));
  }
  const valueMatch = String(cellXml).match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
  if (!valueMatch) return '';
  const raw = decodeXmlEntities(valueMatch[1]);
  if (type === 's') return sharedStrings[Number(raw)] ?? raw;
  if (type === 'b') return raw === '1' ? 'Да' : 'Нет';
  return raw;
}

export function xlsxWorksheetToBlocks(xml, { sheetName = 'Лист 1', sharedStrings = [] } = {}) {
  const blocks = [];
  for (const cellMatch of String(xml || '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
    const reference = attr(cellMatch[1], 'r');
    if (!reference) continue;
    const type = attr(cellMatch[1], 't') || 'n';
    const text = spreadsheetCellText(cellMatch[2], type, sharedStrings);
    if (!text) continue;
    const row = Number((reference.match(/\d+/) || [0])[0]);
    const column = (reference.match(/[A-Z]+/i) || [''])[0].toUpperCase();
    blocks.push(block('spreadsheet_cell', text, {
      kind: 'xlsx_cell', sheet: sheetName, cell: reference.toUpperCase()
    }, null, { sheet: sheetName, row, column, cell: reference.toUpperCase(), valueType: type }));
  }
  return blocks;
}

export function pdfBboxHtmlToBlocks(html) {
  const source = String(html || '');
  const blocks = [];
  let pageNumber = 0;
  for (const pageMatch of source.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi)) {
    pageNumber += 1;
    const pageWidth = Number(attr(pageMatch[1], 'width') || 0);
    const pageHeight = Number(attr(pageMatch[1], 'height') || 0);
    let lineNumber = 0;
    for (const lineMatch of pageMatch[2].matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/gi)) {
      lineNumber += 1;
      const words = [...lineMatch[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gi)]
        .map((item) => decodeXmlEntities(item[1])).filter(Boolean);
      const text = cleanupText(words.join(' '));
      if (!text) continue;
      const xMin = Number(attr(lineMatch[1], 'xMin') || 0);
      const yMin = Number(attr(lineMatch[1], 'yMin') || 0);
      const xMax = Number(attr(lineMatch[1], 'xMax') || xMin);
      const yMax = Number(attr(lineMatch[1], 'yMax') || yMin);
      blocks.push(block('pdf_line', text, {
        kind: 'pdf_bbox', page: pageNumber, line: lineNumber
      }, {
        x: xMin, y: yMin, width: Math.max(0, xMax - xMin), height: Math.max(0, yMax - yMin),
        pageWidth, pageHeight
      }, { page: pageNumber, line: lineNumber }));
    }
  }
  return blocks;
}

export function blocksToText(blocks) {
  return cleanupText((blocks || []).map((item) => item.text).filter(Boolean).join('\n'));
}
