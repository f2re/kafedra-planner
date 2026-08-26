import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../../core/src/ids.mjs';
import { ensureObjectPolicy } from '../../access-control/src/service.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { buildDocumentPreview } from '../../document-intake/src/preview.mjs';
import { meetingDocumentModel, renderMeetingDocumentFile } from './meeting-docx.mjs';
import {
  analyzeMeetingTemplatePath,
  latestMeetingTemplateProfile,
  meetingTemplateProfileByVersion
} from './meeting-template-profile.mjs';
import { assertDocxTemplate, clean, fail, required, writeAudit } from './meeting-common.mjs';

const SELECTABLE_READINESS = new Set(['ready', 'legacy_compatible']);

function tableExists(database, name) {
  return Boolean(database.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", name));
}

function parseKind(row, settings) {
  const kinds = new Set();
  const key = String(row.upload_key || '');
  if (key.includes(':protocol:')) kinds.add('protocol');
  if (key.includes(':extract:')) kinds.add('extract');
  if (settings?.protocol_template_version_id === row.version_id) kinds.add('protocol');
  if (settings?.extract_template_version_id === row.version_id) kinds.add('extract');
  if (!kinds.size) {
    const label = `${row.title || ''} ${row.original_name || ''}`.toLocaleLowerCase('ru-RU');
    kinds.add(label.includes('выписк') ? 'extract' : 'protocol');
  }
  return [...kinds];
}

function profileState(database, workspaceId, versionId, kind, structureStatus) {
  const ready = latestMeetingTemplateProfile(database, workspaceId, versionId, kind, true);
  const latest = latestMeetingTemplateProfile(database, workspaceId, versionId, kind, false);
  if (ready) return { readiness: 'ready', profile: ready, draft: latest?.status === 'draft' ? latest : null };
  if (latest) return { readiness: 'draft', profile: null, draft: latest };
  if (structureStatus === 'meeting_template_visual') return { readiness: 'needs_setup', profile: null, draft: null };
  return { readiness: 'legacy_compatible', profile: null, draft: null };
}

function insertCatalog(database, {
  workspaceId,
  kind,
  seriesId,
  versionNo,
  displayName,
  documentId,
  documentVersionId,
  profileVersionId,
  readiness,
  isDefault = false,
  actorPersonId = null,
  now = new Date().toISOString()
}) {
  const id = newId('mtcat');
  database.run(`
    INSERT OR IGNORE INTO meeting_template_catalog(
      id, workspace_id, document_kind, series_id, version_no, display_name,
      document_id, document_version_id, profile_version_id, readiness,
      lifecycle_status, is_default, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `, id, workspaceId, kind, seriesId, versionNo, displayName,
  documentId, documentVersionId, profileVersionId, readiness,
  isDefault ? 1 : 0, actorPersonId, now, now);
  return database.get(`
    SELECT * FROM meeting_template_catalog
    WHERE workspace_id = ? AND document_kind = ? AND document_version_id = ?
  `, workspaceId, kind, documentVersionId);
}

export function ensureMeetingTemplateCatalog(database, workspaceId) {
  if (!tableExists(database, 'meeting_template_catalog')) return [];
  const settings = database.get('SELECT * FROM meeting_settings WHERE workspace_id = ?', workspaceId) || null;
  const rows = database.all(`
    SELECT d.id AS document_id, d.title, d.created_at, d.lifecycle_status,
      dv.id AS version_id, dv.original_name, dv.upload_key, dv.structure_status,
      dv.uploaded_at
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    LEFT JOIN meeting_template_catalog catalog ON catalog.document_version_id = dv.id
      AND catalog.workspace_id = d.workspace_id
    WHERE d.workspace_id = ? AND d.document_type = 'meeting_template'
      AND catalog.id IS NULL
    ORDER BY dv.uploaded_at, dv.id
  `, workspaceId);
  for (const row of rows) {
    for (const kind of parseKind(row, settings)) {
      const state = profileState(database, workspaceId, row.version_id, kind, row.structure_status);
      insertCatalog(database, {
        workspaceId,
        kind,
        seriesId: newId('mtseries'),
        versionNo: 1,
        displayName: row.original_name || row.title || (kind === 'protocol' ? 'Шаблон протокола' : 'Шаблон выписки'),
        documentId: row.document_id,
        documentVersionId: row.version_id,
        profileVersionId: state.profile?.profile_version_id || null,
        readiness: state.readiness,
        isDefault: settings?.[kind === 'protocol' ? 'protocol_template_version_id' : 'extract_template_version_id'] === row.version_id,
        now: row.uploaded_at || row.created_at || new Date().toISOString()
      });
    }
  }
  syncMeetingTemplateCatalog(database, workspaceId);
  return database.all('SELECT * FROM meeting_template_catalog WHERE workspace_id = ?', workspaceId);
}

export function syncMeetingTemplateCatalog(database, workspaceId, documentVersionId = null, kind = null) {
  if (!tableExists(database, 'meeting_template_catalog')) return;
  const clauses = ['workspace_id = ?'];
  const params = [workspaceId];
  if (documentVersionId) {
    clauses.push('document_version_id = ?');
    params.push(documentVersionId);
  }
  if (kind) {
    clauses.push('document_kind = ?');
    params.push(kind);
  }
  const entries = database.all(`SELECT * FROM meeting_template_catalog WHERE ${clauses.join(' AND ')}`, ...params);
  const now = new Date().toISOString();
  for (const entry of entries) {
    const version = database.get('SELECT structure_status FROM document_versions WHERE id = ?', entry.document_version_id);
    if (!version) continue;
    const state = profileState(database, workspaceId, entry.document_version_id, entry.document_kind, version.structure_status);
    database.run(`
      UPDATE meeting_template_catalog
      SET profile_version_id = ?, readiness = ?, updated_at = ?
      WHERE id = ?
    `, state.profile?.profile_version_id || null, state.readiness, now, entry.id);
  }
}

export function registerMeetingTemplateCatalogEntry(database, workspaceId, uploaded, {
  kind,
  seriesId = null,
  displayName = null,
  actorPersonId = null,
  now = new Date().toISOString()
}) {
  if (!tableExists(database, 'meeting_template_catalog')) return null;
  if (!['protocol', 'extract'].includes(kind)) fail('meeting_template_kind_invalid');
  const existing = database.get(`
    SELECT * FROM meeting_template_catalog
    WHERE workspace_id = ? AND document_kind = ? AND document_version_id = ?
  `, workspaceId, kind, uploaded.version_id);
  if (existing) return existing;
  const series = clean(seriesId) || newId('mtseries');
  const last = database.get(`
    SELECT COALESCE(MAX(version_no), 0) AS version_no
    FROM meeting_template_catalog
    WHERE workspace_id = ? AND document_kind = ? AND series_id = ?
  `, workspaceId, kind, series);
  const structure = database.get('SELECT structure_status FROM document_versions WHERE id = ?', uploaded.version_id);
  const state = profileState(database, workspaceId, uploaded.version_id, kind, structure?.structure_status);
  return insertCatalog(database, {
    workspaceId,
    kind,
    seriesId: series,
    versionNo: Number(last?.version_no || 0) + 1,
    displayName: clean(displayName) || uploaded.original_name || uploaded.title || 'DOCX-шаблон',
    documentId: uploaded.document_id,
    documentVersionId: uploaded.version_id,
    profileVersionId: state.profile?.profile_version_id || null,
    readiness: state.readiness,
    actorPersonId,
    now
  });
}

function catalogRows(database, workspaceId, includeArchived, kind) {
  const params = [workspaceId];
  const filters = ['catalog.workspace_id = ?'];
  if (!includeArchived) filters.push("catalog.lifecycle_status = 'active'");
  if (kind) {
    filters.push('catalog.document_kind = ?');
    params.push(kind);
  }
  return database.all(`
    SELECT catalog.*, d.title AS document_title, d.lifecycle_status AS document_lifecycle_status,
      dv.original_name, dv.blob_sha256, dv.structure_status, dv.uploaded_at,
      creator.display_name AS created_by_name,
      (SELECT COUNT(*) FROM meetings m
        WHERE (catalog.document_kind = 'protocol' AND m.protocol_template_version_id = catalog.document_version_id)
           OR (catalog.document_kind = 'extract' AND m.extract_template_version_id = catalog.document_version_id)) AS meeting_count,
      (SELECT COUNT(*) FROM meeting_documents md
        WHERE md.template_version_id = catalog.document_version_id) AS generated_document_count,
      (SELECT COUNT(*) FROM meeting_template_test_runs tr
        WHERE tr.catalog_id = catalog.id) AS test_run_count,
      (SELECT MAX(tr.created_at) FROM meeting_template_test_runs tr
        WHERE tr.catalog_id = catalog.id) AS last_test_at
    FROM meeting_template_catalog catalog
    JOIN documents d ON d.id = catalog.document_id
    JOIN document_versions dv ON dv.id = catalog.document_version_id
    LEFT JOIN people creator ON creator.id = catalog.created_by_person_id
    WHERE ${filters.join(' AND ')}
    ORDER BY catalog.document_kind, catalog.is_default DESC,
      catalog.series_id, catalog.version_no DESC, catalog.updated_at DESC
  `, ...params);
}

export function listMeetingTemplateCatalog(database, workspaceId, {
  includeArchived = false,
  kind = null
} = {}) {
  ensureMeetingTemplateCatalog(database, workspaceId);
  syncMeetingTemplateCatalog(database, workspaceId);
  return catalogRows(database, workspaceId, includeArchived, kind).map((row) => {
    const latest = latestMeetingTemplateProfile(database, workspaceId, row.document_version_id, row.document_kind, false);
    return {
      ...row,
      profile_revision: row.profile_version_id
        ? meetingTemplateProfileByVersion(database, workspaceId, row.profile_version_id)?.revision || null
        : null,
      draft_profile_revision: latest?.status === 'draft' ? latest.revision : null,
      original_url: `/api/documents/${encodeURIComponent(row.document_id)}/content?variant=original`
    };
  });
}

export function getMeetingTemplateCatalogEntry(database, workspaceId, catalogId) {
  ensureMeetingTemplateCatalog(database, workspaceId);
  syncMeetingTemplateCatalog(database, workspaceId);
  return listMeetingTemplateCatalog(database, workspaceId, { includeArchived: true })
    .find((entry) => entry.id === catalogId) || null;
}

function requireCatalogEntry(database, workspaceId, catalogId) {
  const entry = getMeetingTemplateCatalogEntry(database, workspaceId, catalogId);
  if (!entry) fail('meeting_template_catalog_not_found');
  return entry;
}

function requireSelectable(entry) {
  if (entry.lifecycle_status !== 'active') fail('meeting_template_catalog_archived');
  if (!SELECTABLE_READINESS.has(entry.readiness)) fail('meeting_template_profile_incomplete');
  return entry;
}

export function assertMeetingTemplateCatalogSelectable(database, workspaceId, versionId, kind) {
  ensureMeetingTemplateCatalog(database, workspaceId);
  syncMeetingTemplateCatalog(database, workspaceId, versionId, kind);
  const entry = database.get(`
    SELECT * FROM meeting_template_catalog
    WHERE workspace_id = ? AND document_kind = ? AND document_version_id = ?
  `, workspaceId, kind, versionId);
  if (!entry) fail('meeting_template_catalog_not_found');
  return requireSelectable(entry);
}

export function syncMeetingTemplateDefaults(database, workspaceId, settings, now = new Date().toISOString()) {
  if (!tableExists(database, 'meeting_template_catalog') || !settings) return;
  for (const kind of ['protocol', 'extract']) {
    const versionId = settings[kind === 'protocol' ? 'protocol_template_version_id' : 'extract_template_version_id'];
    if (!versionId) continue;
    database.run(`UPDATE meeting_template_catalog SET is_default = 0, updated_at = ? WHERE workspace_id = ? AND document_kind = ?`, now, workspaceId, kind);
    database.run(`
      UPDATE meeting_template_catalog SET is_default = 1, updated_at = ?
      WHERE workspace_id = ? AND document_kind = ? AND document_version_id = ? AND lifecycle_status = 'active'
    `, now, workspaceId, kind, versionId);
  }
}

export function setMeetingTemplateDefault(database, workspaceId, catalogId, actorPersonId = null, now = new Date().toISOString()) {
  const entry = requireSelectable(requireCatalogEntry(database, workspaceId, catalogId));
  database.transaction(() => {
    database.run(`UPDATE meeting_template_catalog SET is_default = 0, updated_at = ? WHERE workspace_id = ? AND document_kind = ?`, now, workspaceId, entry.document_kind);
    database.run('UPDATE meeting_template_catalog SET is_default = 1, updated_at = ? WHERE id = ?', now, entry.id);
    const column = entry.document_kind === 'protocol' ? 'protocol_template_version_id' : 'extract_template_version_id';
    database.run(`UPDATE meeting_settings SET ${column} = ?, updated_by_person_id = ?, updated_at = ? WHERE workspace_id = ?`,
      entry.document_version_id, actorPersonId, now, workspaceId);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.template_catalog.defaulted', 'meeting_template_catalog', entry.id, {
      documentKind: entry.document_kind,
      documentVersionId: entry.document_version_id,
      versionNo: entry.version_no
    }, now);
  });
  return getMeetingTemplateCatalogEntry(database, workspaceId, entry.id);
}

export function meetingTemplateImpact(database, workspaceId, catalogId) {
  const entry = requireCatalogEntry(database, workspaceId, catalogId);
  const settings = database.get('SELECT * FROM meeting_settings WHERE workspace_id = ?', workspaceId);
  return {
    catalogId: entry.id,
    isDefault: Boolean(entry.is_default),
    currentSettings: Number(
      settings?.protocol_template_version_id === entry.document_version_id
      || settings?.extract_template_version_id === entry.document_version_id
    ),
    meetings: Number(entry.meeting_count || 0),
    generatedDocuments: Number(entry.generated_document_count || 0),
    profiles: Number(database.get(`
      SELECT COUNT(*) AS count FROM documents d
      JOIN document_versions dv ON dv.id = d.current_version_id
      WHERE d.workspace_id = ? AND d.document_type = 'meeting_template_profile'
        AND json_extract(dv.extracted_text, '$.templateVersionId') = ?
        AND json_extract(dv.extracted_text, '$.documentKind') = ?
    `, workspaceId, entry.document_version_id, entry.document_kind)?.count || 0),
    testRuns: Number(entry.test_run_count || 0)
  };
}

function replacementEntry(database, workspaceId, entry, replacementCatalogId) {
  if (!replacementCatalogId) return null;
  const replacement = requireSelectable(requireCatalogEntry(database, workspaceId, replacementCatalogId));
  if (replacement.id === entry.id || replacement.document_kind !== entry.document_kind) {
    fail('meeting_template_replacement_invalid');
  }
  return replacement;
}

export function archiveMeetingTemplateCatalogEntry(database, workspaceId, catalogId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const entry = requireCatalogEntry(database, workspaceId, catalogId);
  if (entry.lifecycle_status === 'archived') return { entry, impact: meetingTemplateImpact(database, workspaceId, catalogId), duplicateRequest: true };
  const impact = meetingTemplateImpact(database, workspaceId, catalogId);
  const replacement = replacementEntry(database, workspaceId, entry, input?.replacementCatalogId);
  if (impact.isDefault && !replacement) fail('meeting_template_default_archive_requires_replacement');
  const reason = required(input?.reason, 'meeting_template_archive_reason_required');
  database.transaction(() => {
    if (replacement) setMeetingTemplateDefault(database, workspaceId, replacement.id, actorPersonId, now);
    database.run(`
      UPDATE meeting_template_catalog
      SET lifecycle_status = 'archived', is_default = 0, archived_by_person_id = ?,
        archived_at = ?, archive_reason = ?, updated_at = ?
      WHERE id = ?
    `, actorPersonId, now, reason, now, entry.id);
    const active = Number(database.get(`
      SELECT COUNT(*) AS count FROM meeting_template_catalog
      WHERE document_id = ? AND lifecycle_status = 'active'
    `, entry.document_id)?.count || 0);
    if (!active) {
      database.run(`
        UPDATE documents SET lifecycle_status = 'archived', archived_by_person_id = ?,
          archived_at = ?, archive_reason = ?, updated_at = ? WHERE id = ?
      `, actorPersonId, now, reason, now, entry.document_id);
    }
    writeAudit(database, workspaceId, actorPersonId, 'meeting.template_catalog.archived', 'meeting_template_catalog', entry.id, {
      reason,
      replacementCatalogId: replacement?.id || null,
      impact
    }, now);
  });
  return { entry: getMeetingTemplateCatalogEntry(database, workspaceId, entry.id), impact, duplicateRequest: false };
}

export function restoreMeetingTemplateCatalogEntry(database, workspaceId, catalogId, actorPersonId = null, now = new Date().toISOString()) {
  const entry = requireCatalogEntry(database, workspaceId, catalogId);
  if (entry.lifecycle_status === 'active') return { entry, duplicateRequest: true };
  database.transaction(() => {
    database.run(`
      UPDATE meeting_template_catalog SET lifecycle_status = 'active', archived_by_person_id = NULL,
        archived_at = NULL, archive_reason = NULL, updated_at = ? WHERE id = ?
    `, now, entry.id);
    database.run(`
      UPDATE documents SET lifecycle_status = 'active', archived_by_person_id = NULL,
        archived_at = NULL, archive_reason = NULL, updated_at = ? WHERE id = ?
    `, now, entry.document_id);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.template_catalog.restored', 'meeting_template_catalog', entry.id, {}, now);
  });
  return { entry: getMeetingTemplateCatalogEntry(database, workspaceId, entry.id), duplicateRequest: false };
}

function sampleModel(kind) {
  return meetingDocumentModel({
    kind,
    meeting: {
      protocol_number: '7',
      meeting_date: '2026-09-15',
      title: 'Проверочное заседание кафедры',
      chairperson_raw: 'Иванов Иван Иванович',
      secretary_raw: 'Петрова Анна Сергеевна',
      quorum_required: 5
    },
    items: [
      { id: 'sample-1', item_no: 1, title: 'Первый проверочный вопрос', heard_text: 'Доклад по первому вопросу', discussed_text: 'Предложения учтены', decision_text: 'Утвердить решение по первому вопросу' },
      { id: 'sample-2', item_no: 2, title: 'Второй проверочный вопрос', heard_text: 'Доклад по второму вопросу', discussed_text: 'Замечаний нет', decision_text: 'Принять решение по второму вопросу' }
    ]
  });
}

function testRunRow(database, workspaceId, runId) {
  return database.get(`
    SELECT tr.*, catalog.display_name, catalog.version_no, catalog.document_kind,
      d.title, dv.original_name, fb.storage_path, dv.preview_status AS document_preview_status,
      dv.preview_error AS document_preview_error
    FROM meeting_template_test_runs tr
    JOIN meeting_template_catalog catalog ON catalog.id = tr.catalog_id
    JOIN documents d ON d.id = tr.generated_document_id
    JOIN document_versions dv ON dv.id = tr.generated_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE tr.workspace_id = ? AND tr.id = ?
  `, workspaceId, runId) || null;
}

async function materializeTestResult(database, workspaceId, row, duplicateRequest) {
  if (!row) return null;
  const analysis = await analyzeMeetingTemplatePath(row.storage_path);
  return {
    ...row,
    analysis,
    duplicateRequest,
    originalUrl: `/api/documents/${encodeURIComponent(row.generated_document_id)}/content?variant=original`,
    previewUrl: row.document_preview_status === 'ready'
      ? `/api/documents/${encodeURIComponent(row.generated_document_id)}/content?variant=preview`
      : null
  };
}

function previewFailure(error) {
  return {
    status: 'failed',
    blob: null,
    mediaType: null,
    error: String(error?.code || error?.message || error || 'preview_failed').slice(0, 1200)
  };
}

async function createOptionalPreview(config, outputPath, originalName, blob) {
  if (config.previewEnabled === false) {
    return { status: 'disabled', blob: null, mediaType: null, error: null };
  }
  try {
    return await buildDocumentPreview({
      sourcePath: outputPath,
      format: 'docx',
      originalName,
      originalMediaType: blob.mediaType,
      originalBlob: blob,
      blobDir: config.blobDir,
      tempDir: config.tempDir,
      enabled: true
    });
  } catch (error) {
    return previewFailure(error);
  }
}

function registerTestDocument(database, {
  workspaceId,
  entry,
  profile,
  requestHash,
  model,
  rendered,
  blob,
  actorPersonId,
  now
}) {
  const raced = database.get(`
    SELECT id FROM meeting_template_test_runs WHERE catalog_id = ? AND request_hash = ?
  `, entry.id, requestHash);
  if (raced) return { runId: raced.id, duplicateRequest: true };

  const documentId = newId('doc');
  const versionId = newId('docv');
  const runId = newId('mttest');
  database.run(`
    INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, blob.sha256, blob.sizeBytes, blob.mediaType, blob.storagePath, now);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES (?, ?, ?, 'meeting_template_test', 'processed', ?, ?, ?)
  `, documentId, workspaceId, `Проверка шаблона «${entry.display_name}»`, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type, detected_format,
      processing_status, extracted_text, extraction_error, upload_key, uploaded_at,
      structure_status, ocr_status, preview_status, preview_blob_sha256,
      preview_media_type, preview_error
    ) VALUES (?, ?, 1, ?, ?, ?, 'docx', 'processed', ?, NULL, ?, ?,
      'generated', 'not_needed', 'pending', NULL, NULL, NULL)
  `, versionId, documentId, blob.sha256, `Проверка ${entry.display_name}.docx`, blob.mediaType,
  rendered.text, `meeting-template-test:${entry.id}:${requestHash}`, now);
  ensureObjectPolicy(database, {
    workspaceId, objectKind: 'document', objectId: documentId,
    ownerPersonId: actorPersonId, accessScope: 'workspace', now
  });
  database.run(`
    INSERT INTO meeting_template_test_runs(
      id, workspace_id, catalog_id, profile_version_id, request_hash, model_json,
      generated_document_id, generated_document_version_id, preview_status,
      preview_error, created_by_person_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
  `, runId, workspaceId, entry.id, profile?.profile_version_id || null, requestHash,
  JSON.stringify(model), documentId, versionId, actorPersonId, now);
  return { runId, documentId, versionId, duplicateRequest: false };
}

function applyTestPreview(database, workspaceId, registration, preview, entry, actorPersonId, now) {
  database.transaction(() => {
    if (preview.blob) {
      database.run(`
        INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, preview.blob.sha256, preview.blob.sizeBytes,
      preview.mediaType || preview.blob.mediaType, preview.blob.storagePath, now);
    }
    database.run(`
      UPDATE document_versions
      SET preview_status = ?, preview_blob_sha256 = ?, preview_media_type = ?, preview_error = ?
      WHERE id = ?
    `, preview.status, preview.blob?.sha256 || null, preview.mediaType || null,
    preview.error || null, registration.versionId);
    database.run(`
      UPDATE meeting_template_test_runs SET preview_status = ?, preview_error = ? WHERE id = ?
    `, preview.status, preview.error || null, registration.runId);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.template_catalog.tested', 'meeting_template_catalog', entry.id, {
      runId: registration.runId,
      documentId: registration.documentId,
      documentVersionId: registration.versionId,
      previewStatus: preview.status,
      previewError: preview.error || null
    }, now);
  });
}

export async function testMeetingTemplateCatalogEntry(database, config, workspaceId, catalogId, actorPersonId = null) {
  const entry = requireSelectable(requireCatalogEntry(database, workspaceId, catalogId));
  const template = assertDocxTemplate(database, workspaceId, entry.document_version_id);
  const profile = entry.profile_version_id
    ? meetingTemplateProfileByVersion(database, workspaceId, entry.profile_version_id)
    : latestMeetingTemplateProfile(database, workspaceId, entry.document_version_id, entry.document_kind, true);
  if (entry.readiness === 'ready' && !profile) fail('meeting_template_profile_incomplete');
  const model = sampleModel(entry.document_kind);
  const requestHash = createHash('sha256').update(JSON.stringify({
    schema: 2,
    catalogId: entry.id,
    templateSha256: template.blob_sha256,
    profileSha256: profile?.profileSha256 || null,
    model
  })).digest('hex');
  const existing = database.get(`
    SELECT id FROM meeting_template_test_runs WHERE catalog_id = ? AND request_hash = ?
  `, entry.id, requestHash);
  if (existing) return materializeTestResult(database, workspaceId, testRunRow(database, workspaceId, existing.id), true);

  await mkdir(config.tempDir, { recursive: true });
  const outputPath = join(config.tempDir, `${entry.id}-${requestHash.slice(0, 16)}-${newId('tmp')}.docx`);
  try {
    const rendered = await renderMeetingDocumentFile({
      templatePath: template.storage_path,
      outputPath,
      model,
      profile: entry.readiness === 'legacy_compatible' ? null : profile
    });
    const blob = await storeGeneratedFile(outputPath, {
      blobDir: config.blobDir,
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const now = new Date().toISOString();
    let registration;
    database.transaction(() => {
      registration = registerTestDocument(database, {
        workspaceId,
        entry,
        profile,
        requestHash,
        model,
        rendered,
        blob,
        actorPersonId,
        now
      });
    });
    if (registration.duplicateRequest) {
      return materializeTestResult(database, workspaceId,
        testRunRow(database, workspaceId, registration.runId), true);
    }

    // К этому моменту DOCX и его версия уже атомарно зарегистрированы и
    // доступны. Preview — отдельная необязательная проекция: ни отсутствие
    // LibreOffice, ни ошибка конвертации не могут отменить готовый DOCX.
    const preview = await createOptionalPreview(
      config,
      outputPath,
      `Проверка ${entry.display_name}.docx`,
      blob
    );
    applyTestPreview(database, workspaceId, registration, preview, entry, actorPersonId,
      new Date().toISOString());
    return materializeTestResult(database, workspaceId,
      testRunRow(database, workspaceId, registration.runId), false);
  } finally {
    await rm(outputPath, { force: true });
  }
}
