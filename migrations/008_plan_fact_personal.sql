CREATE TABLE IF NOT EXISTS report_fact_extractions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  result_state TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT,
  progress_percent INTEGER CHECK(progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  metrics_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_report_fact_extractions_document
ON report_fact_extractions(workspace_id, document_version_id, result_state);

CREATE TABLE IF NOT EXISTS assignment_plan_metrics (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  unit TEXT,
  target_numeric REAL,
  target_text TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  source_kind TEXT NOT NULL DEFAULT 'extracted',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(assignment_id, metric_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignment_plan_metrics
ON assignment_plan_metrics(assignment_id, metric_key);

CREATE TABLE IF NOT EXISTS assignment_outcomes (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  assignment_evidence_id TEXT NOT NULL REFERENCES assignment_evidence(id) ON DELETE CASCADE,
  result_state TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT,
  progress_percent INTEGER CHECK(progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(assignment_evidence_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignment_outcomes
ON assignment_outcomes(assignment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assignment_metric_observations (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  assignment_evidence_id TEXT NOT NULL REFERENCES assignment_evidence(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  unit TEXT,
  actual_numeric REAL,
  actual_text TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(assignment_evidence_id, metric_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignment_metric_observations
ON assignment_metric_observations(assignment_id, metric_key, created_at DESC);

CREATE TABLE IF NOT EXISTS person_notification_states (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY(workspace_id, person_id, notification_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_person_notification_states
ON person_notification_states(workspace_id, person_id, dismissed_at, read_at);
