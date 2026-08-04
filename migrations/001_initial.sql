CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS file_blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  media_type TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'uploaded',
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_documents_workspace_updated ON documents(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  blob_sha256 TEXT NOT NULL REFERENCES file_blobs(sha256) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  detected_format TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'queued',
  extracted_text TEXT,
  extraction_error TEXT,
  upload_key TEXT UNIQUE,
  uploaded_at TEXT NOT NULL,
  UNIQUE(document_id, version_no)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_document_versions_blob ON document_versions(blob_sha256);

CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  extractor_code TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  protocol_number TEXT,
  meeting_date TEXT,
  title TEXT NOT NULL,
  chairperson_raw TEXT,
  secretary_raw TEXT,
  attendees_raw TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(workspace_id, meeting_date);

CREATE TABLE IF NOT EXISTS agenda_items (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  item_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  heard_text TEXT,
  discussed_text TEXT,
  decision_text TEXT,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(meeting_id, item_no)
) STRICT;

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  responsible_raw TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_decisions_due ON decisions(due_date);

CREATE TABLE IF NOT EXISTS calendar_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 1 CHECK (all_day IN (0, 1)),
  category TEXT NOT NULL DEFAULT 'organizational',
  importance TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'proposed',
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_kind, source_id, starts_at, title)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_calendar_range ON calendar_items(workspace_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_json TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_review_open ON review_items(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TEXT NOT NULL,
  locked_by TEXT,
  lease_until TEXT,
  last_error TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_jobs_available ON jobs(status, available_at, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS search_fragments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  document_version_id TEXT REFERENCES document_versions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_search_source ON search_fragments(source_kind, source_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  fragment_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
