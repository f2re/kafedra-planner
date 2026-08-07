import { spawn } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const DIRECTION_LABELS = {
  organizational: 'Организация',
  education: 'Образование',
  science: 'Наука'
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return { time, date: day };
}

export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function runBuffer(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout));
      const error = new Error(`${command} exited with ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`);
      error.code = command === 'unzip' && code === 127 ? 'unzip_unavailable' : 'docx_unzip_failed';
      reject(error);
    });
  });
}

function unzipLiteralPattern(name) {
  return String(name).replace(/([\\[*?])/g, '\\$1');
}

export async function readDocxEntries(sourcePath, maxBytes = 128 * 1024 * 1024) {
  const listing = (await runBuffer('unzip', ['-Z1', sourcePath])).toString('utf8');
  const names = listing.split(/\r?\n/).map((item) => item.trim()).filter((item) => item && !item.endsWith('/'));
  const entries = [];
  let total = 0;
  for (const name of names) {
    const data = await runBuffer('unzip', ['-p', sourcePath, unzipLiteralPattern(name)]);
    total += data.length;
    if (total > maxBytes) {
      const error = new Error('plan_template_unpacked_too_large');
      error.code = 'plan_template_unpacked_too_large';
      throw error;
    }
    entries.push({ name, data });
  }
  return entries;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '');
}

function itemDate(item) {
  if (!item.startsAt) return '';
  const start = formatDate(item.startsAt);
  if (item.endsAt && item.endsAt !== item.startsAt) return `${start}–${formatDate(item.endsAt)}`;
  return start;
}

function directionText(item) {
  if (item.directionLabel) return item.directionLabel;
  return DIRECTION_LABELS[item.direction] || item.direction || '';
}

function replaceCellText(cellXml, value) {
  const escaped = escapeXml(value);
  let replaced = false;
  const withTexts = String(cellXml).replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/gi, (match, attrs) => {
    if (replaced) return `<w:t${attrs}></w:t>`;
    replaced = true;
    return `<w:t${attrs}>${escaped}</w:t>`;
  });
  if (replaced) return withTexts;
  const insertion = `<w:r><w:t>${escaped}</w:t></w:r>`;
  if (withTexts.includes('</w:p>')) return withTexts.replace('</w:p>', `${insertion}</w:p>`);
  return withTexts.replace('</w:tc>', `<w:p>${insertion}</w:p></w:tc>`);
}

function fillRow(rowXml, columnMap, item, index) {
  const values = {
    number: item.number || item.itemNo || String(index + 1),
    title: item.title || '',
    date: itemDate(item),
    due: formatDate(item.dueDate),
    responsible: item.responsible || item.responsibleRaw || '',
    result: item.result || item.expectedResult || '',
    direction: directionText(item)
  };
  let cellIndex = 0;
  return String(rowXml).replace(/<w:tc\b[\s\S]*?<\/w:tc>/gi, (cellXml) => {
    cellIndex += 1;
    const field = Object.entries(columnMap || {}).find(([, column]) => Number(column) === cellIndex)?.[0];
    return field ? replaceCellText(cellXml, values[field] ?? '') : cellXml;
  });
}

function replaceYearInTextNodes(xml, yearToken, periodKey) {
  let replacements = 0;
  const token = String(yearToken || '').trim();
  return {
    xml: String(xml).replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/gi, (match, attrs, content) => {
      let next = content;
      for (const placeholder of ['{{year}}', '{{YEAR}}', '{{год}}', '{{academic_year}}', '{{учебный_год}}']) {
        if (next.includes(placeholder)) {
          next = next.replaceAll(placeholder, periodKey);
          replacements += 1;
        }
      }
      if (token && next.includes(token)) {
        next = next.replaceAll(token, periodKey);
        replacements += 1;
      }
      return `<w:t${attrs}>${next}</w:t>`;
    }),
    count: replacements
  };
}

function replacePlanTable(documentXml, template, items) {
  const tables = [...String(documentXml).matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi)];
  const selected = tables[Number(template.table_index) - 1];
  if (!selected) throw new Error('plan_template_table_not_found');
  const tableXml = selected[0];
  const rows = [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gi)];
  const sample = rows[Number(template.sample_row) - 1];
  if (!sample) throw new Error('plan_template_sample_row_not_found');
  const columnMap = template.columnMap || {};
  const requiredColumn = Math.max(...Object.values(columnMap).map(Number).filter(Number.isFinite));
  const cellCount = [...sample[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gi)].length;
  if (!requiredColumn || cellCount < requiredColumn) throw new Error('plan_template_column_map_invalid');
  const generated = items.map((item, index) => fillRow(sample[0], columnMap, item, index)).join('');
  const nextTable = tableXml.slice(0, sample.index) + generated + tableXml.slice(sample.index + sample[0].length);
  return String(documentXml).slice(0, selected.index) + nextTable + String(documentXml).slice(selected.index + tableXml.length);
}

export async function generateDocxFromPlanTemplate({
  sourcePath,
  targetPath,
  template,
  periodKey,
  items,
  maxBytes
}) {
  const entries = await readDocxEntries(sourcePath, maxBytes);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  if (!document) throw new Error('plan_template_document_xml_missing');
  let xml = document.data.toString('utf8');
  const year = replaceYearInTextNodes(xml, template.year_token, periodKey);
  xml = year.xml;
  if (!year.count) throw new Error('plan_template_year_not_found');
  xml = replacePlanTable(xml, template, items);
  document.data = Buffer.from(xml, 'utf8');
  await writeFile(targetPath, createZip(entries), { mode: 0o600 });
  return { yearReplacements: year.count, rowCount: items.length };
}
