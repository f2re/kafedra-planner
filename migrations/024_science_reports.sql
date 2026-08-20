CREATE TABLE science_report_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('csv','docx')),
  filters_json TEXT NOT NULL DEFAULT '{}',
  fields_json TEXT NOT NULL,
  template_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  row_count INTEGER NOT NULL DEFAULT 0,
  generated_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  generated_document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  output_sha256 TEXT,
  error_message TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX idx_science_report_runs_workspace
ON science_report_runs(workspace_id, created_at DESC, status);
CREATE INDEX idx_science_report_runs_document
ON science_report_runs(generated_document_id, created_at DESC);
