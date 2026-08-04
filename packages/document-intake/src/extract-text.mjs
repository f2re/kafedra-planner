import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../../core/src/errors.mjs';
import { wordDocumentXmlToText, odtContentXmlToText, cleanupText } from './xml-text.mjs';

const execFileAsync = promisify(execFile);

async function readArchiveEntry(path, entry) {
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', path, entry], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000
    });
    return stdout;
  } catch (error) {
    throw new AppError(
      'archive_entry_unavailable',
      `Не удалось прочитать ${entry} из офисного документа.`,
      422,
      { command: 'unzip', cause: error.message }
    );
  }
}

async function extractPdf(path) {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000
    });
    return cleanupText(stdout);
  } catch (error) {
    throw new AppError(
      'pdf_text_unavailable',
      'PDF не удалось преобразовать в текст. Установите poppler-utils или отправьте документ на OCR.',
      422,
      { command: 'pdftotext', cause: error.message }
    );
  }
}

export async function extractText({ path, format }) {
  switch (format) {
    case 'text': {
      const content = await readFile(path);
      const text = content.toString('utf8').replace(/^\uFEFF/, '');
      return { text: cleanupText(text), extractor: 'plain-text', version: '1' };
    }
    case 'docx': {
      const xml = await readArchiveEntry(path, 'word/document.xml');
      return { text: wordDocumentXmlToText(xml), extractor: 'docx-ooxml', version: '1' };
    }
    case 'odt': {
      const xml = await readArchiveEntry(path, 'content.xml');
      return { text: odtContentXmlToText(xml), extractor: 'odt-xml', version: '1' };
    }
    case 'pdf':
      return { text: await extractPdf(path), extractor: 'pdftotext', version: '1' };
    default:
      throw new AppError('unsupported_document_format', 'Формат пока не поддерживается автоматическим разбором.', 422, { format });
  }
}
