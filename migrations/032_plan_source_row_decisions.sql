ALTER TABLE plan_source_rows
ADD COLUMN inclusion_status TEXT NOT NULL DEFAULT 'included'
CHECK(inclusion_status IN ('included', 'excluded'));

ALTER TABLE plan_source_rows
ADD COLUMN inclusion_decided_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE plan_source_rows
ADD COLUMN inclusion_decided_at TEXT;

ALTER TABLE plan_source_rows
ADD COLUMN inclusion_reason TEXT;

ALTER TABLE plan_source_rows
ADD COLUMN exclusion_snapshot_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_plan_source_rows_inclusion
ON plan_source_rows(plan_id, inclusion_status, row_role, row_number);

CREATE TABLE IF NOT EXISTS plan_source_row_decisions (
  id TEXT PRIMARY KEY,
  source_row_id TEXT NOT NULL REFERENCES plan_source_rows(id) ON DELETE CASCADE,
  decision_no INTEGER NOT NULL CHECK(decision_no > 0),
  inclusion_status TEXT NOT NULL CHECK(inclusion_status IN ('included', 'excluded')),
  actor_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  reason TEXT,
  impact_json TEXT NOT NULL DEFAULT '{}',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_row_id, decision_no)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_plan_source_row_decisions_row
ON plan_source_row_decisions(source_row_id, decision_no DESC);

CREATE INDEX IF NOT EXISTS idx_plan_source_row_decisions_actor
ON plan_source_row_decisions(actor_person_id, created_at DESC);
