import { newId } from '../../core/src/ids.mjs';
import { enqueueJob } from './jobs.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function reprocessRequestedType(documentType, uploadKey) {
  if (String(uploadKey || '').startsWith('protocol-year:')) return 'protocol';
  if (documentType === 'department_protocol') return 'protocol';
  if (['directive', 'order', 'decree'].includes(documentType)) return documentType;
  if (['plan', 'department_plan', 'faculty_plan', 'personal_plan', 'unit_plan', 'organization_plan'].includes(documentType)) return documentType;
  if (['article', 'conference', 'grant', 'patent', 'project', 'nir_report', 'science'].includes(documentType)) return documentType;
  return 'auto';
}

export function registerDocument(database, {
  workspaceId,
  title,
  originalName,
  mediaType,
  detectedFormat,
  blob,
  requestedType = 'auto',
  idempotencyKey = null
}) {
  const now = new Date().toISOString();
  if (idempotencyKey) {
    const existing = database.get(`
      SELECT d.id AS document_id, dv.id AS version_id, dv.blob_sha256, dv.processing_status
      FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id
      WHERE dv.upload_key = ?
    `, idempotencyKey);
    if (existing) {
      const job = database.get('SELECT id FROM jobs WHERE idempotency_key = ?', `upload:${idempotencyKey}`);
      return {
        documentId: existing.document_id,
        versionId: existing.version_id,
        jobId: job?.id ?? null,
        sha256: existing.blob_sha256,
        status: existing.processing_status,
        duplicateRequest: true
      };
    }
  }
  return database.transaction(() => {
    database.run(`
      INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, blob.sha256, blob.sizeBytes, mediaType, blob.storagePath, now);

    const documentId = newId('doc');
    const versionId = newId('docv');
    database.run(`
      INSERT INTO documents(
        id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?)
    `, documentId, workspaceId, title, requestedType === 'auto' ? 'unknown' : requestedType, versionId, now, now);
    database.run(`
      INSERT INTO document_versions(
        id, document_id, version_no, blob_sha256, original_name, media_type,
        detected_format, processing_status, upload_key, uploaded_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 'queued', ?, ?)
    `, versionId, documentId, blob.sha256, originalName, mediaType, detectedFormat, idempotencyKey, now);

    const job = enqueueJob(database, {
      kind: 'process_document',
      payload: { workspaceId, documentId, versionId, requestedType },
      priority: 10,
      idempotencyKey: idempotencyKey ? `upload:${idempotencyKey}` : `process:${versionId}`
    });
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, 'operator', 'document.uploaded', 'document', ?, ?, ?)
    `, newId('audit'), workspaceId, documentId, JSON.stringify({ versionId, originalName, sha256: blob.sha256 }), now);
    return { documentId, versionId, jobId: job.id, sha256: blob.sha256, status: 'queued' };
  });
}

export function requestDocumentReprocess(database, { workspaceId, documentId }) {
  const document = database.get(`
    SELECT d.id AS document_id, d.document_type, dv.id AS version_id,
      dv.blob_sha256, dv.upload_key
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
  if (!document) return null;

  return database.transaction(() => {
    const keyPrefix = `reprocess:${document.version_id}:%`;
    const active = database.get(`
      SELECT id, status FROM jobs
      WHERE idempotency_key LIKE ? AND status IN ('queued', 'retry', 'running')
      ORDER BY created_at DESC LIMIT 1
    `, keyPrefix);
    if (active) {
      return {
        documentId: document.document_id,
        versionId: document.version_id,
        jobId: active.id,
        sha256: document.blob_sha256,
        status: active.status,
        duplicateRequest: true
      };
    }

    const previous = Number(database.get(`
      SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key LIKE ?
    `, keyPrefix)?.count || 0);
    const idempotencyKey = `reprocess:${document.version_id}:${previous + 1}`;
    const now = new Date().toISOString();
    const job = enqueueJob(database, {
      kind: 'process_document',
      payload: {
        workspaceId,
        documentId: document.document_id,
        versionId: document.version_id,
        requestedType: reprocessRequestedType(document.document_type, document.upload_key),
        reprocess: true
      },
      priority: 10,
      idempotencyKey
    });
    database.run(`
      UPDATE document_versions
      SET processing_status = 'queued', extraction_error = NULL
      WHERE id = ?
    `, document.version_id);
    database.run(`
      UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?
    `, now, document.document_id);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, 'operator', 'document.reprocess_requested', 'document', ?, ?, ?)
    `, newId('audit'), workspaceId, document.document_id, JSON.stringify({
      versionId: document.version_id,
      sha256: document.blob_sha256,
      jobId: job.id
    }), now);
    return {
      documentId: document.document_id,
      versionId: document.version_id,
      jobId: job.id,
      sha256: document.blob_sha256,
      status: 'queued',
      duplicateRequest: false
    };
  });
}

export function listDocuments(database, workspaceId, limit = 100) {
  return database.all(`
    SELECT
      d.id, d.title, d.document_type, d.status, d.created_at, d.updated_at,
      dv.id AS version_id, dv.original_name, dv.media_type, dv.detected_format,
      dv.processing_status, dv.extraction_error, dv.structure_status,
      dv.ocr_status, dv.ocr_engine, dv.ocr_languages, dv.ocr_confidence, dv.ocr_error,
      dv.preview_status, dv.preview_media_type, dv.preview_error,
      fb.size_bytes, fb.sha256
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ?
      AND d.document_type NOT IN ('meeting_template_profile', 'meeting_template_test')
    ORDER BY d.updated_at DESC
    LIMIT ?
  `, workspaceId, limit);
}

function meetingDetails(database, versionId) {
  return database.all(`
    SELECT * FROM meetings
    WHERE source_document_version_id = ?
    ORDER BY meeting_date, created_at
  `, versionId).map((meeting) => ({
    ...meeting,
    evidence: parseJson(meeting.evidence_json, {}),
    agendaItems: database.all(`
      SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no
    `, meeting.id).map((item) => ({
      ...item,
      evidence: parseJson(item.evidence_json, {}),
      decisions: database.all(`
        SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at
      `, item.id).map((decision) => ({
        ...decision,
        evidence: parseJson(decision.evidence_json, {})
      }))
    }))
  }));
}

export function getDocument(database, workspaceId, documentId) {
  const document = database.get(`
    SELECT d.*, dv.original_name, dv.media_type, dv.detected_format,
      dv.processing_status, dv.extracted_text, dv.extraction_error,
      dv.structure_status, dv.structure_extractor, dv.structure_version,
      dv.ocr_status, dv.ocr_engine, dv.ocr_languages, dv.ocr_confidence, dv.ocr_error,
      dv.preview_status, dv.preview_media_type, dv.preview_error,
      dv.uploaded_at, fb.sha256, fb.size_bytes
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
  if (!document) return null;

  const templateExtractions = database.all(`
    SELECT te.*, t.name AS template_name, t.document_type AS template_document_type,
      t.fields_json
    FROM template_extractions te
    JOIN document_templates t ON t.id = te.template_id
    WHERE te.document_version_id = ?
    ORDER BY te.created_at DESC
  `, document.current_version_id).map((row) => {
    const valuesPayload = parseJson(row.values_json, {});
    return {
      ...row,
      values: valuesPayload.values || {},
      evidence: valuesPayload.evidence || {},
      missing: parseJson(row.missing_json, []),
      fields: parseJson(row.fields_json, [])
    };
  });

  const reviews = database.all(`
    SELECT * FROM review_items
    WHERE source_kind = 'document_version' AND source_id = ?
    ORDER BY status = 'open' DESC, created_at
  `, document.current_version_id).map((row) => ({
    ...row,
    context: parseJson(row.context_json, {})
  }));

  const lines = String(document.extracted_text || '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .slice(0, 2000)
    .map((text, index) => ({ number: index + 1, text }));

  return {
    ...document,
    previewUrl: document.preview_status === 'ready'
      ? `/api/documents/${encodeURIComponent(document.id)}/content?variant=preview`
      : null,
    originalUrl: `/api/documents/${encodeURIComponent(document.id)}/content?variant=original`,
    lines,
    meetings: meetingDetails(database, document.current_version_id),
    templateExtractions,
    reviews,
    extractionRuns: database.all(`
      SELECT * FROM extraction_runs
      WHERE document_version_id = ?
      ORDER BY started_at DESC
    `, document.current_version_id).map((row) => ({
      ...row,
      result: parseJson(row.result_json, null)
    }))
  };
}
