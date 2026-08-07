CREATE TABLE IF NOT EXISTS plan_template_revisions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(template_id, version)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_template_revisions
ON plan_template_revisions(template_id, version DESC);
