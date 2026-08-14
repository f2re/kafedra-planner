import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { storeGeneratedFile } from '../packages/document-intake/src/blob-store.mjs';
import { writeZipArchive, readZipEntry } from '../packages/plan-docx/src/archive.mjs';
import { wordVisibleText } from '../packages/plan-docx/src/ooxml-shared.mjs';
import {
  addAgendaItem,
  createMeeting,
  deleteAgendaItem,
  generateMeetingDocument,
  getMeeting,
  listAgendaSources,
  listMeetingLinks,
  saveMeetingSettings,
  updateAgendaItem
} from '../packages/protocols/src/meetings.mjs';

function templateXml(title) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>{{DOCUMENT_KIND}}</w:t></w:r></w:p>
<w:p><w:r><w:t>${title}</w:t></w:r></w:p>
<w:p><w:r><w:t>Протокол №{{PROTOCOL_NUMBER}} от {{MEETING_DATE}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Председатель: {{CHAIRPERSON}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Секретарь: {{SECRETARY}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Кворум: {{QUORUM}}</w:t></w:r></w:p>
<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>{{AGENDA}}</w:t></w:r></w:p>
<w:sectPr/></w:body></w:document>`;
}

async function createDocx(path, title) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml(title)
  });
}

async function registerTemplate(database, config, workspaceId, path, id) {
  const blob = await storeGeneratedFile(path, {
    blobDir: config.blobDir,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const now = new Date().toISOString();
  const documentId = `doc_${id}`;
  const versionId = `docv_${id}`;
  database.run(`INSERT OR IGNORE INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES(?,?,?,?,?)`,
    blob.sha256, blob.sizeBytes, blob.mediaType, blob.storagePath, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES(?,?,?,'meeting_template','processed',?,?,?)`,
    documentId, workspaceId, `Шаблон ${id}`, versionId, now, now);
  database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,upload_key,uploaded_at,structure_status,ocr_status,preview_status) VALUES(?,?,1,?,?,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx','processed',?,?, 'generated','not_needed','not_requested')`,
    versionId, documentId, blob.sha256, `${id}.docx`, `template:${id}`, now);
  return { documentId, versionId };
}

function person(database, workspaceId, id, name) {
  const now = new Date().toISOString();
  database.run(`INSERT INTO people(id,workspace_id,display_name,normalized_name,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)`,
    id, workspaceId, name, name.toLocaleLowerCase('ru-RU'), now, now);
}

test('заседание: вопрос из плана → нумерация → выписка 4 и 8 → идемпотентный DOCX', { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kafedra-meeting-workflow-'));
  const config = { blobDir: join(dataDir, 'blobs'), tempDir: join(dataDir, 'tmp') };
  const database = new Database(join(dataDir, 'db.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    person(database, workspace.id, 'person_chair', 'Иванов Иван Иванович');
    person(database, workspace.id, 'person_secretary', 'Петрова Анна Сергеевна');
    const protocolPath = join(dataDir, 'protocol.docx');
    const extractPath = join(dataDir, 'extract.docx');
    await createDocx(protocolPath, 'Заседание кафедры');
    await createDocx(extractPath, 'Выписка');
    const protocolTemplate = await registerTemplate(database, config, workspace.id, protocolPath, 'protocol');
    const extractTemplate = await registerTemplate(database, config, workspace.id, extractPath, 'extract');

    const settings = saveMeetingSettings(database, workspace.id, {
      protocolTemplateVersionId: protocolTemplate.versionId,
      extractTemplateVersionId: extractTemplate.versionId,
      quorum: 7,
      chairpersonPersonId: 'person_chair',
      secretaryPersonId: 'person_secretary'
    }, 'person_secretary');
    assert.equal(settings.quorum, 7);
    assert.equal(settings.secretary_name, 'Петрова Анна Сергеевна');

    const now = new Date().toISOString();
    database.run(`INSERT INTO plans(id,workspace_id,source_document_version_id,plan_kind,period_kind,period_key,year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at) VALUES('plan_science',? ,?,'department','calendar','2026',2026,2026,'План кафедры на 2026 год','active',1,'{}',?,?)`,
      workspace.id, protocolTemplate.versionId, now, now);
    database.run(`INSERT INTO plan_items(id,plan_id,source_item_key,item_no,title,due_date,responsible_raw,direction,expected_result,status,confidence,evidence_json,created_at,updated_at) VALUES('plan_article','plan_science','article','1','Подготовить научную статью о локальном прогнозировании','2026-09-10','Сидоров С.С.','science','Статья','planned',1,'{}',?,?)`, now, now);

    const sources = listAgendaSources(database, workspace.id, 'статью');
    const article = sources.find((item) => item.id === 'plan_article');
    assert.ok(article);
    assert.match(article.questionTitle, /О рассмотрении научной статьи/u);

    let meeting = createMeeting(database, workspace.id, {
      meetingDate: '2026-09-15', protocolNumber: '7', title: 'Заседание кафедры'
    }, 'person_secretary');
    assert.equal(meeting.quorum_required, 7);
    assert.equal(meeting.secretary_raw, 'Петрова Анна Сергеевна');
    assert.equal(database.get("SELECT COUNT(*) AS c FROM calendar_items WHERE source_kind='meeting' AND source_id=?", meeting.id).c, 1);

    meeting = addAgendaItem(database, workspace.id, meeting.id, { sourceKind: 'plan_item', sourceId: 'plan_article' }, 'person_secretary');
    assert.equal(meeting.agenda[0].source_id, 'plan_article');
    assert.match(meeting.agenda[0].title, /научной статьи/u);
    assert.throws(() => addAgendaItem(
      database, workspace.id, meeting.id, { sourceKind: 'plan_item', sourceId: 'plan_article' }, 'person_secretary'
    ), /agenda_source_duplicate/u);
    const links = listMeetingLinks(database, workspace.id, 'plan_item', ['plan_article']);
    assert.equal(links.length, 1);
    assert.equal(links[0].meeting_id, meeting.id);
    assert.equal(links[0].item_no, 1);
    for (let number = 2; number <= 8; number += 1) {
      meeting = addAgendaItem(database, workspace.id, meeting.id, { title: `Вопрос ${number}` }, 'person_secretary');
    }
    assert.deepEqual(meeting.agenda.map((item) => item.item_no), [1,2,3,4,5,6,7,8]);

    meeting = deleteAgendaItem(database, workspace.id, meeting.id, meeting.agenda[1].id, 'person_secretary');
    assert.deepEqual(meeting.agenda.map((item) => item.item_no), [1,2,3,4,5,6,7]);
    meeting = addAgendaItem(database, workspace.id, meeting.id, { title: 'Новый восьмой вопрос' }, 'person_secretary');
    assert.deepEqual(meeting.agenda.map((item) => item.item_no), [1,2,3,4,5,6,7,8]);

    const question4 = meeting.agenda.find((item) => item.item_no === 4);
    const question8 = meeting.agenda.find((item) => item.item_no === 8);
    meeting = updateAgendaItem(database, workspace.id, meeting.id, question4.id, {
      heardText: 'Заслушали докладчика по четвёртому вопросу.',
      decisionText: 'Одобрить решение по четвёртому вопросу.'
    }, 'person_secretary');
    meeting = updateAgendaItem(database, workspace.id, meeting.id, question8.id, {
      heardText: 'Заслушали докладчика по восьмому вопросу.',
      decisionText: 'Принять решение по восьмому вопросу.'
    }, 'person_secretary');
    const meetingSearch = database.get(
      "SELECT content FROM search_fragments WHERE source_kind='meeting' AND source_id=? ORDER BY created_at DESC LIMIT 1", meeting.id
    );
    assert.match(meetingSearch.content, /научной статьи/u);
    assert.match(meetingSearch.content, /четвёртому вопросу/u);
    assert.match(meetingSearch.content, /восьмому вопросу/u);

    const extract = await generateMeetingDocument(database, config, workspace.id, meeting.id, {
      kind: 'extract', itemIds: [question4.id, question8.id]
    }, 'person_secretary');
    assert.equal(extract.question_numbers, '4,8');
    assert.equal(extract.duplicateRequest, false);
    const extractBlob = database.get(`SELECT fb.storage_path FROM meeting_documents md JOIN document_versions dv ON dv.id=md.document_version_id JOIN file_blobs fb ON fb.sha256=dv.blob_sha256 WHERE md.id=?`, extract.id);
    const extractXml = (await readZipEntry(extractBlob.storage_path, 'word/document.xml')).toString('utf8');
    const extractText = wordVisibleText(extractXml);
    assert.match(extractText, /4\. Вопрос 5/u);
    assert.match(extractText, /8\. Новый восьмой вопрос/u);
    assert.doesNotMatch(extractText, /3\. Вопрос 4/u);
    assert.doesNotMatch(extractText, /Подготовить научную статью/u);

    const duplicateExtract = await generateMeetingDocument(database, config, workspace.id, meeting.id, {
      kind: 'extract', itemIds: [question4.id, question8.id]
    }, 'person_secretary');
    assert.equal(duplicateExtract.duplicateRequest, true);
    assert.equal(duplicateExtract.document_id, extract.document_id);
    assert.equal(database.get("SELECT COUNT(*) AS c FROM meeting_documents WHERE meeting_id=? AND document_kind='extract'", meeting.id).c, 1);

    const protocol = await generateMeetingDocument(database, config, workspace.id, meeting.id, { kind: 'protocol' }, 'person_secretary');
    assert.equal(protocol.duplicateRequest, false);
    const protocolBlob = database.get(`SELECT fb.storage_path FROM meeting_documents md JOIN document_versions dv ON dv.id=md.document_version_id JOIN file_blobs fb ON fb.sha256=dv.blob_sha256 WHERE md.id=?`, protocol.id);
    const protocolText = wordVisibleText((await readZipEntry(protocolBlob.storage_path, 'word/document.xml')).toString('utf8'));
    assert.match(protocolText, /1\. О рассмотрении научной статьи/u);
    assert.match(protocolText, /8\. Новый восьмой вопрос/u);
    assert.equal(getMeeting(database, workspace.id, meeting.id).status, 'confirmed');
    assert.equal(database.get("SELECT COUNT(*) AS c FROM documents WHERE document_type IN ('department_protocol','protocol_extract')").c, 2);
    assert.equal(database.get("SELECT COUNT(*) AS c FROM search_fragments WHERE source_kind='document' AND source_id IN (?,?)", extract.document_id, protocol.document_id).c, 2);
  } finally {
    database.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
