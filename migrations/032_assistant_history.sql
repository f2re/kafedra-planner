CREATE TABLE IF NOT EXISTS assistant_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  task TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed', 'failed', 'aborted', 'disabled')),
  result_json TEXT,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assistant_runs_owner
ON assistant_runs(workspace_id, owner_key, created_at DESC, id DESC);
