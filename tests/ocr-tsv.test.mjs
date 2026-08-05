import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTesseractTsv } from '../packages/document-intake/src/ocr.mjs';

test('TSV Tesseract преобразуется в строки с геометрией и уверенностью', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t96.0\tКафедра',
    '5\t1\t1\t1\t1\t2\t55\t20\t30\t12\t90.0\tфизики',
    '5\t1\t1\t1\t2\t1\t10\t45\t35\t12\t88.0\tОтчёт'
  ].join('\n');
  const result = parseTesseractTsv(tsv);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].text, 'Кафедра физики');
  assert.deepEqual(result.blocks[0].locator, { kind: 'ocr_bbox', page: 1, line: 1 });
  assert.equal(result.blocks[0].geometry.x, 10);
  assert.equal(result.blocks[0].geometry.width, 75);
  assert.equal(result.confidence, 90.5);
});
