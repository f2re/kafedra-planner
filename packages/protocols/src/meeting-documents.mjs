import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { ensureObjectPolicy } from '../../access-control/src/service.mjs';
import { meetingDocumentHash, meetingDocumentModel, renderMeetingDocumentFile } from './meeting-docx.mjs';
import { latestMeetingTemplateProfile } from './meeting-template-profile.mjs';
import { assertDocxTemplate, clean, fail, writeAudit } from './meeting-common.mjs';
import { getMeetingSettings } from './meeting-settings.mjs';
import { getMeeting, syncMeetingSearch } from './meeting-core.mjs';

function selectedItems(meeting, kind, itemIds) {
  if (kind === 'protocol') return meeting.agenda;
  if (kind !== 'extract') fail('meeting_document_kind_invalid');
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map((value) => String(value)))];
  if (!ids.length) fail('meeting_document_items_required');
  const wanted = new Set(ids);
  const selected = meeting.agenda.filter((item) => wanted.has(item.id));
  if (selected.length !== ids.length) fail('meeting_document_item_invalid');
  return selected;
}

function safeFilePart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]+/gu, '-').replace(/\s+/gu, ' ').trim() || 'без номера';
}

function generatedTitle(meeting, kind, items) {
  const base = `протокола №${meeting.protocol_number} от ${meeting.meeting_date}`;
  if (kind === 'protocol') return `Протокол №${meeting.protocol_number} от ${meeting.meeting_date}`;
  return `Выписка из ${base} · вопросы ${items.map((item) => item.item_no).join(', ')}`;
}

function generatedFileName(meeting, kind, items) {
  const number = safeFilePart(meeting.protocol_number);
  const date = safeFilePart(meeting.meeting_date);
  if (kind === 'protocol') return `Протокол №${number} от ${date}.docx`;
  return `Выписка из протокола №${number} · вопросы ${items.map((item) => item.item_no).join(', ')}.docx`;
}

function registerGeneratedDocument(database, {
  workspaceId, meeting, kind, items, template, profile, blob, text, requestHash, actorPersonId, now
}) {
  const documentId = newId('doc');
  const versionId = newId('docv');
  const recordId = newId('meetingdoc');
  const title = generatedTitle(meeting, kind, items);
  const originalName = generatedFileName(meeting, kind, items);
  database.run(`
    INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, blob.sha256, blob.sizeBytes, blob.mediaType, blob.storagePath, now);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'processed', ?, ?, ?)
  `, documentId, workspaceId, title, kind === 'protocol' ? 'department_protocol' : 'protocol_extract', versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type, detected_format,
      processing_status, extracted_text, extraction_error, upload_key, uploaded_at,
      structure_status, ocr_status, preview_status
    ) VALUES (?, ?, 1, ?, ?, ?, 'docx', 'processed', ?, NULL, ?, ?, 'generated', 'not_needed', 'not_requested')
  `, versionId, documentId, blob.sha256, originalName, blob.mediaType, text,
  `meeting:${meeting.id}:${kind}:${requestHash}`, now);
  database.run(`
    INSERT INTO meeting_documents(
      id, meeting_id, document_kind, question_numbers, request_hash,
      template_version_id, document_id, document_version_id, created_by_person_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, recordId, meeting.id, kind, items.map((item) => item.item_no).join(','), requestHash,
  template.version_id, documentId, versionId, actorPersonId, now);
  ensureObjectPolicy(database, {
    workspaceId,
    objectKind: 'document',
    objectId: documentId,
    ownerPersonId: meeting.chairperson_person_id || actorPersonId || null,
    accessScope: 'workspace',
    now
  });
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'document',
    sourceId: documentId,
    documentVersionId: versionId,
    title,
    content: text,
    locator: { kind: 'meeting_document', meetingId: meeting.id, questionNumbers: items.map((item) => item.item_no) }
  });
  writeAudit(database, workspaceId, actorPersonId, 'meeting.document.generated', 'meeting', meeting.id, {
    documentKind: kind,
    documentId,
    documentVersionId: versionId,
    questionNumbers: items.map((item) => item.item_no),
    templateVersionId: template.version_id,
    templateProfileVersionId: profile?.profileVersionId || profile?.profile_version_id || null,
    templateProfileSha256: profile?.profileSha256 || null,
    requestHash
  }, now);
  return { recordId, documentId, versionId, title, originalName };
}

function snapshottedProfile(meeting, kind) {
  try {
    const evidence = JSON.parse(meeting.evidence_json || '{}');
    return evidence?.templateProfiles?.[kind] || null;
  } catch {
    return null;
  }
}

function templateMode(database, templateVersionId) {
  return database.get('SELECT structure_status FROM document_versions WHERE id = ?', templateVersionId)?.structure_status || null;
}

function resolveProfile(database, workspaceId, meeting, kind, templateVersionId, mode) {
  const snapshot = snapshottedProfile(meeting, kind);
  if (snapshot && snapshot.templateVersionId === templateVersionId && snapshot.status === 'ready') return snapshot;
  if (mode !== 'meeting_template_visual') return null;
  return latestMeetingTemplateProfile(database, workspaceId, templateVersionId, kind, true);
}

export async function generateMeetingDocument(database, config, workspaceId, meetingId, input, actorPersonId = null) {
  const meeting = getMeeting(database, workspaceId, meetingId);
  if (!meeting) fail('meeting_not_found');
  if (!meeting.meeting_date) fail('meeting_date_required');
  if (!clean(meeting.protocol_number)) fail('meeting_protocol_number_required');
  const kind = clean(input?.kind) || 'protocol';
  const items = selectedItems(meeting, kind, input?.itemIds);
  if (!items.length) fail('meeting_agenda_empty');
  const settings = getMeetingSettings(database, workspaceId);
  const templateVersionId = kind === 'protocol'
    ? (meeting.protocol_template_version_id || settings?.protocol_template_version_id)
    : (meeting.extract_template_version_id || settings?.extract_template_version_id);
  if (!templateVersionId) fail('meeting_settings_incomplete');
  const template = assertDocxTemplate(database, workspaceId, templateVersionId);
  const mode = templateMode(database, templateVersionId);
  const profile = resolveProfile(database, workspaceId, meeting, kind, templateVersionId, mode);
  if (mode === 'meeting_template_visual' && !profile) fail('meeting_template_profile_incomplete');
  const materializedMeeting = {
    ...meeting,
    quorum_required: meeting.quorum_required || settings?.quorum || null,
    chairperson_raw: meeting.chairperson_raw || settings?.chairperson_name || '',
    secretary_raw: meeting.secretary_raw || settings?.secretary_name || ''
  };
  const model = meetingDocumentModel({ meeting: materializedMeeting, items, kind });
  const requestHash = meetingDocumentHash({
    templateSha256: template.blob_sha256,
    profileSha256: profile?.profileSha256 || null,
    model,
    kind
  });
  const existing = database.get(`
    SELECT md.*, d.title, dv.original_name
    FROM meeting_documents md
    JOIN documents d ON d.id = md.document_id
    JOIN document_versions dv ON dv.id = md.document_version_id
    WHERE md.meeting_id = ? AND md.document_kind = ? AND md.request_hash = ?
  `, meetingId, kind, requestHash);
  if (existing) return { ...existing, duplicateRequest: true };

  await mkdir(config.tempDir, { recursive: true });
  const outputPath = join(config.tempDir, `${meetingId}-${kind}-${requestHash.slice(0, 16)}-${process.pid}-${newId('tmp')}.docx`);
  try {
    const rendered = await renderMeetingDocumentFile({
      templatePath: template.storage_path,
      outputPath,
      model,
      profile
    });
    const blob = await storeGeneratedFile(outputPath, {
      blobDir: config.blobDir,
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const now = new Date().toISOString();
    let result;
    database.transaction(() => {
      const raced = database.get(`
        SELECT md.*, d.title, dv.original_name
        FROM meeting_documents md
        JOIN documents d ON d.id = md.document_id
        JOIN document_versions dv ON dv.id = md.document_version_id
        WHERE md.meeting_id = ? AND md.document_kind = ? AND md.request_hash = ?
      `, meetingId, kind, requestHash);
      if (raced) {
        result = { ...raced, duplicateRequest: true };
        return;
      }
      result = registerGeneratedDocument(database, {
        workspaceId,
        meeting: materializedMeeting,
        kind,
        items,
        template,
        profile,
        blob,
        text: rendered.text,
        requestHash,
        actorPersonId,
        now
      });
      if (kind === 'protocol') {
        database.run(`
          UPDATE meetings
          SET source_document_version_id = COALESCE(source_document_version_id, ?),
            status = 'confirmed', updated_at = ?
          WHERE id = ?
        `, result.versionId, now, meetingId);
        syncMeetingSearch(database, workspaceId, meetingId);
      }
    });
    if (result?.duplicateRequest) return result;
    const document = database.get(`
      SELECT md.*, d.title, dv.original_name
      FROM meeting_documents md
      JOIN documents d ON d.id = md.document_id
      JOIN document_versions dv ON dv.id = md.document_version_id
      WHERE md.meeting_id = ? AND md.document_kind = ? AND md.request_hash = ?
    `, meetingId, kind, requestHash);
    return { ...document, duplicateRequest: false };
  } finally {
    await rm(outputPath, { force: true });
  }
}
