import { basename } from 'node:path';
import { newId } from '../../core/src/ids.mjs';
import { storeIncomingStream } from '../../document-intake/src/blob-store.mjs';
import { ensureObjectPolicy } from '../../access-control/src/service.mjs';
import { validateMeetingTemplateFile } from './meeting-docx.mjs';
import {
  activePerson, assertDocxTemplate, fail, positiveInteger, required, writeAudit
} from './meeting-common.mjs';

export async function uploadMeetingTemplate(database, config, workspaceId, stream, {
  kind,
  originalName,
  actorPersonId = null
}) {
  if (!['protocol', 'extract'].includes(kind)) fail('meeting_template_kind_invalid');
  const fileName = basename(required(originalName, 'meeting_template_name_required'));
  if (!fileName.toLowerCase().endsWith('.docx')) fail('meeting_template_must_be_docx');
  const mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const blob = await storeIncomingStream(stream, {
    blobDir: config.blobDir,
    tempDir: config.tempDir,
    maxBytes: config.maxUploadBytes,
    mediaType
  });
  try {
    await validateMeetingTemplateFile(blob.storagePath);
  } catch (error) {
    if (String(error?.code || error?.message || error) === 'meeting_template_agenda_marker_required') throw error;
    fail('meeting_template_must_be_docx');
  }
  const uploadKey = `meeting-template:${workspaceId}:${kind}:${blob.sha256}`;
  const existing = database.get(`
    SELECT d.id AS document_id, dv.id AS version_id, d.title, dv.original_name
    FROM document_versions dv JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.upload_key = ?
  `, workspaceId, uploadKey);
  if (existing) return { ...existing, duplicateRequest: true };

  const now = new Date().toISOString();
  const documentId = newId('doc');
  const versionId = newId('docv');
  const title = kind === 'protocol' ? 'Шаблон протокола заседания' : 'Шаблон выписки из протокола';
  database.transaction(() => {
    database.run(`
      INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, blob.sha256, blob.sizeBytes, blob.mediaType, blob.storagePath, now);
    database.run(`
      INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, 'meeting_template', 'processed', ?, ?, ?)
    `, documentId, workspaceId, title, versionId, now, now);
    database.run(`
      INSERT INTO document_versions(
        id, document_id, version_no, blob_sha256, original_name, media_type, detected_format,
        processing_status, extracted_text, extraction_error, upload_key, uploaded_at,
        structure_status, ocr_status, preview_status
      ) VALUES (?, ?, 1, ?, ?, ?, 'docx', 'processed', NULL, NULL, ?, ?, 'template', 'not_needed', 'not_requested')
    `, versionId, documentId, blob.sha256, fileName, mediaType, uploadKey, now);
    ensureObjectPolicy(database, {
      workspaceId, objectKind: 'document', objectId: documentId,
      ownerPersonId: actorPersonId, accessScope: 'workspace', now
    });
    writeAudit(database, workspaceId, actorPersonId, 'meeting.template.uploaded', 'document', documentId, {
      kind, versionId, originalName: fileName, blobSha256: blob.sha256
    }, now);
  });
  return { document_id: documentId, version_id: versionId, title, original_name: fileName, duplicateRequest: false };
}

export function meetingSettingsResources(database, workspaceId) {
  const users = database.all(`
    SELECT id, display_name, email, position
    FROM people
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY display_name COLLATE NOCASE, id
  `, workspaceId);
  const templates = database.all(`
    SELECT dv.id AS version_id, d.id AS document_id, d.title, dv.original_name, dv.detected_format,
      d.document_type, d.updated_at
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ?
      AND d.document_type = 'meeting_template'
      AND (dv.detected_format = 'docx' OR lower(dv.original_name) LIKE '%.docx')
    ORDER BY d.updated_at DESC, d.title COLLATE NOCASE
    LIMIT 500
  `, workspaceId);
  return { users, templates };
}

export function getMeetingSettings(database, workspaceId) {
  const settings = database.get(`
    SELECT ms.*,
      chair.display_name AS chairperson_name,
      secretary.display_name AS secretary_name,
      protocol_doc.title AS protocol_template_title,
      protocol_version.original_name AS protocol_template_name,
      extract_doc.title AS extract_template_title,
      extract_version.original_name AS extract_template_name
    FROM meeting_settings ms
    LEFT JOIN people chair ON chair.id = ms.chairperson_person_id
    LEFT JOIN people secretary ON secretary.id = ms.secretary_person_id
    LEFT JOIN document_versions protocol_version ON protocol_version.id = ms.protocol_template_version_id
    LEFT JOIN documents protocol_doc ON protocol_doc.id = protocol_version.document_id
    LEFT JOIN document_versions extract_version ON extract_version.id = ms.extract_template_version_id
    LEFT JOIN documents extract_doc ON extract_doc.id = extract_version.document_id
    WHERE ms.workspace_id = ?
  `, workspaceId) || null;
  return settings;
}

export function saveMeetingSettings(database, workspaceId, input, actorPersonId = null, now = new Date().toISOString()) {
  const quorum = positiveInteger(input?.quorum, 'meeting_quorum_invalid');
  const chair = activePerson(database, workspaceId, input?.chairpersonPersonId);
  const secretary = activePerson(database, workspaceId, input?.secretaryPersonId);
  if (!chair) fail('meeting_chairperson_invalid');
  if (!secretary) fail('meeting_secretary_invalid');
  const protocolTemplate = assertDocxTemplate(database, workspaceId, input?.protocolTemplateVersionId);
  const extractTemplate = assertDocxTemplate(database, workspaceId, input?.extractTemplateVersionId);

  database.transaction(() => {
    database.run(`
      INSERT INTO meeting_settings(
        workspace_id, protocol_template_version_id, extract_template_version_id,
        quorum, chairperson_person_id, secretary_person_id, updated_by_person_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        protocol_template_version_id = excluded.protocol_template_version_id,
        extract_template_version_id = excluded.extract_template_version_id,
        quorum = excluded.quorum,
        chairperson_person_id = excluded.chairperson_person_id,
        secretary_person_id = excluded.secretary_person_id,
        updated_by_person_id = excluded.updated_by_person_id,
        updated_at = excluded.updated_at
    `, workspaceId, protocolTemplate.version_id, extractTemplate.version_id,
    quorum, chair.id, secretary.id, actorPersonId, now, now);
    writeAudit(database, workspaceId, actorPersonId, 'meeting_settings.updated',
      'meeting_settings', workspaceId, {
        quorum,
        chairpersonPersonId: chair.id,
        secretaryPersonId: secretary.id,
        protocolTemplateVersionId: protocolTemplate.version_id,
        extractTemplateVersionId: extractTemplate.version_id
      }, now);
  });
  return getMeetingSettings(database, workspaceId);
}

export function requireCompleteSettings(database, workspaceId) {
  const settings = getMeetingSettings(database, workspaceId);
  if (!settings) fail('meeting_settings_incomplete');
  if (!settings.protocol_template_version_id || !settings.extract_template_version_id
    || !settings.chairperson_person_id || !settings.secretary_person_id || !settings.quorum) {
    fail('meeting_settings_incomplete');
  }
  const chair = activePerson(database, workspaceId, settings.chairperson_person_id);
  const secretary = activePerson(database, workspaceId, settings.secretary_person_id);
  if (!chair || !secretary) fail('meeting_settings_incomplete');
  assertDocxTemplate(database, workspaceId, settings.protocol_template_version_id);
  assertDocxTemplate(database, workspaceId, settings.extract_template_version_id);
  return { ...settings, chair, secretary };
}
