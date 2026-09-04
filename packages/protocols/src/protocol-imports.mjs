function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function protocolImportYear(uploadKey) {
  const match = String(uploadKey || '').match(/^protocol-year:(20\d{2}):[a-z0-9._-]+$/u);
  return match ? Number(match[1]) : null;
}

export function normalizeProtocolImportYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const error = new Error('protocol_import_year_invalid');
    error.code = 'protocol_import_year_invalid';
    throw error;
  }
  return year;
}

function latestExtraction(database, versionId) {
  const row = database.get(`
    SELECT status, result_json, error_code, error_message, started_at, completed_at
    FROM extraction_runs
    WHERE document_version_id = ?
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `, versionId);
  if (!row) return null;
  return { ...row, result: parseJson(row.result_json, {}) || {} };
}

function openReviews(database, workspaceId, versionId) {
  return database.all(`
    SELECT id, issue_code, title, explanation, proposed_action, severity,
      context_json, created_at
    FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND status = 'open'
    ORDER BY created_at, id
  `, workspaceId, versionId).map((row) => ({
    ...row,
    context: parseJson(row.context_json, {}) || {}
  }));
}

function materializedMeeting(database, workspaceId, versionId, extraction) {
  const routedId = extraction?.result?.protocol?.id || null;
  if (routedId) {
    const routed = database.get(`
      SELECT id, protocol_number, meeting_date, title, status, confidence
      FROM meetings WHERE workspace_id = ? AND id = ?
    `, workspaceId, routedId);
    if (routed) return routed;
  }
  return database.get(`
    SELECT id, protocol_number, meeting_date, title, status, confidence
    FROM meetings
    WHERE workspace_id = ? AND source_document_version_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, versionId) || null;
}

function itemState(row, meeting, reviews) {
  if (row.processing_status === 'failed') return 'failed';
  if (['queued', 'extracting'].includes(row.processing_status)) return 'processing';
  if (reviews.length) return 'needs_review';
  if (meeting && ['processed', 'needs_review'].includes(row.processing_status)) return 'ready';
  if (row.processing_status === 'needs_review') return 'needs_review';
  if (row.processing_status === 'processed') return 'needs_review';
  return 'processing';
}

export function listProtocolImports(database, workspaceId, yearValue, limit = 500) {
  const year = normalizeProtocolImportYear(yearValue);
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 500));
  const rows = database.all(`
    SELECT d.id AS document_id, d.title, d.document_type, d.status AS document_status,
      dv.id AS version_id, dv.original_name, dv.processing_status,
      dv.extraction_error, dv.upload_key, dv.uploaded_at,
      dv.preview_status, dv.preview_error,
      fb.sha256, fb.size_bytes
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND dv.upload_key LIKE ?
    ORDER BY dv.uploaded_at DESC, dv.id DESC
    LIMIT ?
  `, workspaceId, `protocol-year:${year}:%`, safeLimit);

  const items = rows.map((row) => {
    const extraction = latestExtraction(database, row.version_id);
    const reviews = openReviews(database, workspaceId, row.version_id);
    const meeting = materializedMeeting(database, workspaceId, row.version_id, extraction);
    const state = itemState(row, meeting, reviews);
    return {
      ...row,
      import_year: year,
      state,
      meeting_id: meeting?.id || null,
      protocol_number: meeting?.protocol_number || extraction?.result?.protocol?.protocolNumber || null,
      meeting_date: meeting?.meeting_date || extraction?.result?.protocol?.meetingDate || null,
      agenda_count: Number(extraction?.result?.protocol?.agendaItems?.length || 0),
      review_count: reviews.length,
      reviews,
      extraction_status: extraction?.status || null,
      extraction_error: row.extraction_error || extraction?.error_message || null,
      original_url: `/api/documents/${encodeURIComponent(row.document_id)}/content?variant=original`,
      preview_url: row.preview_status === 'ready'
        ? `/api/documents/${encodeURIComponent(row.document_id)}/content?variant=preview`
        : null
    };
  });

  const summary = { total: items.length, ready: 0, needs_review: 0, failed: 0, processing: 0 };
  for (const item of items) summary[item.state] += 1;
  return { year, items, summary };
}
