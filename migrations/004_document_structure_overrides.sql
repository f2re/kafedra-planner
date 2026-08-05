ALTER TABLE document_versions ADD COLUMN structure_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE document_versions ADD COLUMN structure_extractor TEXT;
ALTER TABLE document_versions ADD COLUMN structure_version TEXT;

CREATE TABLE IF NOT EXISTS document_blocks (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  block_type TEXT NOT NULL,
  text TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  geometry_json TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_version_id, sequence_no)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_document_blocks_version
ON document_blocks(document_version_id, sequence_no);

CREATE TABLE IF NOT EXISTS extraction_value_overrides (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_extraction_id TEXT NOT NULL REFERENCES template_extractions(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL DEFAULT 'operator',
  created_at TEXT NOT NULL,
  superseded_at TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_value_override_active
ON extraction_value_overrides(template_extraction_id, field_key)
WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_extraction_value_overrides_workspace
ON extraction_value_overrides(workspace_id, created_at DESC);
