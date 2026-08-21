ALTER TABLE scientific_items ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'published'
  CHECK(lifecycle_status IN ('idea','drafting','submitted','revision','accepted','published','rejected','archived'));
ALTER TABLE scientific_items ADD COLUMN target_venue TEXT;
ALTER TABLE scientific_items ADD COLUMN next_action TEXT;
ALTER TABLE scientific_items ADD COLUMN next_action_due TEXT
  CHECK(next_action_due IS NULL OR next_action_due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE scientific_items ADD COLUMN submitted_at TEXT
  CHECK(submitted_at IS NULL OR submitted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE scientific_items ADD COLUMN accepted_at TEXT
  CHECK(accepted_at IS NULL OR accepted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE scientific_items ADD COLUMN rejected_at TEXT
  CHECK(rejected_at IS NULL OR rejected_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

UPDATE scientific_items
SET lifecycle_status = CASE
  WHEN status = 'deleted' THEN 'archived'
  WHEN published_at IS NOT NULL OR publication_year IS NOT NULL OR doi IS NOT NULL THEN 'published'
  ELSE 'idea'
END;

CREATE INDEX idx_scientific_items_lifecycle
ON scientific_items(workspace_id, lifecycle_status, next_action_due, publication_year);

CREATE TABLE scientific_item_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scientific_item_id TEXT NOT NULL REFERENCES scientific_items(id) ON DELETE CASCADE,
  previous_json TEXT NOT NULL,
  next_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_scientific_item_revisions_item
ON scientific_item_revisions(workspace_id, scientific_item_id, created_at DESC);

CREATE TABLE scientific_lifecycle_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scientific_item_id TEXT NOT NULL REFERENCES scientific_items(id) ON DELETE CASCADE,
  from_status TEXT CHECK(from_status IS NULL OR from_status IN ('idea','drafting','submitted','revision','accepted','published','rejected','archived')),
  to_status TEXT NOT NULL CHECK(to_status IN ('idea','drafting','submitted','revision','accepted','published','rejected','archived')),
  event_date TEXT NOT NULL CHECK(event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note TEXT,
  evidence_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_scientific_lifecycle_events_item
ON scientific_lifecycle_events(workspace_id, scientific_item_id, event_date DESC, created_at DESC);

CREATE TABLE scientific_item_plan_links (
  scientific_item_id TEXT PRIMARY KEY REFERENCES scientific_items(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_item_id TEXT NOT NULL UNIQUE REFERENCES plan_items(id) ON DELETE RESTRICT,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_scientific_plan_links_plan_item
ON scientific_item_plan_links(workspace_id, plan_item_id);
CREATE INDEX idx_scientific_plan_links_assignment
ON scientific_item_plan_links(workspace_id, assignment_id);
