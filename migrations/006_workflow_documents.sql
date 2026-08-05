CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  email TEXT,
  position TEXT,
  manager_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, normalized_name)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_people_workspace_name
ON people(workspace_id, normalized_name, status);

CREATE TABLE IF NOT EXISTS directives (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  directive_kind TEXT NOT NULL,
  document_number TEXT,
  issued_at TEXT,
  issuer_raw TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  direction TEXT NOT NULL DEFAULT 'organizational',
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_directives_lookup
ON directives(workspace_id, issued_at, directive_kind, direction, status);
CREATE INDEX IF NOT EXISTS idx_directives_number
ON directives(workspace_id, document_number);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  directive_id TEXT REFERENCES directives(id) ON DELETE SET NULL,
  source_item_no TEXT,
  title TEXT NOT NULL,
  instruction_text TEXT NOT NULL,
  starts_at TEXT,
  due_date TEXT,
  direction TEXT NOT NULL DEFAULT 'organizational',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  expected_result TEXT,
  report_required INTEGER NOT NULL DEFAULT 1 CHECK(report_required IN (0, 1)),
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignments_due
ON assignments(workspace_id, status, due_date, direction);
CREATE INDEX IF NOT EXISTS idx_assignments_directive
ON assignments(directive_id, source_item_no);

CREATE TABLE IF NOT EXISTS assignment_executors (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  executor_raw TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'executor',
  created_at TEXT NOT NULL,
  PRIMARY KEY(assignment_id, executor_raw, role)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignment_executors_person
ON assignment_executors(person_id, role, assignment_id);

CREATE TABLE IF NOT EXISTS assignment_updates (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  actor_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  progress_percent INTEGER CHECK(progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  note TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignment_updates
ON assignment_updates(assignment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assignment_evidence (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  evidence_kind TEXT NOT NULL DEFAULT 'report',
  note TEXT,
  locator_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assignment_evidence
ON assignment_evidence(assignment_id, evidence_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS periodic_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  manager_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  period_kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT,
  due_date TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'organizational',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  expected_result TEXT,
  report_required INTEGER NOT NULL DEFAULT 1 CHECK(report_required IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_periodic_tasks_due
ON periodic_tasks(workspace_id, period_kind, period_key, status, due_date);
CREATE INDEX IF NOT EXISTS idx_periodic_tasks_owner
ON periodic_tasks(owner_person_id, manager_person_id, due_date);

CREATE TABLE IF NOT EXISTS entity_facets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  facet_name TEXT NOT NULL,
  text_value TEXT,
  normalized_value TEXT,
  date_value TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_entity_facets_text
ON entity_facets(workspace_id, facet_name, normalized_value, source_kind);
CREATE INDEX IF NOT EXISTS idx_entity_facets_date
ON entity_facets(workspace_id, facet_name, date_value, source_kind);
CREATE INDEX IF NOT EXISTS idx_entity_facets_source
ON entity_facets(source_kind, source_id);

CREATE TABLE IF NOT EXISTS llm_extraction_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  endpoint TEXT,
  model TEXT,
  prompt_version TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  response_json TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_llm_extraction_runs
ON llm_extraction_runs(workspace_id, document_version_id, created_at DESC);
