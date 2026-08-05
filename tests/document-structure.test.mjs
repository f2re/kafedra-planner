import test from 'node:test';
import assert from 'node:assert/strict';
import { docxXmlToBlocks, pdfBboxHtmlToBlocks } from '../packages/document-intake/src/structure.mjs';

test('DOCX сохраняет абзацы и адреса ячеек как отдельные доказательства', () => {
  const xml = `<w:document><w:body>
    <w:p><w:r><w:t>Приказ № 17</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Дата</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>05.08.2026</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  const blocks = docxXmlToBlocks(xml);
  assert.equal(blocks[0].locator.kind, 'docx_paragraph');
  assert.equal(blocks.filter((item) => item.type === 'table_cell').length, 2);
  assert.deepEqual(blocks.at(-1).locator, { kind: 'docx_table_cell', table: 1, row: 1, column: 2 });
});

test('PDF bbox сохраняет страницу и геометрию строки', () => {
  const html = `<doc><page width="600" height="800"><flow><block><line xMin="60" yMin="80" xMax="220" yMax="96"><word>Научный</word><word>отчёт</word></line></block></flow></page></doc>`;
  const blocks = pdfBboxHtmlToBlocks(html);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Научный отчёт');
  assert.equal(blocks[0].locator.page, 1);
  assert.equal(blocks[0].geometry.pageWidth, 600);
});
