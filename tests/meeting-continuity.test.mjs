import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { storeGeneratedFile } from '../packages/document-intake/src/blob-store.mjs';
import { writeZipArchive, readZipEntry } from '../packages/plan-docx/src/archive.mjs';
import {
  transferAgendaItem, updateMeeting, updateAgendaItem, getMeeting, listMeetingLinks,
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

import { wordVisibleText } from '../packages/plan-docx/src/ooxml-shared.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { persistProtocol } from '../packages/protocols/src/persist.mjs';
function addDocumentVersion(database, workspaceId, suffix) {
  const now = new Date().toISOString();
  const documentId = `doc_protocol_${suffix}`;
  const versionId = `docv_protocol_${suffix}`;
  const sha = suffix.repeat(64);
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, 10, 'text/plain', ?, ?)
  `, sha, `/tmp/${documentId}.txt`, now);
  database.run(`
    INSERT INTO documents(
      id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'department_protocol', 'processed', ?, ?, ?)
  `, documentId, workspaceId, `Протокол ${suffix}`, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type,
      detected_format, processing_status, upload_key, uploaded_at
    ) VALUES (?, ?, 1, ?, ?, 'text/plain', 'text', 'processed', ?, ?)
  `, versionId, documentId, sha, `${documentId}.txt`, `protocol-test:${suffix}`, now);
  return versionId;
}

function protocol(overrides = {}) {
  return {
    protocolNumber: '7',
    meetingDate: '2026-09-01',
    title: 'Заседание кафедры',
    chairperson: 'Иванов И. И.',
    secretary: null,
    attendees: 'Иванов И. И.; Петров П. П.',
    confidence: 0.88,
    evidence: { lineStart: 1, lineEnd: 40 },
    agendaItems: [{
      itemNo: 1,
      title: 'Об итогах учебного года',
      heardText: 'Первичный доклад',
      discussedText: null,
      decisionText: 'Утвердить результаты',
      responsibleRaw: 'Петров П. П.',
      dueDate: '2026-09-10',
      evidence: { lineStart: 10, lineEnd: 20 }
    }],
    ...overrides
  };
}


function meeting(db, ws, number, date = '2035-09-15') {
  return createMeeting(db, ws.id, { protocolNumber: number, meetingDate: date });
}
function documentPath(db, id) {
  return db.get(`SELECT fb.storage_path FROM meeting_documents md
    JOIN document_versions dv ON dv.id=md.document_version_id
    JOIN file_blobs fb ON fb.sha256=dv.blob_sha256 WHERE md.id=?`, id).storage_path;
}
async function documentText(db, id) {
  return wordVisibleText((await readZipEntry(documentPath(db, id), 'word/document.xml')).toString('utf8'));
}

test('перенос сохраняет связи, решения и evidence; запоздалый повтор не возвращает вопрос назад', () => fixture(async (db, ws) => {
  const plan = createManualPlan(db, ws.id, { title: 'План кафедры', planKind: 'department', periodKind: 'calendar', yearStart: 2035 });
  const source = createManualPlanItem(db, ws.id, plan.id, { title: 'Плановый вопрос', executionMode: 'track' });
  let a = meeting(db, ws, 'A');
  const b = meeting(db, ws, 'B', '2036-01-20');
  const c = meeting(db, ws, 'C', '2037-02-20');
  a = addAgendaItem(db, ws.id, a.id, { sourceKind: 'plan_item', sourceId: source.id,
    heardText: 'Доклад', discussedText: 'Обсуждение', decisionText: 'Утвердить', responsibleRaw: 'Петров П.П.', dueDate: '2036-03-01' });
  const item = a.agenda[0];
  addAgendaItem(db, ws.id, a.id, { title: 'Оставшийся вопрос' });
  addAgendaItem(db, ws.id, b.id, { title: 'Первый вопрос назначения' });
  const request = { targetMeetingId: b.id, requestId: 'first-transfer' };
  const moved = transferAgendaItem(db, ws.id, a.id, item.id, request);
  assert.deepEqual(moved.sourceMeeting.agenda.map(x => x.item_no), [1]);
  assert.deepEqual(moved.targetMeeting.agenda.map(x => x.item_no), [1, 2]);
  const saved = moved.targetMeeting.agenda[1];
  for (const key of ['id', 'title', 'heard_text', 'discussed_text', 'decision_text', 'source_kind', 'source_id', 'evidence_json']) assert.deepEqual(saved[key], item[key]);
  assert.deepEqual(saved.decisions, item.decisions);
  assert.equal(listMeetingLinks(db, ws.id, 'plan_item', [source.id])[0].meeting_id, b.id);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='decision' AND source_id=?", item.decision.id).n, 1);
  assert.equal(transferAgendaItem(db, ws.id, a.id, item.id, request).duplicateRequest, true);
  transferAgendaItem(db, ws.id, b.id, item.id, { targetMeetingId: c.id, requestId: 'second-transfer' });
  const delayed = transferAgendaItem(db, ws.id, a.id, item.id, request);
  assert.equal(delayed.duplicateRequest, true);
  assert.equal(delayed.currentMeetingId, c.id);
  assert.equal(getMeeting(db, ws.id, c.id).agenda[0].id, item.id);
  assert.throws(() => transferAgendaItem(db, ws.id, a.id, item.id, { ...request, targetMeetingId: c.id }), /agenda_transfer_request_conflict/u);
  assert.throws(() => transferAgendaItem(db, ws.id, a.id, item.id, { ...request, requestId: 'stale' }), /agenda_transfer_conflict/u);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action='meeting.agenda.transferred'").n, 2);
  db.run("UPDATE plans SET status='archived' WHERE id=?", plan.id);
  assert.equal(getMeeting(db, ws.id, c.id).agenda[0].source_id, source.id);
  assert.equal(listMeetingLinks(db, ws.id, 'plan_item', [source.id])[0].meeting_id, c.id);
}));

test('ошибка в конце переноса откатывает обе повестки, поиск и аудит; чужое пространство недоступно', () => fixture(async (db, ws) => {
  let a = meeting(db, ws, 'A');
  const b = meeting(db, ws, 'B');
  a = addAgendaItem(db, ws.id, a.id, { title: 'Не потерять', decisionText: 'Сохранить', dueDate: '2035-10-01' });
  const item = a.agenda[0];
  const snapshot = () => JSON.stringify({ a: getMeeting(db, ws.id, a.id), b: getMeeting(db, ws.id, b.id),
    fragments: db.all('SELECT * FROM search_fragments ORDER BY id'), audit: db.all('SELECT * FROM audit_log ORDER BY id') });
  const before = snapshot();
  db.run(`CREATE TRIGGER fail_transfer_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='meeting.agenda.transferred' BEGIN SELECT RAISE(ABORT, 'forced_transfer_failure'); END`);
  assert.throws(() => transferAgendaItem(db, ws.id, a.id, item.id, { targetMeetingId: b.id, requestId: 'rollback' }), /forced_transfer_failure/u);
  assert.equal(snapshot(), before);
  db.run('DROP TRIGGER fail_transfer_audit');
  db.run('INSERT INTO workspaces(id,code,name,created_at) VALUES(?,?,?,?)', 'ws_other', 'other', 'Другая кафедра', new Date().toISOString());
  const other = meeting(db, { id: 'ws_other' }, 'private');
  assert.throws(() => transferAgendaItem(db, ws.id, a.id, item.id, { targetMeetingId: other.id, requestId: 'foreign' }), /meeting_not_found/u);
  assert.throws(() => transferAgendaItem(db, ws.id, a.id, item.id, { targetMeetingId: 'missing', requestId: 'missing' }), /meeting_not_found/u);
  assert.equal(getMeeting(db, ws.id, a.id).agenda[0].id, item.id);
  assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
  assert.equal(db.get('PRAGMA quick_check').quick_check, 'ok');
}));

test('повторный разбор источника не возвращает перенесённый вопрос; замечания следуют за вопросом', () => fixture(async (db, ws) => {
  const versionId = addDocumentVersion(db, ws.id, 'a');
  const raw = protocol();
  const original = JSON.stringify(raw);
  const persist = () => db.transaction(() => persistProtocol(db, { workspaceId: ws.id, documentVersionId: versionId, documentTitle: 'Исходный протокол', result: JSON.parse(original) }));
  const aId = persist();
  const a = getMeeting(db, ws.id, aId);
  const b = meeting(db, ws, 'B', '2036-01-20');
  const item = a.agenda[0];
  assert.ok(a.reviews.some(x => x.context.decisionId === item.decision.id));
  const version = db.get('SELECT * FROM document_versions WHERE id=?', versionId);
  const blob = db.get('SELECT * FROM file_blobs WHERE sha256=?', version.blob_sha256);
  transferAgendaItem(db, ws.id, aId, item.id, { targetMeetingId: b.id, requestId: 'import-transfer' });
  updateAgendaItem(db, ws.id, b.id, item.id, { title: 'Исправленный заголовок' });
  persist();
  assert.equal(getMeeting(db, ws.id, aId).agenda.length, 0);
  const saved = getMeeting(db, ws.id, b.id);
  assert.equal(saved.agenda.length, 1);
  assert.equal(saved.agenda[0].title, 'Исправленный заголовок');
  assert.ok(saved.reviews.some(x => x.context.decisionId === item.decision.id));
  assert.ok(!getMeeting(db, ws.id, aId).reviews.some(x => x.context.decisionId === item.decision.id));
  assert.deepEqual(db.get('SELECT * FROM document_versions WHERE id=?', versionId), version);
  assert.deepEqual(db.get('SELECT * FROM file_blobs WHERE sha256=?', version.blob_sha256), blob);
  const source = JSON.parse(saved.agenda[0].evidence_json).sources[0];
  assert.equal(source.documentVersionId, versionId);
  assert.deepEqual(source.locator, raw.agendaItems[0].evidence);
}));

test('очищение ошибочного решения не восстанавливает старый текст и сохраняет историю', () => fixture(async (db, ws) => {
  let a = meeting(db, ws, 'A');
  a = addAgendaItem(db, ws.id, a.id, { title: 'Вопрос', decisionText: 'Ошибочное решение' });
  const item = a.agenda[0];
  const saved = updateAgendaItem(db, ws.id, a.id, item.id, { decisionText: '' }).agenda[0];
  assert.equal(saved.decision_text, null);
  assert.equal(saved.decision.text, '');
  assert.equal(saved.decision.id, item.decision.id);
  assert.equal(saved.decision.status, 'proposed');
  assert.equal(JSON.parse(saved.decision.evidence_json).manualCorrections.at(-1).before.text, 'Ошибочное решение');
  assert.equal(updateAgendaItem(db, ws.id, a.id, item.id, { title: 'Исправленный вопрос' }).agenda[0].decision_text, null);
}));

test('DOCX включает все решения, ответственных и сроки; перенос и новая дата не переписывают историю файлов', () => fixture(async (db, ws, config, dir) => {
  const template = await registerTemplate(db, config, ws.id, dir, 'protocol-all', 'protocol');
  setMeetingTemplateDefault(db, ws.id, template.catalog.id);
  const extractTemplate = await registerTemplate(db, config, ws.id, dir, 'extract-all', 'extract');
  setMeetingTemplateDefault(db, ws.id, extractTemplate.catalog.id);
  let a = meeting(db, ws, 'A');
  const b = meeting(db, ws, 'B', '2036-01-20');
  a = addAgendaItem(db, ws.id, a.id, { title: 'Переносимый вопрос', heardText: 'Доклад', discussedText: 'Замечания',
    decisionText: 'Утвердить итоги', responsibleRaw: 'Петров П.П.', dueDate: '2036-02-01' });
  const item = a.agenda[0];
  db.run(`INSERT INTO decisions(id,agenda_item_id,text,responsible_raw,due_date,status,evidence_json,created_at)
    VALUES(?,?,?,? ,?,'confirmed','{}',?)`, 'decision_second', item.id, 'Опубликовать результаты', 'Иванов И.И.', '2036-02-02', '2035-09-20T12:00:00Z');
  addAgendaItem(db, ws.id, a.id, { title: 'Остающийся вопрос' });
  const first = await generateMeetingDocument(db, config, ws.id, a.id, { kind: 'protocol' });
  const bytes = await readFile(documentPath(db, first.id));
  const text = await documentText(db, first.id);
  for (const part of ['Переносимый вопрос', 'Остающийся вопрос', 'Доклад', 'Замечания', 'Утвердить итоги', 'Опубликовать результаты', 'Петров П.П.', 'Иванов И.И.', '1 февраля 2036', '2 февраля 2036']) assert.ok(text.includes(part), part);
  transferAgendaItem(db, ws.id, a.id, item.id, { targetMeetingId: b.id, requestId: 'document-transfer' });
  const remaining = await generateMeetingDocument(db, config, ws.id, a.id, { kind: 'protocol' });
  assert.notEqual(remaining.document_id, first.document_id);
  assert.doesNotMatch(await documentText(db, remaining.id), /Переносимый вопрос/u);
  const destination = await generateMeetingDocument(db, config, ws.id, b.id, { kind: 'extract', itemIds: [item.id] });
  assert.match(await documentText(db, destination.id), /Опубликовать результаты/u);
  assert.equal(destination.template_version_id, extractTemplate.versionId);
  updateMeeting(db, ws.id, b.id, { meetingDate: '2037-03-10' });
  const revised = await generateMeetingDocument(db, config, ws.id, b.id, { kind: 'extract', itemIds: [item.id] });
  assert.match(await documentText(db, revised.id), /10 марта 2037/u);
  assert.notEqual(revised.document_id, destination.document_id);
  const repeated = await generateMeetingDocument(db, config, ws.id, b.id, { kind: 'extract', itemIds: [item.id] });
  assert.equal(repeated.duplicateRequest, true);
  assert.equal(repeated.document_id, revised.document_id);
  assert.deepEqual(await readFile(documentPath(db, first.id)), bytes);
  assert.equal(getMeeting(db, ws.id, a.id).documents.length, 2);
  assert.equal(getMeeting(db, ws.id, b.id).documents.length, 2);
}));
