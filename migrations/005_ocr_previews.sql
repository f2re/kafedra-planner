ALTER TABLE document_versions ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE document_versions ADD COLUMN ocr_engine TEXT;
ALTER TABLE document_versions ADD COLUMN ocr_languages TEXT;
ALTER TABLE document_versions ADD COLUMN ocr_confidence REAL;
ALTER TABLE document_versions ADD COLUMN ocr_error TEXT;

ALTER TABLE document_versions ADD COLUMN preview_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE document_versions ADD COLUMN preview_blob_sha256 TEXT REFERENCES file_blobs(sha256) ON DELETE SET NULL;
ALTER TABLE document_versions ADD COLUMN preview_media_type TEXT;
ALTER TABLE document_versions ADD COLUMN preview_error TEXT;

CREATE INDEX IF NOT EXISTS idx_document_versions_preview
ON document_versions(preview_status, preview_blob_sha256);

CREATE INDEX IF NOT EXISTS idx_document_versions_ocr
ON document_versions(ocr_status, uploaded_at DESC);
