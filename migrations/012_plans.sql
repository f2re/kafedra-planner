CREATE TABLE IF NOT EXISTS plan_ingest_hints (
  document_version_id TEXT PRIMARY KEY REFERENCES document_versions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_scope TEXT,
  period_kind TEXT,
  period_key TEXT,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  source_template_id TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_ingest_hints_workspace
ON plan_ingest_hints(workspace_id, plan_scope, period_key);

CREATE TABLE IF NOT EXISTS plan_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  plan_scope TEXT NOT NULL DEFAULT 'department'
    CHECK(plan_scope IN ('department','faculty','personal','unit','organization')),
  period_kind TEXT NOT NULL DEFAULT 'calendar_year'
    CHECK(period_kind IN ('calendar_year','academic_year')),
  year_token TEXT,
  year_locator_json TEXT NOT NULL DEFAULT '{}',
  table_index INTEGER NOT NULL CHECK(table_index > 0),
  header_row INTEGER NOT NULL CHECK(header_row > 0),
  sample_row INTEGER NOT NULL CHECK(sample_row > 0),
  column_map_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_templates_workspace
ON plan_templates(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_generations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES plan_templates(id) ON DELETE RESTRICT,
  generated_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL UNIQUE,
  plan_scope TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(generated_document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_generations_template
ON plan_generations(workspace_id, template_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  source_template_id TEXT REFERENCES plan_templates(id) ON DELETE SET NULL,
  plan_scope TEXT NOT NULL DEFAULT 'unit'
    CHECK(plan_scope IN ('department','faculty','personal','unit','organization')),
  title TEXT NOT NULL,
  period_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK(period_kind IN ('calendar_year','academic_year','custom','unknown')),
  period_key TEXT,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  owner_raw TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plans_lookup
ON plans(workspace_id, plan_scope, period_kind, period_key, status);
CREATE INDEX IF NOT EXISTS idx_plans_owner
ON plans(workspace_id, owner_person_id, period_key);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  source_row_key TEXT NOT NULL,
  source_item_no TEXT,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT,
  ends_at TEXT,
  due_date TEXT,
  item_kind TEXT NOT NULL DEFAULT 'event' CHECK(item_kind IN ('event','task','milestone')),
  direction TEXT NOT NULL DEFAULT 'organizational',
  responsible_raw TEXT,
  responsible_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  expected_result TEXT,
  importance TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'planned',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, source_row_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_plan_items_dates
ON plan_items(plan_id, starts_at, due_date, status);
CREATE INDEX IF NOT EXISTS idx_plan_items_responsible
ON plan_items(responsible_person_id, due_date);
