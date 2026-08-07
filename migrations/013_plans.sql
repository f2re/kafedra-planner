CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  plan_kind TEXT NOT NULL,
  period_kind TEXT NOT NULL DEFAULT 'unknown',
  period_key TEXT,
  year_start INTEGER,
  year_end INTEGER,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  owner_raw TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plans_period
ON plans(workspace_id, plan_kind, period_kind, period_key, status);
CREATE INDEX IF NOT EXISTS idx_plans_owner
ON plans(workspace_id, owner_person_id, period_key);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  source_item_key TEXT NOT NULL,
  item_no TEXT,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT,
  ends_at TEXT,
  due_date TEXT,
  responsible_raw TEXT,
  responsible_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'organizational',
  expected_result TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, source_item_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_items_dates
ON plan_items(plan_id, starts_at, due_date, status);
CREATE INDEX IF NOT EXISTS idx_plan_items_responsible
ON plan_items(responsible_person_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_plan_items_direction
ON plan_items(plan_id, direction, status);

ALTER TABLE calendar_items ADD COLUMN origin_kind TEXT;
ALTER TABLE calendar_items ADD COLUMN origin_id TEXT;
ALTER TABLE calendar_items ADD COLUMN origin_label TEXT;
ALTER TABLE calendar_items ADD COLUMN origin_document_id TEXT;
ALTER TABLE calendar_items ADD COLUMN origin_locator_json TEXT;
CREATE INDEX IF NOT EXISTS idx_calendar_origin
ON calendar_items(workspace_id, origin_kind, origin_id);
CREATE INDEX IF NOT EXISTS idx_calendar_origin_document
ON calendar_items(workspace_id, origin_document_id, starts_at);
