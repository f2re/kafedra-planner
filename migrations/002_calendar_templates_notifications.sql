ALTER TABLE calendar_items ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'event';
ALTER TABLE calendar_items ADD COLUMN reminder_minutes INTEGER CHECK (reminder_minutes IS NULL OR reminder_minutes >= 0);
ALTER TABLE calendar_items ADD COLUMN completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_tasks
ON calendar_items(workspace_id, item_kind, status, starts_at);

CREATE TABLE IF NOT EXISTS notification_states (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY(workspace_id, notification_key)
) STRICT;

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'custom_document',
  status TEXT NOT NULL DEFAULT 'active',
  matcher_json TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, code, version)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_templates_workspace_status
ON document_templates(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS template_extractions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  values_json TEXT NOT NULL,
  missing_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  UNIQUE(template_id, document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_template_extractions_document
ON template_extractions(document_version_id, created_at DESC);
