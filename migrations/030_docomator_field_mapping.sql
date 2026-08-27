CREATE TABLE IF NOT EXISTS docomator_field_mappings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  email_property_key TEXT,
  position_property_key TEXT,
  extra_property_keys_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS docomator_person_fields (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  remote_employee_id TEXT NOT NULL,
  remote_property_key TEXT NOT NULL,
  remote_property_label TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  value_json TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, person_id, remote_property_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_docomator_person_fields_remote
ON docomator_person_fields(workspace_id, remote_employee_id, remote_property_key);

CREATE INDEX IF NOT EXISTS idx_docomator_person_fields_person
ON docomator_person_fields(workspace_id, person_id, last_synced_at DESC);
