export function getDocumentFile(database, workspaceId, documentId, variant = 'original') {
  const row = database.get(`
    SELECT
      d.id AS document_id,
      d.title,
      dv.id AS version_id,
      dv.original_name,
      dv.media_type AS original_media_type,
      dv.detected_format,
      dv.preview_status,
      dv.preview_media_type,
      dv.preview_error,
      original.sha256 AS original_sha256,
      original.size_bytes AS original_size,
      original.storage_path AS original_path,
      preview.sha256 AS preview_sha256,
      preview.size_bytes AS preview_size,
      preview.storage_path AS preview_path
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs original ON original.sha256 = dv.blob_sha256
    LEFT JOIN file_blobs preview ON preview.sha256 = dv.preview_blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
  if (!row) return null;

  if (variant === 'preview') {
    if (row.preview_status !== 'ready' || !row.preview_path) {
      return {
        documentId: row.document_id,
        variant,
        available: false,
        status: row.preview_status,
        error: row.preview_error || null
      };
    }
    return {
      documentId: row.document_id,
      variant,
      available: true,
      path: row.preview_path,
      mediaType: row.preview_media_type || 'application/octet-stream',
      sizeBytes: row.preview_size,
      sha256: row.preview_sha256,
      fileName: String(row.preview_media_type || '').startsWith('image/')
        ? row.original_name
        : `${row.title || 'document'}.pdf`
    };
  }

  return {
    documentId: row.document_id,
    variant: 'original',
    available: true,
    path: row.original_path,
    mediaType: row.original_media_type || 'application/octet-stream',
    sizeBytes: row.original_size,
    sha256: row.original_sha256,
    fileName: row.original_name
  };
}
