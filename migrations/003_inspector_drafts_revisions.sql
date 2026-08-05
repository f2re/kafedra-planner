ALTER TABLE calendar_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS calendar_item_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_item_id TEXT NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
  previous_json TEXT NOT NULL,
  current_json TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_calendar_item_revisions
ON calendar_item_revisions(workspace_id, calendar_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS template_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 1 CHECK(step BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_template_drafts_updated
ON template_drafts(workspace_id, updated_at DESC);
