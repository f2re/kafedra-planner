import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ocrPdf } from '../packages/document-intake/src/ocr.mjs';
import { extractText } from '../packages/document-intake/src/extract-text.mjs';

async function fakeOcrTools(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-ocr-tools-'));
  const bin = join(dir, 'bin');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
  const pdftoppm = `#!/bin/sh
limit=50
prev=''
for arg in "$@"; do
  if [ "$prev" = '-l' ]; then limit="$arg"; fi
  prev="$arg"
done
prefix="${'${!#}'}"
pages="${'${FAKE_PDF_PAGES:-3}'}"
i=1
while [ "$i" -le "$limit" ] && [ "$i" -le "$pages" ]; do
  : > "${'${prefix}'}-${'${i}'}.png"
  i=$((i+1))
done
`;
  const tesseract = `#!/bin/sh
input="$1"
page=$(basename "$input" | sed -n 's/^page-\\([0-9][0-9]*\\)\\.png$/\\1/p')
if [ -n "$FAIL_PAGE" ] && [ "$page" = "$FAIL_PAGE" ]; then
  echo "simulated OCR failure" >&2
  exit 2
fi
cat <<EOF
level	page_num	block_num	par_num	line_num	word_num	left	top	width	height	conf	text
5	1	1	1	1	1	10	20	40	12	95.0	OCR-${'${page}'}
EOF
`;
  const pdftotext = `#!/bin/sh
case " $* " in
  *' -bbox-layout '*)
    cat <<'EOF'
<doc>
  <page width="600" height="800">
    <flow><block><line xMin="10" yMin="20" xMax="300" yMax="40"><word>Текстовая</word><word>обложка</word><word>содержит</word><word>достаточно</word><word>полезного</word><word>текста</word></line></block></flow>
  </page>
  <page width="600" height="800"></page>
</doc>
EOF
    ;;
  *) printf '%s\n' 'Текстовая обложка содержит достаточно полезного текста' ;;
esac
`;
  await Promise.all([
    writeFile(join(bin, 'pdftoppm'), pdftoppm),
    writeFile(join(bin, 'tesseract'), tesseract),
    writeFile(join(bin, 'pdftotext'), pdftotext)
  ]);
  await Promise.all([
    chmod(join(bin, 'pdftoppm'), 0o755),
    chmod(join(bin, 'tesseract'), 0o755),
    chmod(join(bin, 'pdftotext'), 0o755)
  ]);
  const previous = {
    PATH: process.env.PATH,
    backend: process.env.KAFEDRA_OCR_BACKEND,
    pages: process.env.FAKE_PDF_PAGES,
    fail: process.env.FAIL_PAGE
  };
  process.env.PATH = `${bin}:${previous.PATH || ''}`;
  process.env.KAFEDRA_OCR_BACKEND = 'direct';
  try {
    await run(dir);
  } finally {
    if (previous.PATH === undefined) delete process.env.PATH; else process.env.PATH = previous.PATH;
    if (previous.backend === undefined) delete process.env.KAFEDRA_OCR_BACKEND; else process.env.KAFEDRA_OCR_BACKEND = previous.backend;
    if (previous.pages === undefined) delete process.env.FAKE_PDF_PAGES; else process.env.FAKE_PDF_PAGES = previous.pages;
    if (previous.fail === undefined) delete process.env.FAIL_PAGE; else process.env.FAIL_PAGE = previous.fail;
    await rm(dir, { recursive: true, force: true });
  }
}

test('постраничный OCR сохраняет абсолютные locators 1/2/3', () => fakeOcrTools(async (dir) => {
  process.env.FAKE_PDF_PAGES = '3';
  const result = await ocrPdf(join(dir, 'scan.pdf'), {
    backend: 'direct', enabled: true, languages: 'eng', dpi: 100, maxPages: 3, tempDir: dir
  });
  assert.equal(result.status, 'used');
  assert.deepEqual(result.blocks.map((block) => block.locator.page), [1, 2, 3]);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.truncated, false);
}));

test('сбой одной страницы сохраняет хорошие страницы и даёт partial coverage', () => fakeOcrTools(async (dir) => {
  process.env.FAKE_PDF_PAGES = '3';
  process.env.FAIL_PAGE = '2';
  const result = await ocrPdf(join(dir, 'scan.pdf'), {
    backend: 'direct', enabled: true, languages: 'eng', dpi: 100, maxPages: 3, tempDir: dir
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.blocks.map((block) => block.locator.page), [1, 3]);
  assert.deepEqual(result.coverage.failedPages.map((item) => item.page), [2]);
  assert.equal(result.coverage.complete, false);
}));

test('лимит страниц не выдаётся за полный OCR', () => fakeOcrTools(async (dir) => {
  process.env.FAKE_PDF_PAGES = '3';
  const result = await ocrPdf(join(dir, 'long.pdf'), {
    backend: 'direct', enabled: true, languages: 'eng', dpi: 100, maxPages: 2, tempDir: dir
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.blocks.map((block) => block.locator.page), [1, 2]);
}));

test('текстовая обложка не выключает OCR сканированной следующей страницы', () => fakeOcrTools(async (dir) => {
  process.env.FAKE_PDF_PAGES = '2';
  const source = join(dir, 'mixed.pdf');
  await writeFile(source, 'fake pdf input');
  const result = await extractText({
    path: source,
    format: 'pdf',
    tempDir: dir,
    ocr: { enabled: true, languages: 'eng', dpi: 100, maxPages: 10, minCharacters: 20 }
  });
  assert.equal(result.extractor, 'pdf-native-ocr-hybrid');
  assert.ok(result.blocks.some((block) => block.locator?.page === 1 && block.text.includes('Текстовая')));
  assert.ok(result.blocks.some((block) => block.locator?.page === 2 && block.text === 'OCR-2'));
  assert.equal(result.diagnostics.ocr.coverage.complete, true);
}));
