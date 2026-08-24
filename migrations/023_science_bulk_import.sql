CREATE TABLE science_import_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  source_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','completed_with_errors','failed')),
  mapping_json TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  review_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX idx_science_import_runs_workspace
ON science_import_runs(workspace_id, created_at DESC, status);
CREATE INDEX idx_science_import_runs_document
ON science_import_runs(source_document_version_id, created_at DESC);

CREATE TABLE science_import_rows (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES science_import_runs(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  source_json TEXT NOT NULL,
  normalized_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('imported','updated','skipped','needs_review','error')),
  scientific_item_id TEXT REFERENCES scientific_items(id) ON DELETE SET NULL,
  dedupe_key TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, row_no)
) STRICT;
CREATE INDEX idx_science_import_rows_status
ON science_import_rows(run_id, status, row_no);
CREATE INDEX idx_science_import_rows_item
ON science_import_rows(scientific_item_id, created_at DESC);
