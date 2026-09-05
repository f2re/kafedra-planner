import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { storeGeneratedFile } from '../packages/document-intake/src/blob-store.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import {
  addAgendaItem,
  createMeeting,
  generateMeetingDocument,
  registerMeetingTemplateCatalogEntry,
  setMeetingTemplateDefault
} from '../packages/protocols/src/meetings.mjs';

const migrationsDir = resolve('migrations');

function templateXml(title) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>${title}</w:t></w:r></w:p>
<w:p><w:r><w:t>Протокол №{{PROTOCOL_NUMBER}} от {{MEETING_DATE}}</w:t></w:r></w:p>
<w:p><w:r><w:t>{{AGENDA}}</w:t></w:r></w:p>
<w:sectPr/></w:body></w:document>`;
}

async function createDocx(path, title) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml(title)
  });
}

async function registerTemplate(database, config, workspaceId, dir, id, kind) {
  const path = join(dir, `${id}.docx`);
  await createDocx(path, kind === 'protocol' ? 'Протокол заседания' : 'Выписка');
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
  database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,upload_key,uploaded_at,structure_status,ocr_status,preview_status) VALUES(?,?,1,?,?,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx','processed',?,?, 'template','not_needed','not_requested')`,
    versionId, documentId, blob.sha256, `${id}.docx`, `meeting-template:${workspaceId}:${kind}:${id}`, now);
  const catalog = registerMeetingTemplateCatalogEntry(database, workspaceId, {
    document_id: documentId,
    version_id: versionId,
    original_name: `${id}.docx`,
    title: `Шаблон ${id}`
  }, { kind, displayName: `Шаблон ${id}` });
  return { documentId, versionId, catalog };
}

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-meeting-minimal-'));
  const database = new Database(join(dir, 'db.sqlite3'), { migrationsDir });
  const config = { blobDir: join(dir, 'blobs'), tempDir: join(dir, 'tmp') };
  try {
    await run(database, ensureDefaultWorkspace(database), config, dir);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('пустая установка создаёт заседание и повестку без настроек выпуска', () => fixture(
  async (database, workspace, config, dir) => {
    assert.equal(database.get('SELECT * FROM meeting_settings WHERE workspace_id = ?', workspace.id), undefined);

    let meeting = createMeeting(database, workspace.id, {
      meetingDate: '2035-09-15',
      protocolNumber: '1'
    }, null, '2035-09-01T08:00:00.000Z');

    assert.equal(meeting.title, 'Заседание кафедры');
    assert.equal(meeting.status, 'draft');
    assert.equal(meeting.chairperson_person_id, null);
    assert.equal(meeting.secretary_person_id, null);
    assert.equal(meeting.quorum_required, null);
    assert.equal(meeting.protocol_template_version_id, null);
    assert.equal(meeting.extract_template_version_id, null);
    assert.deepEqual(JSON.parse(meeting.evidence_json).templateProfiles, { protocol: null, extract: null });
    assert.equal(database.get("SELECT COUNT(*) AS count FROM calendar_items WHERE source_kind='meeting' AND source_id=?", meeting.id).count, 1);

    meeting = addAgendaItem(database, workspace.id, meeting.id, {
      title: 'Об утверждении плана работы кафедры'
    }, null, '2035-09-01T08:05:00.000Z');
    assert.equal(meeting.agenda.length, 1);
    assert.equal(meeting.agenda[0].item_no, 1);

    const protocolTemplate = await registerTemplate(database, config, workspace.id, dir, 'only_protocol', 'protocol');
    setMeetingTemplateDefault(database, workspace.id, protocolTemplate.catalog.id, null, '2035-09-01T08:10:00.000Z');
    assert.equal(database.get('SELECT * FROM meeting_settings WHERE workspace_id = ?', workspace.id), undefined);

    const protocol = await generateMeetingDocument(database, config, workspace.id, meeting.id, {
      kind: 'protocol'
    }, null);
    assert.equal(protocol.template_version_id, protocolTemplate.versionId);
    assert.equal(protocol.duplicateRequest, false);
    const repeated = await generateMeetingDocument(database, config, workspace.id, meeting.id, {
      kind: 'protocol'
    }, null);
    assert.equal(repeated.duplicateRequest, true);
    assert.equal(repeated.document_id, protocol.document_id);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM meeting_documents WHERE meeting_id=? AND document_kind='protocol'", meeting.id).count, 1);

    const audit = database.get(`
      SELECT details_json FROM audit_log
      WHERE action = 'meeting.document.generated' AND subject_id = ?
      ORDER BY created_at DESC LIMIT 1
    `, meeting.id);
    assert.equal(JSON.parse(audit.details_json).templateVersionId, protocolTemplate.versionId);
  }
));

test('неоднозначные шаблоны требуют выбор только нужного вида', () => fixture(
  async (database, workspace, config, dir) => {
    let meeting = createMeeting(database, workspace.id, {
      meetingDate: '2036-09-15',
      protocolNumber: '2'
    });
    meeting = addAgendaItem(database, workspace.id, meeting.id, { title: 'О текущей работе' });

    const first = await registerTemplate(database, config, workspace.id, dir, 'extract_a', 'extract');
    const second = await registerTemplate(database, config, workspace.id, dir, 'extract_b', 'extract');
    await assert.rejects(
      () => generateMeetingDocument(database, config, workspace.id, meeting.id, {
        kind: 'extract', itemIds: [meeting.agenda[0].id]
      }),
      /meeting_settings_incomplete/u
    );

    const generated = await generateMeetingDocument(database, config, workspace.id, meeting.id, {
      kind: 'extract',
      itemIds: [meeting.agenda[0].id],
      templateVersionId: second.versionId
    });
    assert.equal(generated.template_version_id, second.versionId);
    assert.notEqual(generated.template_version_id, first.versionId);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM meeting_documents WHERE meeting_id=? AND document_kind='extract'", meeting.id).count, 1);
  }
));
