import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseTesseractTsv } from '../packages/document-intake/src/ocr.mjs';

const tsv = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t96.0\tКафедра',
  '5\t1\t1\t1\t1\t2\t55\t20\t30\t12\t90.0\tфизики',
  '5\t1\t1\t1\t2\t1\t10\t45\t35\t12\t88.0\tОтчёт'
].join('\n');

test('TSV Tesseract преобразуется в строки с геометрией и уверенностью', () => {
  const result = parseTesseractTsv(tsv);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].text, 'Кафедра физики');
  assert.deepEqual(result.blocks[0].locator, { kind: 'ocr_bbox', page: 1, line: 1 });
  assert.equal(result.blocks[0].geometry.x, 10);
  assert.equal(result.blocks[0].geometry.width, 75);
  assert.equal(result.confidence, 90.5);
});

test('JS OCR использует абсолютную страницу источника, а не локальный page_num TSV', () => {
  const result = parseTesseractTsv(tsv, { page: 3 });
  assert.deepEqual(result.blocks.map((block) => block.locator.page), [3, 3]);
  assert.deepEqual(result.blocks.map((block) => block.locator.line), [1, 2]);
});

test('managed Python OCR использует ту же абсолютную страницу источника', () => {
  const script = resolve('scripts/recognition/ocr.py');
  const program = [
    'import importlib.util, json, sys',
    'spec=importlib.util.spec_from_file_location("kafedra_ocr", sys.argv[1])',
    'mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'result=mod.parse_tsv(sys.stdin.read(), page=3)',
    'print(json.dumps([b["locator"]["page"] for b in result["blocks"]]))'
  ].join('; ');
  const completed = spawnSync('python3', ['-c', program, script], { input: tsv, encoding: 'utf8' });
  assert.equal(completed.status, 0, completed.stderr);
  assert.deepEqual(JSON.parse(completed.stdout), [3, 3]);
});
