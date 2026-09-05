import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function commandError(error) {
  if (error?.code === 'ENOENT') return 'command_not_found';
  return String(error?.stderr || error?.message || error || 'ocr_failed').trim();
}

function languageCandidates(languages) {
  const requested = String(languages || 'rus+eng').trim();
  const candidates = [requested];
  if (requested.includes('+')) candidates.push(requested.split('+')[0], 'eng');
  else if (requested !== 'eng') candidates.push('eng');
  return [...new Set(candidates.filter(Boolean))];
}

function pageList(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(Number).filter((page) => Number.isInteger(page) && page > 0))].sort((a, b) => a - b);
}

function coverageFor({ requestedPages = [], attemptedPages = [], recognizedPages = [], emptyPages = [], failedPages = [], skippedPages = [], totalPages = null, truncated = false }) {
  return {
    requestedPages,
    attemptedPages,
    recognizedPages,
    emptyPages,
    failedPages,
    skippedPages,
    totalPages: Number.isInteger(totalPages) && totalPages > 0 ? totalPages : null,
    truncated: Boolean(truncated),
    complete: failedPages.length === 0 && skippedPages.length === 0 && !truncated
  };
}

export function parseTesseractTsv(tsv, { page = 1 } = {}) {
  const rows = String(tsv || '').replaceAll('\r\n', '\n').split('\n');
  if (rows.length < 2) return { blocks: [], text: '', confidence: null };
  const headers = rows[0].split('\t');
  const index = Object.fromEntries(headers.map((value, position) => [value, position]));
  const groups = new Map();
  const absolutePage = Number(page) || 1;

  for (const row of rows.slice(1)) {
    if (!row.trim()) continue;
    const columns = row.split('\t');
    if (Number(columns[index.level]) !== 5) continue;
    const text = cleanText(columns[index.text]);
    if (!text) continue;
    const pageNumber = absolutePage;
    const key = [pageNumber, columns[index.block_num] || 0, columns[index.par_num] || 0, columns[index.line_num] || 0].join(':');
    const word = {
      text,
      left: Number(columns[index.left] || 0), top: Number(columns[index.top] || 0),
      width: Number(columns[index.width] || 0), height: Number(columns[index.height] || 0),
      confidence: Number(columns[index.conf] || -1)
    };
    if (!groups.has(key)) groups.set(key, { page: pageNumber, words: [] });
    groups.get(key).words.push(word);
  }

  const raw = [...groups.values()];
  const pageBounds = new Map();
  for (const group of raw) {
    const current = pageBounds.get(group.page) || { width: 1, height: 1 };
    for (const word of group.words) {
      current.width = Math.max(current.width, word.left + word.width);
      current.height = Math.max(current.height, word.top + word.height);
    }
    pageBounds.set(group.page, current);
  }

  const pageLines = new Map();
  const blocks = raw.map((group) => {
    const left = Math.min(...group.words.map((word) => word.left));
    const top = Math.min(...group.words.map((word) => word.top));
    const right = Math.max(...group.words.map((word) => word.left + word.width));
    const bottom = Math.max(...group.words.map((word) => word.top + word.height));
    const confidences = group.words.map((word) => word.confidence).filter((value) => value >= 0);
    const bounds = pageBounds.get(group.page);
    const line = (pageLines.get(group.page) || 0) + 1;
    pageLines.set(group.page, line);
    return {
      type: 'ocr_line', text: group.words.map((word) => word.text).join(' '),
      locator: { kind: 'ocr_bbox', page: group.page, line },
      geometry: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), pageWidth: bounds.width, pageHeight: bounds.height },
      metadata: { ocr: true, confidence: confidences.length ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2)) : null }
    };
  });
  const confidenceValues = blocks.map((block) => block.metadata.confidence).filter(Number.isFinite);
  return { blocks, text: blocks.map((block) => block.text).join('\n'), confidence: confidenceValues.length ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2)) : null };
}

async function runManagedRecognition(kind, path, options) {
  const backend = String(options.backend || process.env.KAFEDRA_OCR_BACKEND || 'auto').toLowerCase();
  if (backend === 'direct') return null;
  const pythonBin = String(options.pythonBin || process.env.KAFEDRA_RECOGNITION_PYTHON || '').trim();
  const pythonScript = String(options.pythonScript || process.env.KAFEDRA_RECOGNITION_SCRIPT || '').trim();
  if (!pythonBin || !pythonScript) return backend === 'python' ? {
    status: 'unavailable', engine: 'tesseract-python', languages: String(options.languages || ''), confidence: null, text: '', blocks: [], error: 'managed_python_not_configured'
  } : null;
  const args = [pythonScript, kind, path, '--languages', String(options.languages || 'rus+eng'), '--dpi', String(options.dpi || 250)];
  if (kind === 'pdf') {
    args.push('--max-pages', String(options.maxPages || 50));
    const pages = pageList(options.pages);
    if (pages?.length) args.push('--pages', pages.join(','));
  }
  try {
    const { stdout } = await execFileAsync(pythonBin, args, { encoding: 'utf8', timeout: kind === 'pdf' ? 600_000 : 240_000, maxBuffer: 256 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!result || typeof result !== 'object' || !Array.isArray(result.blocks)) throw new Error('managed_ocr_invalid_json');
    return result;
  } catch (error) {
    if (backend === 'auto' && (error?.code === 'ENOENT' || /managed_ocr_invalid_json/u.test(String(error?.message)))) return null;
    return { status: error?.code === 'ENOENT' ? 'unavailable' : 'failed', engine: 'tesseract-python', languages: String(options.languages || ''), confidence: null, text: '', blocks: [], error: `python:${commandError(error)}` };
  }
}

async function runTesseract(path, { languages, dpi, page = 1 }) {
  let lastError = null;
  for (const language of languageCandidates(languages)) {
    try {
      const { stdout } = await execFileAsync('tesseract', [path, 'stdout', '-l', language, '--dpi', String(dpi), 'tsv'], { encoding: 'utf8', timeout: 180_000, maxBuffer: 128 * 1024 * 1024 });
      const parsed = parseTesseractTsv(stdout, { page });
      return { status: parsed.blocks.length ? 'used' : 'empty', engine: 'tesseract', languages: language, confidence: parsed.confidence, text: parsed.text, blocks: parsed.blocks, error: parsed.blocks.length ? null : 'ocr_text_empty' };
    } catch (error) { lastError = error; if (error?.code === 'ENOENT') break; }
  }
  return { status: lastError?.code === 'ENOENT' ? 'unavailable' : 'failed', engine: 'tesseract', languages: String(languages || ''), confidence: null, text: '', blocks: [], error: commandError(lastError) };
}

export async function ocrImage(path, options = {}) {
  if (options.enabled === false) return { status: 'disabled', engine: null, languages: String(options.languages || ''), confidence: null, text: '', blocks: [], error: null };
  const managed = await runManagedRecognition('image', path, options);
  if (managed) return managed;
  return runTesseract(path, { languages: options.languages || 'rus+eng', dpi: options.dpi || 250, page: options.page || 1 });
}

export async function ocrPdf(path, options = {}) {
  if (options.enabled === false) return { status: 'disabled', engine: null, languages: String(options.languages || ''), confidence: null, text: '', blocks: [], error: null };
  const managed = await runManagedRecognition('pdf', path, options);
  if (managed) return managed;

  const maxPages = Math.max(1, Number(options.maxPages || 50));
  const requested = pageList(options.pages);
  const directory = await mkdtemp(join(options.tempDir, 'ocr-pdf-'));
  try {
    const prefix = join(directory, 'page');
    const renderLimit = maxPages + 1;
    try {
      await execFileAsync('pdftoppm', ['-png', '-r', String(options.dpi || 250), '-f', '1', '-l', String(renderLimit), path, prefix], { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      return { status: error?.code === 'ENOENT' ? 'unavailable' : 'failed', engine: 'tesseract', languages: String(options.languages || ''), confidence: null, text: '', blocks: [], error: `pdftoppm:${commandError(error)}` };
    }

    const rendered = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .map((name) => ({ name, page: Number(name.match(/(\d+)/)?.[1]) }))
      .filter((item) => Number.isInteger(item.page))
      .sort((a, b) => a.page - b.page);
    const renderedPages = new Set(rendered.map((item) => item.page));
    const knownPageCount = Number(options.pageCount);
    const totalPages = Number.isInteger(knownPageCount) && knownPageCount > 0
      ? knownPageCount
      : (rendered.length <= maxPages ? rendered.length : null);
    const requestedPages = requested || rendered.filter((item) => item.page <= maxPages).map((item) => item.page);
    const skippedPages = requestedPages.filter((page) => page > maxPages || !renderedPages.has(page));
    const truncated = !requested && (
      (Number.isInteger(totalPages) && totalPages > maxPages)
      || rendered.some((item) => item.page > maxPages)
    );
    const pagesToRun = rendered.filter((item) => item.page <= maxPages && requestedPages.includes(item.page));

    const blocks = [];
    const pageResults = [];
    for (const item of pagesToRun) {
      const result = await runTesseract(join(directory, item.name), {
        languages: options.languages || 'rus+eng', dpi: options.dpi || 250, page: item.page
      });
      pageResults.push({ page: item.page, ...result });
      blocks.push(...result.blocks);
      if (result.status === 'unavailable') break;
    }

    const confidences = pageResults.map((item) => item.confidence).filter(Number.isFinite);
    const recognizedPages = pageResults.filter((item) => item.status === 'used').map((item) => item.page);
    const emptyPages = pageResults.filter((item) => item.status === 'empty').map((item) => item.page);
    const failedPages = pageResults
      .filter((item) => ['unavailable', 'failed'].includes(item.status))
      .map((item) => ({ page: item.page, status: item.status, error: item.error || null }));
    const coverage = coverageFor({
      requestedPages,
      attemptedPages: pageResults.map((item) => item.page),
      recognizedPages,
      emptyPages,
      failedPages,
      skippedPages,
      totalPages,
      truncated
    });
    const incomplete = !coverage.complete;
    const used = blocks.length > 0;
    const successfulPages = recognizedPages.length + emptyPages.length;
    const firstFailure = pageResults.find((item) => ['unavailable', 'failed'].includes(item.status));
    const status = incomplete
      ? (successfulPages > 0 ? 'partial' : firstFailure?.status || 'partial')
      : used ? 'used' : firstFailure?.status || 'empty';
    const errorParts = [
      ...failedPages.map((item) => `page ${item.page}: ${item.error || item.status}`),
      ...(skippedPages.length ? [`pages outside OCR limit: ${skippedPages.join(',')}`] : []),
      ...(truncated ? [`document has pages after OCR limit ${maxPages}`] : [])
    ];
    return {
      status,
      engine: 'tesseract',
      languages: pageResults.find((item) => item.languages)?.languages || String(options.languages || ''),
      confidence: confidences.length ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2)) : null,
      text: blocks.map((block) => block.text).join('\n'),
      blocks,
      coverage,
      error: incomplete ? errorParts.join('; ') || 'ocr_partial' : used ? null : firstFailure?.error || 'ocr_text_empty'
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
