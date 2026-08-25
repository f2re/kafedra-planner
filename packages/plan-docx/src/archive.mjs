import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const UINT32_MAX = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeEntryName(name) {
  const value = String(name || '').replaceAll('\\', '/');
  if (!value || value.startsWith('/') || value.includes('\0')) throw new Error('zip_entry_invalid');
  const parts = value.split('/');
  if (parts.some((part) => part === '..')) throw new Error('zip_entry_invalid');
  return value;
}

function unzipPattern(name) {
  return safeEntryName(name).replace(/([\[\]*?])/g, '\\$1');
}

function uint32(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) throw new Error(`zip_${field}_too_large`);
  return value;
}

function localHeader(nameBuffer, data) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(uint32(data.length, 'entry'), 18);
  header.writeUInt32LE(uint32(data.length, 'entry'), 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function writeArchive(outputPath, entries) {
  await mkdir(dirname(outputPath), { recursive: true });
  const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  const central = [];
  let offset = 0;
  try {
    for await (const rawEntry of entries) {
      const name = safeEntryName(rawEntry.name);
      if (name.endsWith('/')) continue;
      const data = Buffer.isBuffer(rawEntry.data) ? rawEntry.data : Buffer.from(rawEntry.data || '');
      const nameBuffer = Buffer.from(name, 'utf8');
      if (nameBuffer.length > 0xffff) throw new Error('zip_entry_name_too_long');
      uint32(offset, 'offset');
      const header = localHeader(nameBuffer, data);
      await writeChunk(output, header);
      await writeChunk(output, nameBuffer);
      await writeChunk(output, data);
      central.push({ nameBuffer, size: data.length, crc: crc32(data), offset });
      offset += header.length + nameBuffer.length + data.length;
    }
    if (central.length > 0xffff) throw new Error('zip_entry_count_too_large');
    const centralOffset = offset;
    for (const entry of central) {
      const header = centralHeader(entry);
      await writeChunk(output, header);
      await writeChunk(output, entry.nameBuffer);
      offset += header.length + entry.nameBuffer.length;
    }
    const centralSize = offset - centralOffset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(uint32(centralSize, 'central_directory'), 12);
    end.writeUInt32LE(uint32(centralOffset, 'central_offset'), 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(output, end);
    output.end();
    await once(output, 'close');
  } catch (error) {
    output.destroy();
    await rm(outputPath, { force: true });
    throw error;
  }
}

export async function listZipEntries(path) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', path], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
  return String(stdout || '')
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(safeEntryName);
}

export async function readZipEntry(path, name, { maxBuffer = 256 * 1024 * 1024 } = {}) {
  const { stdout } = await execFileAsync('unzip', ['-p', path, unzipPattern(name)], {
    encoding: 'buffer', maxBuffer
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
}

export async function readZipArchive(path, options = {}) {
  const archive = new Map();
  for (const name of await listZipEntries(path)) {
    if (!name.endsWith('/')) archive.set(name, await readZipEntry(path, name, options));
  }
  return archive;
}

export async function writeZipArchive(outputPath, entries) {
  async function *source() {
    for (const [name, value] of Object.entries(entries || {})) yield { name, data: value };
  }
  await writeArchive(outputPath, source());
  return outputPath;
}

export async function rewriteZipArchive(sourcePath, outputPath, replacements = new Map()) {
  const names = await listZipEntries(sourcePath);
  async function *source() {
    for (const name of names) {
      if (name.endsWith('/')) continue;
      const replacement = replacements instanceof Map ? replacements.get(name) : replacements?.[name];
      yield { name, data: replacement === undefined ? await readZipEntry(sourcePath, name) : replacement };
    }
  }
  await writeArchive(outputPath, source());
  return outputPath;
}
