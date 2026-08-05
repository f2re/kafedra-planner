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
      error: null
    };
  }
  return {
    status: result.status,
    engine: result.engine || null,
    languages: result.languages || null,
    confidence: Number.isFinite(result.confidence) ? result.confidence : null,
    error: result.error || null
  };
}

function textCharacterCount(text) {
  return (String(text || '').match(/[\p{L}\p{N}]/gu) || []).length;
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

  try {
    const { stdout } = await execFileAsync('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', path, '-'], {
      encoding: 'utf8', maxBuffer: 192 * 1024 * 1024, timeout: 120_000
    });
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
      blocks = plainTextToBlocks(text);
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

  if (textCharacterCount(text) >= Number(ocr.minCharacters ?? 40)) {
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
    tempDir
  });
  if (result.blocks.length) {
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
