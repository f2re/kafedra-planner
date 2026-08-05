import test from 'node:test';
import assert from 'node:assert/strict';
import { xlsxSharedStrings, xlsxWorkbookSheets, xlsxWorksheetToBlocks } from '../packages/document-intake/src/structure.mjs';

test('XLSX связывает имя листа, shared strings и адрес ячейки', () => {
  const workbook = `<workbook><sheets><sheet name="Показатели" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
  const strings = xlsxSharedStrings(`<sst><si><t>Публикации ВАК</t></si></sst>`);
  const sheets = xlsxWorkbookSheets(workbook, rels);
  const blocks = xlsxWorksheetToBlocks(`<worksheet><sheetData><row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2"><v>12</v></c></row></sheetData></worksheet>`, {
    sheetName: sheets[0].name,
    sharedStrings: strings
  });
  assert.equal(sheets[0].target, 'xl/worksheets/sheet1.xml');
  assert.equal(blocks[0].text, 'Публикации ВАК');
  assert.deepEqual(blocks[0].locator, { kind: 'xlsx_cell', sheet: 'Показатели', cell: 'B2' });
  assert.equal(blocks[1].text, '12');
});
