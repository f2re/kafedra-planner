import test from 'node:test';
import assert from 'node:assert/strict';
import { wordDocumentXmlToText } from '../packages/document-intake/src/xml-text.mjs';

test('извлекает абзацы и таблицу DOCX XML', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Протокол &amp; решение</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ячейка</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const text = wordDocumentXmlToText(xml);
  assert.match(text, /Протокол & решение/);
  assert.match(text, /Ячейка/);
});
