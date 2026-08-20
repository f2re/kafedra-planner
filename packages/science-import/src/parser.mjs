import { readFile } from 'node:fs/promises';

function clean(value) {
  return String(value ?? '').normalize('NFKC').replace(/\u0000/gu, '').replace(/\s+/gu, ' ').trim();
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function separatorFor(text) {
  const first = String(text || '').split(/\r?\n/u).find((line) => line.trim()) || '';
  const candidates = [',', ';', '\t'];
  return candidates.map((separator) => ({ separator, count: first.split(separator).length - 1 }))
    .sort((left, right) => right.count - left.count)[0]?.separator || ';';
}

export function parseDelimited(text, separator = separatorFor(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/u, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
      continue;
    }
    if (!quoted && char === separator) {
      row.push(clean(cell));
      cell = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(clean(cell));
      cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(clean(cell));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function objectRows(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.rows) ? value.rows : null;
  if (!rows) return null;
  const headers = [];
  const seen = new Set();
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) if (!seen.has(key)) { seen.add(key); headers.push(key); }
  }
  return [headers, ...rows.map((item) => headers.map((header) => clean(item?.[header])) )];
}

function blockColumns(database) {
  return new Set(database.all('PRAGMA table_info(document_blocks)').map((item) => item.name));
}

function field(row, candidates) {
  for (const name of candidates) if (Object.hasOwn(row, name)) return row[name];
  return null;
}

function blockRows(database, documentVersionId) {
  const columns = blockColumns(database);
  if (!columns.size) return [];
  const ordering = ['block_index','sequence_no','ordinal','id'].filter((name) => columns.has(name));
  const rows = database.all(`SELECT * FROM document_blocks WHERE document_version_id = ?${ordering.length ? ` ORDER BY ${ordering.join(',')}` : ''}`, documentVersionId);
  const groups = new Map();
  for (const item of rows) {
    const type = clean(field(item, ['block_type','type','kind'])).toLowerCase();
    if (!/(?:cell|table)/u.test(type)) continue;
    const metadata = parseJson(field(item, ['metadata_json','metadata']), {});
    const locator = parseJson(field(item, ['locator_json','locator']), {});
    const sheet = metadata.sheet ?? metadata.sheetName ?? locator.sheet ?? locator.sheetName ?? metadata.table ?? locator.table ?? '1';
    const rowNo = Number(metadata.row ?? metadata.rowNumber ?? locator.row ?? locator.rowNumber);
    const columnNo = Number(metadata.column ?? metadata.columnNumber ?? locator.column ?? locator.columnNumber);
    if (!Number.isFinite(rowNo) || !Number.isFinite(columnNo)) continue;
    const key = `${sheet}:${rowNo}`;
    if (!groups.has(key)) groups.set(key, { sheet: String(sheet), rowNo, cells: new Map() });
    groups.get(key).cells.set(columnNo, clean(field(item, ['text','content','value','normalized_text'])));
  }
  return [...groups.values()]
    .sort((left, right) => left.sheet.localeCompare(right.sheet, 'ru') || left.rowNo - right.rowNo)
    .map((group) => {
      const max = Math.max(0, ...group.cells.keys());
      return Array.from({ length: max }, (_, index) => group.cells.get(index + 1) || '');
    });
}

export async function sourceRows(database, source) {
  const format = clean(source.detected_format || source.original_name?.split('.').at(-1)).toLowerCase();
  if (['xlsx','ods','docx','odt'].includes(format)) {
    const blocks = blockRows(database, source.version_id);
    if (blocks.length) return blocks;
  }
  const buffer = await readFile(source.storage_path);
  const text = buffer.toString('utf8');
  if (format === 'json' || /^\s*[\[{]/u.test(text)) {
    try {
      const parsed = objectRows(JSON.parse(text));
      if (parsed?.length) return parsed;
    } catch {}
  }
  return parseDelimited(text);
}

const ALIASES = {
  title: ['название','наименование','title','материал','публикация','тема'],
  kind: ['вид','тип','kind','type'],
  authors: ['авторы','автор','authors','author'],
  doi: ['doi'],
  publicationYear: ['год','год публикации','publication year','year'],
  publishedAt: ['дата публикации','опубликовано','published at','date'],
  venue: ['журнал','издание','мероприятие','venue','journal','conference'],
  classifications: ['классификация','категория','вак/ринц','classification','indexing'],
  lifecycleStatus: ['этап','статус','состояние','lifecycle','status'],
  targetVenue: ['целевое издание','куда подано','target venue'],
  nextAction: ['следующее действие','действие','next action'],
  nextActionDue: ['срок','срок действия','next action due','deadline']
};

function normalizedHeader(value) {
  return clean(value).toLocaleLowerCase('ru-RU').replace(/[._-]+/gu, ' ');
}

export function suggestMapping(headers) {
  const result = {};
  headers.forEach((header, index) => {
    const normalized = normalizedHeader(header);
    for (const [fieldName, aliases] of Object.entries(ALIASES)) {
      if (result[fieldName] !== undefined) continue;
      if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) result[fieldName] = index;
    }
  });
  return result;
}

export function analyzeRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return { headers: [], rows: [], suggestedMapping: {}, ready: false };
  const headers = rows[0].map((value, index) => clean(value) || `Колонка ${index + 1}`);
  const dataRows = rows.slice(1).filter((row) => row.some((value) => clean(value)));
  const suggestedMapping = suggestMapping(headers);
  return {
    headers,
    rows: dataRows,
    suggestedMapping,
    ready: suggestedMapping.title !== undefined,
    preview: dataRows.slice(0, 20)
  };
}

export function cellFrom(row, mapping, name) {
  const index = Number(mapping?.[name]);
  return Number.isInteger(index) && index >= 0 ? clean(row[index]) : '';
}
