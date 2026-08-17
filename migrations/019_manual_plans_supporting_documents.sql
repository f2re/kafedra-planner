CREATE TABLE plans_v19 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  origin_kind TEXT NOT NULL DEFAULT 'document' CHECK(origin_kind IN ('document', 'manual')),
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
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((origin_kind = 'document' AND source_document_version_id IS NOT NULL) OR origin_kind = 'manual'),
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;

INSERT INTO plans_v19(
  id, workspace_id, source_document_version_id, origin_kind, plan_kind, period_kind,
  period_key, year_start, year_end, owner_person_id, owner_raw, title, status,
  confidence, evidence_json, created_by_person_id, created_at, updated_at
)
SELECT
  id, workspace_id, source_document_version_id, 'document', plan_kind, period_kind,
  period_key, year_start, year_end, owner_person_id, owner_raw, title, status,
  confidence, evidence_json, NULL, created_at, updated_at
FROM plans;

CREATE TABLE plan_items_v19 (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans_v19(id) ON DELETE CASCADE,
  source_item_key TEXT NOT NULL,
  origin_kind TEXT NOT NULL DEFAULT 'extracted' CHECK(origin_kind IN ('extracted', 'manual')),
  execution_mode TEXT NOT NULL DEFAULT 'track' CHECK(execution_mode IN ('track', 'assigned', 'open')),
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
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, source_item_key)
) STRICT;

INSERT INTO plan_items_v19(
  id, plan_id, source_item_key, origin_kind, execution_mode, item_no, title, description,
  starts_at, ends_at, due_date, responsible_raw, responsible_person_id, direction,
  expected_result, status, confidence, evidence_json, created_by_person_id, created_at, updated_at
)
SELECT
  id, plan_id, source_item_key, 'extracted', 'track', item_no, title, description,
  starts_at, ends_at, due_date, responsible_raw, responsible_person_id, direction,
  expected_result, status, confidence, evidence_json, NULL, created_at, updated_at
FROM plan_items;

DROP TABLE plan_items;
DROP TABLE plans;
ALTER TABLE plans_v19 RENAME TO plans;
ALTER TABLE plan_items_v19 RENAME TO plan_items;

CREATE INDEX idx_plans_period ON plans(workspace_id, plan_kind, period_kind, period_key, status);
CREATE INDEX idx_plans_owner ON plans(workspace_id, owner_person_id, period_key);
CREATE INDEX idx_plans_origin ON plans(workspace_id, origin_kind, updated_at DESC);
CREATE INDEX idx_plan_items_dates ON plan_items(plan_id, starts_at, due_date, status);
CREATE INDEX idx_plan_items_responsible ON plan_items(responsible_person_id, due_date, status);
CREATE INDEX idx_plan_items_direction ON plan_items(plan_id, direction, status);
CREATE INDEX idx_plan_items_execution ON plan_items(plan_id, execution_mode, status);

CREATE TABLE plan_item_assignments (
  plan_item_id TEXT PRIMARY KEY REFERENCES plan_items(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('assigned', 'open')),
  claimed_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_plan_item_assignments_assignment ON plan_item_assignments(assignment_id);
CREATE INDEX idx_plan_item_assignments_claim ON plan_item_assignments(claimed_by_person_id, execution_mode);

CREATE TABLE supporting_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_number TEXT NOT NULL CHECK(length(trim(document_number)) > 0),
  document_date TEXT NOT NULL CHECK(document_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  title TEXT,
  note TEXT,
  document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  deleted_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE INDEX idx_supporting_documents_lookup
ON supporting_documents(workspace_id, status, document_date DESC, document_number);
CREATE INDEX idx_supporting_documents_file ON supporting_documents(document_version_id);

CREATE TABLE supporting_document_links (
  id TEXT PRIMARY KEY,
  supporting_document_id TEXT NOT NULL REFERENCES supporting_documents(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('document', 'plan_item', 'assignment', 'scientific_item', 'meeting')),
  target_id TEXT NOT NULL,
  relation_kind TEXT NOT NULL DEFAULT 'evidence' CHECK(relation_kind IN ('evidence', 'basis', 'publication', 'completion', 'reference')),
  note TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(supporting_document_id, target_kind, target_id, relation_kind)
) STRICT;
CREATE INDEX idx_supporting_document_links_target
ON supporting_document_links(workspace_id, target_kind, target_id, created_at DESC);
CREATE INDEX idx_supporting_document_links_document
ON supporting_document_links(supporting_document_id, created_at DESC);
