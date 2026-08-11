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

export function parseTesseractTsv(tsv, { page = 1 } = {}) {
  const rows = String(tsv || '').replaceAll('\r\n', '\n').split('\n');
  if (rows.length < 2) return { blocks: [], text: '', confidence: null };
  const headers = rows[0].split('\t');
  const index = Object.fromEntries(headers.map((value, position) => [value, position]));
  const groups = new Map();

  for (const row of rows.slice(1)) {
    if (!row.trim()) continue;
    const columns = row.split('\t');
    if (Number(columns[index.level]) !== 5) continue;
    const text = cleanText(columns[index.text]);
    if (!text) continue;
    const pageNumber = Number(columns[index.page_num] || page) || page;
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

  const blocks = raw.map((group, position) => {
    const left = Math.min(...group.words.map((word) => word.left));
    const top = Math.min(...group.words.map((word) => word.top));
    const right = Math.max(...group.words.map((word) => word.left + word.width));
    const bottom = Math.max(...group.words.map((word) => word.top + word.height));
    const confidences = group.words.map((word) => word.confidence).filter((value) => value >= 0);
    const bounds = pageBounds.get(group.page);
    return {
      type: 'ocr_line', text: group.words.map((word) => word.text).join(' '),
      locator: { kind: 'ocr_bbox', page: group.page, line: position + 1 },
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
  if (kind === 'pdf') args.push('--max-pages', String(options.maxPages || 50));
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
  const directory = await mkdtemp(join(options.tempDir, 'ocr-pdf-'));
  try {
    const prefix = join(directory, 'page');
    try {
      await execFileAsync('pdftoppm', ['-png', '-r', String(options.dpi || 250), '-f', '1', '-l', String(options.maxPages || 50), path, prefix], { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      return { status: error?.code === 'ENOENT' ? 'unavailable' : 'failed', engine: 'tesseract', languages: String(options.languages || ''), confidence: null, text: '', blocks: [], error: `pdftoppm:${commandError(error)}` };
    }
    const pages = (await readdir(directory)).filter((name) => /^page-\d+\.png$/i.test(name)).sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]));
    const blocks = []; const pageResults = [];
    for (let index = 0; index < pages.length; index += 1) {
      const result = await runTesseract(join(directory, pages[index]), { languages: options.languages || 'rus+eng', dpi: options.dpi || 250, page: index + 1 });
      pageResults.push(result); blocks.push(...result.blocks); if (result.status === 'unavailable') break;
    }
    const confidences = pageResults.map((item) => item.confidence).filter(Number.isFinite);
    const used = blocks.length > 0; const failed = pageResults.find((item) => ['unavailable', 'failed'].includes(item.status));
    return { status: used ? 'used' : failed?.status || 'empty', engine: 'tesseract', languages: pageResults.find((item) => item.languages)?.languages || String(options.languages || ''), confidence: confidences.length ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2)) : null, text: blocks.map((block) => block.text).join('\n'), blocks, error: used ? null : failed?.error || 'ocr_text_empty' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
