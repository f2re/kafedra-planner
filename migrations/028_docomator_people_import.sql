CREATE TABLE IF NOT EXISTS docomator_integrations (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL DEFAULT 'http' CHECK(scheme IN ('http', 'https')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 8080 CHECK(port BETWEEN 1 AND 65535),
  space_id TEXT,
  group_id TEXT,
  include_inactive INTEGER NOT NULL DEFAULT 0 CHECK(include_inactive IN (0, 1)),
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TEXT,
  last_imported_at TEXT,
  remote_version TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS docomator_person_links (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  remote_employee_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  remote_space_id TEXT NOT NULL,
  remote_display_name TEXT NOT NULL,
  remote_status TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, remote_employee_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_docomator_person_links_person
ON docomator_person_links(workspace_id, person_id, last_synced_at DESC);
