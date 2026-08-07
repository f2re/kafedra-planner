CREATE TABLE IF NOT EXISTS plan_document_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  plan_kind TEXT NOT NULL,
  period_kind TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'active',
  config_json TEXT NOT NULL DEFAULT '{}',
  analysis_json TEXT NOT NULL DEFAULT '{}',
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id, name)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_document_templates_status
ON plan_document_templates(workspace_id, status, plan_kind, updated_at);
CREATE INDEX IF NOT EXISTS idx_plan_document_templates_source
ON plan_document_templates(source_document_version_id);

CREATE TABLE IF NOT EXISTS plan_generation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES plan_document_templates(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  target_period_kind TEXT NOT NULL,
  target_period_key TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  generated_document_id TEXT REFERENCES documents(id) ON DELETE RESTRICT,
  generated_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  output_sha256 TEXT REFERENCES file_blobs(sha256) ON DELETE RESTRICT,
  error_message TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_generation_runs_template
ON plan_generation_runs(workspace_id, template_id, started_at);
CREATE INDEX IF NOT EXISTS idx_plan_generation_runs_document
ON plan_generation_runs(generated_document_id);
CREATE INDEX IF NOT EXISTS idx_plan_generation_runs_status
ON plan_generation_runs(workspace_id, status, updated_at);
