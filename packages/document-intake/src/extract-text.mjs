import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../../core/src/errors.mjs';
import { wordDocumentXmlToText, odtContentXmlToText, cleanupText } from './xml-text.mjs';
import {
  plainTextToBlocks,
  docxXmlToBlocks,
  odtXmlToBlocks,
  xlsxSharedStrings,
  xlsxWorkbookSheets,
  xlsxWorksheetToBlocks,
  pdfBboxHtmlToBlocks,
  blocksToText
} from './structure.mjs';
import { ocrImage, ocrPdf } from './ocr.mjs';

const execFileAsync = promisify(execFile);

function ocrDiagnostic(result, fallbackStatus = 'not_needed') {
  if (!result) {
    return {
      status: fallbackStatus,
      engine: null,
      languages: null,
      confidence: null,
      error: null,
      coverage: null
    };
  }
  return {
    status: result.status,
    engine: result.engine || null,
    languages: result.languages || null,
    confidence: Number.isFinite(result.confidence) ? result.confidence : null,
    error: result.error || null,
    coverage: result.coverage || null
  };
}

function textCharacterCount(text) {
  return (String(text || '').match(/[\p{L}\p{N}]/gu) || []).length;
}

function normalizedBlockText(block) {
  return String(block?.text || '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е');
}

function pageNumberOf(block) {
  const page = Number(block?.locator?.page);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function mergePdfBlocks(nativeBlocks, ocrBlocks) {
  const merged = [];
  const seen = new Set();
  for (const block of [...nativeBlocks, ...ocrBlocks]) {
    const text = normalizedBlockText(block);
    if (!text) continue;
    const page = pageNumberOf(block) || 0;
    const key = `${page}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(block);
  }
  return merged.sort((left, right) => {
    const leftPage = pageNumberOf(left) || 0;
    const rightPage = pageNumberOf(right) || 0;
    if (leftPage !== rightPage) return leftPage - rightPage;
    const leftLine = Number(left?.locator?.line || 0);
    const rightLine = Number(right?.locator?.line || 0);
    return leftLine - rightLine;
  });
}

function pageTextCounts(blocks, pageCount) {
  const counts = new Map();
  for (let page = 1; page <= pageCount; page += 1) counts.set(page, 0);
  for (const block of blocks) {
    const page = pageNumberOf(block);
    if (!page) continue;
    counts.set(page, (counts.get(page) || 0) + textCharacterCount(block.text));
  }
  return counts;
}

async function archiveEntries(path) {
  try {
    const { stdout } = await execFileAsync('unzip', ['-Z1', path], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000
    });
    return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch (error) {
    throw new AppError('archive_unavailable', 'Не удалось открыть офисный документ как ZIP-архив.', 422, {
      command: 'unzip', cause: error.message
    });
  }
}

async function readArchiveEntry(path, entry, { optional = false } = {}) {
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', path, entry], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 60_000
    });
    return stdout;
  } catch (error) {
    if (optional) return null;
    throw new AppError('archive_entry_unavailable', `Не удалось прочитать ${entry} из офисного документа.`, 422, {
      command: 'unzip', cause: error.message
    });
  }
}

async function extractPdf(path, { ocr = {}, tempDir }) {
  let text = '';
  let blocks = [];
  let extractor = 'pdftotext-layout';
  let version = '3';
  let pageCount = null;

  try {
    const { stdout } = await execFileAsync('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', path, '-'], {
      encoding: 'utf8', maxBuffer: 192 * 1024 * 1024, timeout: 120_000
    });
    pageCount = [...String(stdout).matchAll(/<page\b/gi)].length || null;
    blocks = pdfBboxHtmlToBlocks(stdout);
    if (blocks.length) {
      text = blocksToText(blocks);
      extractor = 'pdftotext-bbox';
    }
  } catch {}

  if (!text) {
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], {
        encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000
      });
      text = cleanupText(stdout);
      if (!blocks.length) blocks = plainTextToBlocks(text);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new AppError(
          'pdf_text_unavailable',
          'PDF не удалось преобразовать в текст: отсутствует pdftotext.',
          422,
          { command: 'pdftotext', cause: error.message }
        );
      }
    }
  }

  const minCharacters = Math.max(1, Number(ocr.minCharacters ?? 40));
  let pages = null;
  if (pageCount && blocks.some((block) => pageNumberOf(block))) {
    const counts = pageTextCounts(blocks, pageCount);
    pages = [...counts.entries()].filter(([, count]) => count < minCharacters).map(([page]) => page);
    if (!pages.length) {
      return {
        text,
        blocks,
        extractor,
        version,
        diagnostics: { ocr: ocrDiagnostic(null) }
      };
    }
  } else if (textCharacterCount(text) >= minCharacters) {
    return {
      text,
      blocks,
      extractor,
      version,
      diagnostics: { ocr: ocrDiagnostic(null) }
    };
  }

  const result = await ocrPdf(path, {
    enabled: ocr.enabled,
    languages: ocr.languages,
    dpi: ocr.dpi,
    maxPages: ocr.maxPages,
    tempDir,
    pages,
    pageCount
  });

  if (result.blocks.length) {
    if (pageCount && pages) {
      const merged = mergePdfBlocks(blocks, result.blocks);
      return {
        text: blocksToText(merged),
        blocks: merged,
        extractor: blocks.length ? 'pdf-native-ocr-hybrid' : 'tesseract-pdf',
        version: blocks.length ? '4' : '1',
        diagnostics: { ocr: ocrDiagnostic(result) }
      };
    }
    return {
      text: cleanupText(result.text),
      blocks: result.blocks,
      extractor: 'tesseract-pdf',
      version: '1',
      diagnostics: { ocr: ocrDiagnostic(result) }
    };
  }

  return {
    text,
    blocks,
    extractor,
    version,
    diagnostics: { ocr: ocrDiagnostic(result) }
  };
}

async function extractXlsx(path) {
  const entries = new Set(await archiveEntries(path));
  const workbookXml = await readArchiveEntry(path, 'xl/workbook.xml');
  const relsXml = await readArchiveEntry(path, 'xl/_rels/workbook.xml.rels', { optional: true });
  const sharedXml = entries.has('xl/sharedStrings.xml')
    ? await readArchiveEntry(path, 'xl/sharedStrings.xml', { optional: true })
    : null;
  const sharedStrings = xlsxSharedStrings(sharedXml);
  const sheets = xlsxWorkbookSheets(workbookXml, relsXml || '');
  const blocks = [];
  for (const sheet of sheets) {
    if (!entries.has(sheet.target)) continue;
    const xml = await readArchiveEntry(path, sheet.target);
    blocks.push(...xlsxWorksheetToBlocks(xml, { sheetName: sheet.name, sharedStrings }));
  }
  if (!blocks.length) {
    throw new AppError('xlsx_cells_unavailable', 'В книге XLSX не найдено текстовых или числовых ячеек.', 422);
  }
  return {
    text: blocksToText(blocks),
    blocks,
    extractor: 'xlsx-ooxml',
    version: '1',
    diagnostics: { ocr: ocrDiagnostic(null) }
  };
}

export async function extractText({ path, format, ocr = {}, tempDir = process.cwd() }) {
  switch (format) {
    case 'text': {
      const content = await readFile(path);
      const text = cleanupText(content.toString('utf8').replace(/^\uFEFF/, ''));
      return {
        text,
        blocks: plainTextToBlocks(text),
        extractor: 'plain-text',
        version: '2',
        diagnostics: { ocr: ocrDiagnostic(null) }
      };
    }
    case 'docx': {
      const xml = await readArchiveEntry(path, 'word/document.xml');
      const blocks = docxXmlToBlocks(xml);
      const text = wordDocumentXmlToText(xml);
      return {
        text,
        blocks: blocks.length ? blocks : plainTextToBlocks(text),
        extractor: 'docx-ooxml',
        version: '2',
        diagnostics: { ocr: ocrDiagnostic(null) }
      };
    }
    case 'odt':
    case 'ods': {
      const xml = await readArchiveEntry(path, 'content.xml');
      const blocks = odtXmlToBlocks(xml);
      const text = odtContentXmlToText(xml);
      return {
        text,
        blocks: blocks.length ? blocks : plainTextToBlocks(text),
        extractor: `${format}-xml`,
        version: '2',
        diagnostics: { ocr: ocrDiagnostic(null) }
      };
    }
    case 'xlsx':
      return extractXlsx(path);
    case 'pdf':
      return extractPdf(path, { ocr, tempDir });
    case 'image': {
      const result = await ocrImage(path, {
        enabled: ocr.enabled,
        languages: ocr.languages,
        dpi: ocr.dpi
      });
      return {
        text: cleanupText(result.text),
        blocks: result.blocks,
        extractor: result.blocks.length ? 'tesseract-image' : 'image-no-text',
        version: '1',
        diagnostics: { ocr: ocrDiagnostic(result) }
      };
    }
    default:
      throw new AppError('unsupported_document_format', 'Формат пока не поддерживается автоматическим разбором.', 422, { format });
  }
}
