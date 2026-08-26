import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import {
  analyzeMeetingTemplate,
  analyzeMeetingTemplatePath,
  latestMeetingTemplateProfile,
  renderVisualMeetingTemplateXml,
  replaceVisibleRange,
  saveMeetingTemplateProfile
} from '../packages/protocols/src/meeting-template-profile.mjs';
import { uploadMeetingTemplate } from '../packages/protocols/src/meeting-settings.mjs';

const migrationsDir = resolve('migrations');
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

function paragraph(text, runProperties = '', paragraphProperties = '') {
  return `<w:p>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ''}<w:r>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r></w:p>`;
}

function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function paragraphTemplateXml() {
  return documentXml([
    paragraph('ПРОТОКОЛ', '<w:b/>'),
    paragraph('Протокол № 00'),
    paragraph('Дата: 15 сентября 2026 года'),
    paragraph('Заседание кафедры', '<w:b/><w:sz w:val="28"/>', '<w:jc w:val="center"/>'),
    paragraph('Председатель: Иванов И.И.'),
    paragraph('Секретарь: Петрова А.А.'),
    paragraph('Кворум: 5 человек'),
    paragraph('1. Вопрос повестки', '<w:b/>', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>'),
    paragraph('СЛУШАЛИ: Текст слушали', '<w:i/>'),
    paragraph('ОБСУДИЛИ: Текст обсуждения'),
    paragraph('РЕШИЛИ: Текст решения', '<w:u w:val="single"/>')
  ].join(''));
}

function tableTemplateXml() {
  const globals = [
    paragraph('Протокол № 00'),
    paragraph('Дата: 15 сентября 2026 года'),
    paragraph('Заседание кафедры'),
    paragraph('Председатель: Иванов И.И.'),
    paragraph('Секретарь: Петрова А.А.'),
    paragraph('Кворум: 5 человек')
  ].join('');
  const cell = (text, properties = '') => `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${paragraph(text, properties)}</w:tc>`;
  const row = `<w:tr>${cell('1.', '<w:b/>')}${cell('Вопрос повестки', '<w:b/>')}${cell('СЛУШАЛИ: Текст слушали', '<w:i/>')}${cell('РЕШИЛИ: Текст решения', '<w:u w:val="single"/>')}</w:tr>`;
  return documentXml(`${globals}<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>${row}</w:tbl>`);
}

async function writeDocx(path, xml) {
  await writeZipArchive(path, {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': RELS,
    'word/document.xml': xml
  });
}

function values() {
  return {
    globals: {
      protocol_number: '17',
      meeting_date: '26 августа 2026 года',
      meeting_title: 'Заседание кафедры прикладной метеорологии',
      chairperson: 'Сидоров Сергей Сергеевич',
      secretary: 'Иванова Анна Андреевна',
      quorum: '9 человек'
    },
    agenda: [
      { item_no: '1', title: 'Об утверждении плана', heard: 'Доклад заведующего', discussed: 'Замечаний нет', decision: 'Утвердить план' },
      { item_no: '2', title: 'О научной работе', heard: 'Доклад секретаря', discussed: 'Предложения учтены', decision: 'Принять к сведению' }
    ]
  };
}

test('замена диапазона через несколько run сохраняет форматирование первого run', () => {
  const xml = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>12</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>34</w:t></w:r></w:p>';
  const rendered = replaceVisibleRange(xml, 1, 3, 'ABCD');
  assert.match(rendered, /<w:b\/>/u);
  assert.match(rendered, /<w:i\/>/u);
  assert.match(rendered, /1ABCD/u);
  assert.match(rendered, /4/u);
});

test('визуальный анализ предлагает обязательные поля и сохраняет стили абзацев', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-profile-analysis-'));
  const path = join(root, 'protocol.docx');
  try {
    await writeDocx(path, paragraphTemplateXml());
    const analysis = await analyzeMeetingTemplatePath(path, 'fixture-sha');
    assert.equal(analysis.legacyReady, false);
    assert.equal(analysis.suggestions.length, 11);
    assert.equal(new Set(analysis.suggestions.map((item) => item.field)).size, 11);
    const title = analysis.elements.find((element) => element.text === 'Заседание кафедры');
    assert.equal(title.style.alignment, 'center');
    assert.equal(title.runs[0].style.bold, true);
    assert.equal(title.runs[0].style.fontSizePt, 14);
    const agenda = analysis.elements.find((element) => element.text.startsWith('1. Вопрос'));
    assert.deepEqual(agenda.style.numbering, { numId: 7, level: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('диапазон абзацев повторяется для двух вопросов без потери rPr и numPr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-profile-paragraphs-'));
  const path = join(root, 'protocol.docx');
  try {
    const xml = paragraphTemplateXml();
    await writeDocx(path, xml);
    const analysis = await analyzeMeetingTemplatePath(path, 'fixture-sha');
    const bindings = analysis.suggestions;
    const profile = {
      status: 'ready',
      bindings,
      repeat: { kind: 'paragraph_range', startParagraphIndex: 8, endParagraphIndex: 11 }
    };
    const data = values();
    const rendered = renderVisualMeetingTemplateXml(xml, profile, data.globals, data.agenda);
    assert.match(rendered, /Заседание кафедры прикладной метеорологии/u);
    assert.match(rendered, /Об утверждении плана/u);
    assert.match(rendered, /О научной работе/u);
    assert.match(rendered, /Доклад заведующего/u);
    assert.match(rendered, /Принять к сведению/u);
    assert.equal((rendered.match(/<w:numPr>/gu) || []).length, 2);
    assert.ok((rendered.match(/<w:b\/>/gu) || []).length >= 3);
    assert.equal((rendered.match(/<w:i\/>/gu) || []).length, 2);
    assert.equal((rendered.match(/<w:u w:val="single"\/>/gu) || []).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('строка таблицы повторяется для двух вопросов и сохраняет оформление ячеек', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-profile-table-'));
  const path = join(root, 'protocol.docx');
  try {
    const xml = tableTemplateXml();
    await writeDocx(path, xml);
    const analysis = await analyzeMeetingTemplatePath(path, 'fixture-sha');
    const bindings = analysis.suggestions;
    assert.equal(bindings.filter((binding) => ['item_no', 'title', 'heard', 'decision'].includes(binding.field)).length, 4);
    const profile = { status: 'ready', bindings, repeat: { kind: 'table_row', tableIndex: 1, rowIndex: 1 } };
    const data = values();
    const rendered = renderVisualMeetingTemplateXml(xml, profile, data.globals, data.agenda);
    assert.equal((rendered.match(/<w:tr>/gu) || []).length, 2);
    assert.equal((rendered.match(/<w:tcW w:w="1800"/gu) || []).length, 8);
    assert.match(rendered, /Об утверждении плана/u);
    assert.match(rendered, /О научной работе/u);
    assert.equal((rendered.match(/<w:i\/>/gu) || []).length, 2);
    assert.equal((rendered.match(/<w:u w:val="single"\/>/gu) || []).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('профиль сохраняется как неизменяемая редакция и повторный запрос не создаёт дубль', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-profile-storage-'));
  const databasePath = join(root, 'database.sqlite3');
  const blobDir = join(root, 'blobs');
  const tempDir = join(root, 'tmp');
  const templatePath = join(root, 'protocol.docx');
  const database = new Database(databasePath, { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    await writeDocx(templatePath, paragraphTemplateXml());
    const uploaded = await uploadMeetingTemplate(database, { blobDir, tempDir, maxUploadBytes: 20 * 1024 * 1024 }, workspace.id, createReadStream(templatePath), {
      kind: 'protocol', originalName: 'Обычный протокол.docx'
    });
    assert.equal(uploaded.structure_status, 'meeting_template_visual');
    const analysis = await analyzeMeetingTemplate(database, workspace.id, uploaded.version_id, 'protocol');
    const first = await saveMeetingTemplateProfile(
      database,
      { blobDir, tempDir, maxUploadBytes: 20 * 1024 * 1024 },
      workspace.id,
      uploaded.version_id,
      'protocol',
      { structureSha256: analysis.structureSha256, bindings: analysis.suggestions }
    );
    assert.equal(first.status, 'ready');
    assert.deepEqual(first.repeat, { kind: 'paragraph_range', startParagraphIndex: 8, endParagraphIndex: 11 });
    const second = await saveMeetingTemplateProfile(
      database,
      { blobDir, tempDir, maxUploadBytes: 20 * 1024 * 1024 },
      workspace.id,
      uploaded.version_id,
      'protocol',
      { structureSha256: analysis.structureSha256, bindings: analysis.suggestions }
    );
    assert.equal(second.duplicateRequest, true);
    assert.equal(second.profile_version_id, first.profile_version_id);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM documents WHERE document_type = 'meeting_template_profile'").n, 1);
    assert.equal(latestMeetingTemplateProfile(database, workspace.id, uploaded.version_id, 'protocol', true).profileSha256, first.profileSha256);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
