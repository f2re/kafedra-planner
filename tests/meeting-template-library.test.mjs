import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import {
  addAgendaItem,
  analyzeMeetingTemplate,
  archiveMeetingTemplateCatalogEntry,
  createMeeting,
  generateMeetingDocument,
  listMeetingTemplateCatalog,
  meetingTemplateImpact,
  registerMeetingTemplateCatalogEntry,
  restoreMeetingTemplateCatalogEntry,
  saveMeetingSettings,
  saveMeetingTemplateProfile,
  setMeetingTemplateDefault,
  syncMeetingTemplateCatalog,
  testMeetingTemplateCatalogEntry,
  uploadMeetingTemplate
} from '../packages/protocols/src/meetings.mjs';
import { enrichMeetingDocumentTemplateMetadata } from '../packages/protocols/src/meeting-document-metadata.mjs';

const migrationsDir = resolve('migrations');
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

function paragraph(text, runProperties = '', paragraphProperties = '') {
  return `<w:p>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ''}<w:r>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r></w:p>`;
}

function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function legacyXml(kind) {
  return documentXml([
    paragraph(kind),
    paragraph('Протокол № {{PROTOCOL_NUMBER}}'),
    paragraph('{{MEETING_DATE}}'),
    paragraph('Председатель: {{CHAIRPERSON}}'),
    paragraph('Секретарь: {{SECRETARY}}'),
    paragraph('Кворум: {{QUORUM}}'),
    paragraph('{{AGENDA}}')
  ].join(''));
}

function visualXml(label = 'Заседание кафедры') {
  return documentXml([
    paragraph('ПРОТОКОЛ', '<w:b/>'),
    paragraph('Протокол № 00'),
    paragraph('Дата: 15 сентября 2026 года'),
    paragraph(label, '<w:b/><w:sz w:val="28"/>', '<w:jc w:val="center"/>'),
    paragraph('Председатель: Иванов И.И.'),
    paragraph('Секретарь: Петрова А.А.'),
    paragraph('Кворум: 5 человек'),
    paragraph('1. Вопрос повестки', '<w:b/>', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>'),
    paragraph('СЛУШАЛИ: Текст слушали', '<w:i/>'),
    paragraph('ОБСУДИЛИ: Текст обсуждения'),
    paragraph('РЕШИЛИ: Текст решения', '<w:u w:val="single"/>')
  ].join(''));
}

async function writeDocx(path, xml) {
  await writeZipArchive(path, {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': RELS,
    'word/document.xml': xml
  });
}

function assertCode(expected) {
  return (error) => {
    assert.equal(String(error?.code || error?.message), expected);
    return true;
  };
}

async function upload(database, config, workspaceId, path, kind, originalName) {
  return uploadMeetingTemplate(database, config, workspaceId, createReadStream(path), { kind, originalName });
}

test('библиотека версий сохраняет старые заседания, основной шаблон, тесты и обратимый архив', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-template-library-'));
  const database = new Database(join(root, 'database.sqlite3'), { migrationsDir });
  const config = {
    blobDir: join(root, 'blobs'), tempDir: join(root, 'tmp'),
    maxUploadBytes: 20 * 1024 * 1024, previewEnabled: false
  };
  const legacyProtocolPath = join(root, 'legacy-protocol.docx');
  const legacyExtractPath = join(root, 'legacy-extract.docx');
  const visualProtocolPath = join(root, 'visual-protocol.docx');
  try {
    await writeDocx(legacyProtocolPath, legacyXml('ПРОТОКОЛ'));
    await writeDocx(legacyExtractPath, legacyXml('ВЫПИСКА ИЗ ПРОТОКОЛА'));
    await writeDocx(visualProtocolPath, visualXml('Заседание кафедры · новая форма'));
    const workspace = ensureDefaultWorkspace(database);
    const chair = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович', position: 'заведующий кафедрой' });
    const secretary = createPerson(database, workspace.id, { displayName: 'Петрова Анна Сергеевна', position: 'секретарь' });

    const legacyProtocol = await upload(database, config, workspace.id, legacyProtocolPath, 'protocol', 'Протокол 2025.docx');
    const legacyExtract = await upload(database, config, workspace.id, legacyExtractPath, 'extract', 'Выписка 2025.docx');
    saveMeetingSettings(database, workspace.id, {
      protocolTemplateVersionId: legacyProtocol.version_id,
      extractTemplateVersionId: legacyExtract.version_id,
      quorum: 5,
      chairpersonPersonId: chair.id,
      secretaryPersonId: secretary.id
    });

    let catalog = listMeetingTemplateCatalog(database, workspace.id, { includeArchived: true });
    const oldProtocol = catalog.find((item) => item.document_version_id === legacyProtocol.version_id && item.document_kind === 'protocol');
    const oldExtract = catalog.find((item) => item.document_version_id === legacyExtract.version_id && item.document_kind === 'extract');
    assert.equal(oldProtocol.readiness, 'legacy_compatible');
    assert.equal(oldProtocol.is_default, 1);
    assert.equal(oldExtract.is_default, 1);

    const meeting = createMeeting(database, workspace.id, {
      meetingDate: '2026-11-10', protocolNumber: '91', title: 'Заседание до смены шаблона'
    });
    addAgendaItem(database, workspace.id, meeting.id, {
      title: 'Об утверждении годового плана',
      heardText: 'Доклад заведующего',
      decisionText: 'Утвердить план'
    });

    const visual = await upload(database, config, workspace.id, visualProtocolPath, 'protocol', 'Протокол 2026.docx');
    const versionTwo = registerMeetingTemplateCatalogEntry(database, workspace.id, visual, {
      kind: 'protocol', seriesId: oldProtocol.series_id, displayName: oldProtocol.display_name
    });
    assert.equal(versionTwo.version_no, 2);
    assert.equal(versionTwo.readiness, 'needs_setup');

    const analysis = await analyzeMeetingTemplate(database, workspace.id, visual.version_id, 'protocol');
    const profile = await saveMeetingTemplateProfile(database, config, workspace.id, visual.version_id, 'protocol', {
      structureSha256: analysis.structureSha256,
      bindings: analysis.suggestions
    });
    assert.equal(profile.status, 'ready');
    syncMeetingTemplateCatalog(database, workspace.id, visual.version_id, 'protocol');
    catalog = listMeetingTemplateCatalog(database, workspace.id, { includeArchived: true });
    const newProtocol = catalog.find((item) => item.document_version_id === visual.version_id);
    assert.equal(newProtocol.readiness, 'ready');
    assert.equal(newProtocol.version_no, 2);

    const testRun = await testMeetingTemplateCatalogEntry(database, config, workspace.id, newProtocol.id);
    assert.equal(testRun.preview_status, 'disabled');
    assert.ok(testRun.generated_document_id);
    assert.match(testRun.originalUrl, /variant=original/u);
    assert.match(testRun.analysis.text, /Первый проверочный вопрос/u);
    assert.match(testRun.analysis.text, /Второй проверочный вопрос/u);
    const repeated = await testMeetingTemplateCatalogEntry(database, config, workspace.id, newProtocol.id);
    assert.equal(repeated.duplicateRequest, true);
    assert.equal(repeated.id, testRun.id);

    setMeetingTemplateDefault(database, workspace.id, newProtocol.id);
    assert.equal(database.get('SELECT protocol_template_version_id FROM meeting_settings WHERE workspace_id = ?', workspace.id).protocol_template_version_id, visual.version_id);
    catalog = listMeetingTemplateCatalog(database, workspace.id, { includeArchived: true });
    assert.equal(catalog.find((item) => item.id === newProtocol.id).is_default, 1);
    assert.equal(catalog.find((item) => item.id === oldProtocol.id).is_default, 0);

    const generated = await generateMeetingDocument(database, config, workspace.id, meeting.id, { kind: 'protocol' });
    assert.equal(generated.duplicateRequest, false);
    const detail = database.get('SELECT protocol_template_version_id FROM meetings WHERE id = ?', meeting.id);
    assert.equal(detail.protocol_template_version_id, legacyProtocol.version_id);
    const rawDocuments = database.all('SELECT md.*, d.title, dv.original_name FROM meeting_documents md JOIN documents d ON d.id = md.document_id JOIN document_versions dv ON dv.id = md.document_version_id WHERE md.meeting_id = ?', meeting.id);
    const documents = enrichMeetingDocumentTemplateMetadata(database, rawDocuments);
    assert.equal(documents[0].template_version_no, 1);
    assert.equal(documents[0].template_display_name, oldProtocol.display_name);

    const impact = meetingTemplateImpact(database, workspace.id, oldProtocol.id);
    assert.equal(impact.meetings, 1);
    assert.equal(impact.generatedDocuments, 1);
    await assert.rejects(
      Promise.resolve().then(() => archiveMeetingTemplateCatalogEntry(database, workspace.id, newProtocol.id, { reason: 'Новая форма' })),
      assertCode('meeting_template_default_archive_requires_replacement')
    );
    const archived = archiveMeetingTemplateCatalogEntry(database, workspace.id, newProtocol.id, {
      reason: 'Временно заменён проверенной формой',
      replacementCatalogId: oldProtocol.id
    });
    assert.equal(archived.entry.lifecycle_status, 'archived');
    assert.equal(database.get('SELECT protocol_template_version_id FROM meeting_settings WHERE workspace_id = ?', workspace.id).protocol_template_version_id, legacyProtocol.version_id);
    const restored = restoreMeetingTemplateCatalogEntry(database, workspace.id, newProtocol.id);
    assert.equal(restored.entry.lifecycle_status, 'active');

    assert.equal(database.get("SELECT COUNT(*) AS count FROM meeting_template_test_runs").count, 1);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM documents WHERE document_type = 'meeting_template_test'").count, 1);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
