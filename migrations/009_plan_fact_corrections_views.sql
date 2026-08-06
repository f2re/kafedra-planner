CREATE TABLE IF NOT EXISTS plan_fact_metric_corrections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  assignment_evidence_id TEXT REFERENCES assignment_evidence(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  field_kind TEXT NOT NULL CHECK(field_kind IN ('target_numeric', 'actual_numeric')),
  machine_value REAL,
  corrected_value REAL NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 3),
  actor_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  superseded_by_id TEXT REFERENCES plan_fact_metric_corrections(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  reverted_at TEXT,
  reverted_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  revert_reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_plan_fact_metric_corrections_assignment
ON plan_fact_metric_corrections(workspace_id, assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_fact_metric_corrections_evidence
ON plan_fact_metric_corrections(assignment_evidence_id, metric_key, field_kind);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_fact_metric_correction_active
ON plan_fact_metric_corrections(
  assignment_id,
  COALESCE(assignment_evidence_id, ''),
  metric_key,
  field_kind
)
WHERE superseded_by_id IS NULL AND reverted_at IS NULL;

CREATE TABLE IF NOT EXISTS plan_fact_saved_views (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
  owner_person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  is_shared INTEGER NOT NULL DEFAULT 0 CHECK(is_shared IN (0, 1)),
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_fact_saved_view_name
ON plan_fact_saved_views(
  workspace_id,
  COALESCE(owner_person_id, ''),
  name
);

CREATE INDEX IF NOT EXISTS idx_plan_fact_saved_views_scope
ON plan_fact_saved_views(workspace_id, is_shared, owner_person_id, updated_at DESC);
