import { readFile } from 'node:fs/promises';
import { parseDelimited } from '../../science-import/src/parser.mjs';

export function clean(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u0000/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function normalized(value) {
  return clean(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[._–—-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function columnNumber(value) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = String(value ?? '').toUpperCase().match(/[A-Z]+/u);
  if (!match) return null;
  let result = 0;
  for (const char of match[0]) result = result * 26 + char.charCodeAt(0) - 64;
  return result || null;
}

export function columnLetters(value) {
  let number = Number(value);
  if (!Number.isInteger(number) || number < 1) return '';
  let result = '';
  while (number > 0) {
    number -= 1;
    result = String.fromCharCode(65 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

export function parseCellAddress(value) {
  const match = clean(value).toUpperCase().match(/^([A-Z]+)(\d+)$/u);
  if (!match) return null;
  return {
    column: columnNumber(match[1]),
    row: Number(match[2]),
    cell: `${match[1]}${Number(match[2])}`
  };
}

function field(row, candidates) {
  for (const name of candidates) {
    if (Object.hasOwn(row, name)) return row[name];
  }
  return null;
}

function structuredTables(database, versionId) {
  const columns = new Set(database.all('PRAGMA table_info(document_blocks)').map((item) => item.name));
  if (!columns.size) return [];
  const ordering = ['block_index', 'sequence_no', 'ordinal', 'id'].filter((name) => columns.has(name));
  const rows = database.all(
    `SELECT * FROM document_blocks WHERE document_version_id = ?${ordering.length ? ` ORDER BY ${ordering.join(',')}` : ''}`,
    versionId
  );
  const tables = new Map();
  for (const item of rows) {
    const type = clean(field(item, ['block_type', 'type', 'kind'])).toLowerCase();
    if (!/(?:spreadsheet|table).*cell|cell/u.test(type)) continue;
    const metadata = parseJson(field(item, ['metadata_json', 'metadata']), {});
    const locator = parseJson(field(item, ['locator_json', 'locator']), {});
    const sheetName = clean(
      metadata.sheet ?? metadata.sheetName ?? locator.sheet ?? locator.sheetName
        ?? metadata.table ?? locator.table ?? 'Лист 1'
    ) || 'Лист 1';
    const row = Number(metadata.row ?? metadata.rowNumber ?? locator.row ?? locator.rowNumber);
    const column = columnNumber(
      metadata.column ?? metadata.columnNumber ?? locator.column ?? locator.columnNumber
        ?? metadata.cell ?? locator.cell
    );
    if (!Number.isInteger(row) || row < 1 || !Number.isInteger(column) || column < 1) continue;
    const cell = clean(metadata.cell ?? locator.cell) || `${columnLetters(column)}${row}`;
    if (!tables.has(sheetName)) tables.set(sheetName, new Map());
    const tableRows = tables.get(sheetName);
    if (!tableRows.has(row)) tableRows.set(row, new Map());
    tableRows.get(row).set(column, {
      text: clean(field(item, ['text', 'content', 'value', 'normalized_text'])),
      sheetName,
      row,
      column,
      cell: cell.toUpperCase(),
      locator: { ...locator, sheet: sheetName, row, column, cell: cell.toUpperCase() }
    });
  }
  return [...tables.entries()].map(([name, rows]) => ({ name, rows }));
}

function delimitedTable(rows) {
  const tableRows = new Map();
  rows.forEach((sourceRow, rowIndex) => {
    const cells = new Map();
    sourceRow.forEach((value, columnIndex) => {
      const text = clean(value);
      if (!text) return;
      const row = rowIndex + 1;
      const column = columnIndex + 1;
      const cell = `${columnLetters(column)}${row}`;
      cells.set(column, {
        text,
        sheetName: 'Таблица',
        row,
        column,
        cell,
        locator: { kind: 'delimited_cell', sheet: 'Таблица', row, column, cell }
      });
    });
    if (cells.size) tableRows.set(rowIndex + 1, cells);
  });
  return { name: 'Таблица', rows: tableRows };
}

export async function readTables(database, source) {
  const format = clean(source.detected_format || source.original_name?.split('.').at(-1)).toLowerCase();
  if (['xlsx', 'ods'].includes(format)) {
    const tables = structuredTables(database, source.version_id);
    if (tables.length) return tables;
  }
  const buffer = await readFile(source.storage_path);
  const rows = parseDelimited(buffer.toString('utf8'));
  return rows.length ? [delimitedTable(rows)] : [];
}

export function findTable(tables, name) {
  return tables.find((table) => table.name === name) || null;
}

export function findCell(tables, sheetName, address) {
  const parsed = parseCellAddress(address);
  const table = findTable(tables, sheetName);
  if (!parsed || !table) return null;
  return table.rows.get(parsed.row)?.get(parsed.column) || null;
}

export function rowsAfter(table, rowNumber) {
  return [...table.rows.entries()]
    .filter(([row]) => row > Number(rowNumber))
    .sort(([left], [right]) => left - right);
}

export function cellsFromRow(row) {
  return [...(row?.values() || [])].sort((left, right) => left.column - right.column);
}

export function cellOptions(tables, { maxRows = 60, maxCells = 800 } = {}) {
  const result = [];
  for (const table of tables) {
    for (const [rowNumber, row] of [...table.rows.entries()].sort(([left], [right]) => left - right)) {
      if (rowNumber > maxRows) continue;
      for (const cell of cellsFromRow(row)) {
        if (!cell.text) continue;
        result.push({
          sheetName: table.name,
          cell: cell.cell,
          row: cell.row,
          column: cell.column,
          value: cell.text,
          locator: cell.locator
        });
        if (result.length >= maxCells) return result;
      }
    }
  }
  return result;
}
