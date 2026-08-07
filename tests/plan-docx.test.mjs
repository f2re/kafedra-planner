import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzePlanDocumentXml } from '../packages/plan-docx/src/analyzer.mjs';
import { generatePlanDocumentXml } from '../packages/plan-docx/src/generator.mjs';
import { readDocumentXml } from '../packages/plan-docx/src/ooxml-shared.mjs';
import { rewriteZipArchive, writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import { docxXmlToBlocks, blocksToText } from '../packages/document-intake/src/structure.mjs';
import { extractPlan } from '../packages/plans/src/extractor.mjs';

function paragraph(text, style = '') {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function cell(text, width = 1200) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values, marker = '') {
  return `<w:tr><w:trPr><w:cantSplit/>${marker}</w:trPr>${values.map((value) => cell(value)).join('')}</w:tr>`;
}

function tableXml() {
  const header = row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат', 'Примечание']);
  const sample = row(['1', 'Образец мероприятия', '15 сентября 2026', 'Иванов Иван Иванович', 'Протокол', 'Старое примечание'], '<w:tblHeader w:val="0"/>');
  const footer = '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="6"/></w:tcPr><w:p><w:r><w:t>Подпись заведующего кафедрой</w:t></w:r></w:p></w:tc></w:tr>';
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid>${Array.from({ length: 6 }, () => '<w:gridCol w:w="1200"/>').join('')}</w:tblGrid>${header}${sample}${footer}</w:tbl>`;
}

function documentXml({ duplicateTable = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph('ПЛАН РАБОТЫ КАФЕДРЫ', 'Title')}
<w:p><w:r><w:t>на </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>2026</w:t></w:r><w:r><w:t>/</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>2027</w:t></w:r><w:r><w:t> учебный год</w:t></w:r></w:p>
${tableXml()}${duplicateTable ? tableXml() : ''}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body></w:document>`;
}

function contentTypes() {
  return '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
}

function packageRels() {
  return '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
}

test('анализирует DOCX-шаблон, меняет учебный год и клонирует стиль строки', () => {
  const xml = documentXml();
  const analysis = analyzePlanDocumentXml(xml, { planKind: 'department' });
  assert.equal(analysis.ready, true);
  assert.deepEqual(analysis.detectedPeriod, { kind: 'academic', yearStart: 2026, yearEnd: 2027 });
  assert.equal(analysis.suggestedConfig.tableIndex, 1);
  assert.equal(analysis.suggestedConfig.templateRow, 2);
  assert.equal(analysis.suggestedConfig.columns.title, 2);
  assert.equal(analysis.suggestedConfig.columns.description, 6);

  const generated = generatePlanDocumentXml(xml, {
    config: analysis.suggestedConfig,
    targetPeriod: { periodKind: 'academic', periodKey: '2027/28' },
    items: [
      {
        title: 'Заседание <кафедры> & утверждение плана',
        startsAt: '2027-09-18', responsibleRaw: 'Иванов Иван Иванович',
        expectedResult: 'Протокол № 1', description: 'Очное заседание', direction: 'organizational'
      },
      {
        title: 'Подготовить отчёт по НИР', dueDate: '2027-10-20',
        responsibleRaw: 'Петров Пётр Петрович', expectedResult: 'Отчёт', direction: 'science'
      }
    ]
  });
  assert.match(generated.xml, /2027<\/w:t><\/w:r><w:r><w:t>\/<\/w:t><\/w:r><w:r><w:rPr><w:b\/><\/w:rPr><w:t>2028/);
  assert.doesNotMatch(generated.xml, /Образец мероприятия/);
  assert.match(generated.xml, /Заседание &lt;кафедры&gt; &amp; утверждение плана/);
  assert.match(generated.xml, /<w:cantSplit\/>/);
  assert.match(generated.xml, /<w:tcW w:w="1200" w:type="dxa"\/>/);
  assert.match(generated.xml, /Подпись заведующего кафедрой/);

  const blocks = docxXmlToBlocks(generated.xml);
  const reparsed = extractPlan({
    text: blocksToText(blocks), blocks, title: 'План работы кафедры', requestedType: 'department_plan'
  });
  assert.equal(reparsed.periodKey, '2027/28');
  assert.equal(reparsed.items.length, 2);
  assert.equal(reparsed.items[0].title, 'Заседание <кафедры> & утверждение плана');
  assert.equal(reparsed.items[0].startsAt, '2027-09-18');
  assert.equal(reparsed.items[0].description, 'Очное заседание');
  assert.equal(reparsed.items[1].dueDate, '2027-10-20');
});

test('не выбирает автоматически две одинаково подходящие таблицы', () => {
  const analysis = analyzePlanDocumentXml(documentXml({ duplicateTable: true }), { planKind: 'department' });
  assert.equal(analysis.ready, false);
  assert.ok(analysis.issues.includes('table_ambiguous'));
  assert.equal(analysis.tableCandidates.length, 2);
});

test('перезаписывает DOCX детерминированным ZIP без внешней команды zip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-docx-'));
  try {
    const source = join(dir, 'template.docx');
    const first = join(dir, 'first.docx');
    const second = join(dir, 'second.docx');
    await writeZipArchive(source, {
      '[Content_Types].xml': contentTypes(),
      '_rels/.rels': packageRels(),
      'word/document.xml': documentXml()
    });
    const analysis = analyzePlanDocumentXml(await readDocumentXml(source), { planKind: 'department' });
    const generated = generatePlanDocumentXml(await readDocumentXml(source), {
      config: analysis.suggestedConfig,
      targetPeriod: { periodKind: 'academic', periodKey: '2028/29' },
      items: [{ title: 'Новый пункт', startsAt: '2028-09-01' }]
    });
    const replacements = new Map([['word/document.xml', Buffer.from(generated.xml)]]);
    await rewriteZipArchive(source, first, replacements);
    await rewriteZipArchive(source, second, replacements);
    assert.deepEqual(await readFile(first), await readFile(second));
    assert.match(await readDocumentXml(first), /2028/);
    assert.match(await readDocumentXml(first), /Новый пункт/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
