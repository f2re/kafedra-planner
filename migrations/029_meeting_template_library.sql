CREATE TABLE meeting_template_catalog (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_kind TEXT NOT NULL CHECK(document_kind IN ('protocol', 'extract')),
  series_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  display_name TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  profile_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  readiness TEXT NOT NULL DEFAULT 'needs_setup'
    CHECK(readiness IN ('needs_setup', 'draft', 'ready', 'legacy_compatible', 'error')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK(lifecycle_status IN ('active', 'archived')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  archived_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  archived_at TEXT,
  archive_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, document_kind, document_version_id),
  UNIQUE(workspace_id, document_kind, series_id, version_no)
) STRICT;

CREATE UNIQUE INDEX idx_meeting_template_catalog_default
ON meeting_template_catalog(workspace_id, document_kind)
WHERE is_default = 1 AND lifecycle_status = 'active';

CREATE INDEX idx_meeting_template_catalog_list
ON meeting_template_catalog(workspace_id, document_kind, lifecycle_status, updated_at DESC);

CREATE INDEX idx_meeting_template_catalog_series
ON meeting_template_catalog(workspace_id, document_kind, series_id, version_no DESC);

CREATE TABLE meeting_template_test_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL REFERENCES meeting_template_catalog(id) ON DELETE RESTRICT,
  profile_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  model_json TEXT NOT NULL,
  generated_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  generated_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  preview_status TEXT NOT NULL,
  preview_error TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(catalog_id, request_hash)
) STRICT;

CREATE INDEX idx_meeting_template_test_runs_catalog
ON meeting_template_test_runs(catalog_id, created_at DESC);
