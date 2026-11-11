CREATE TABLE plan_event_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  current_version_id TEXT REFERENCES plan_event_template_versions(id) ON DELETE RESTRICT,
  current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version >= 0),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, idempotency_key)
) STRICT;

CREATE TABLE plan_event_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES plan_event_templates(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(template_id, version_no),
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX idx_plan_event_templates_owner ON plan_event_templates(workspace_id, created_by_person_id, updated_at DESC);

CREATE TRIGGER trg_plan_event_template_version_workspace
BEFORE INSERT ON plan_event_template_versions
WHEN NOT EXISTS (SELECT 1 FROM plan_event_templates t WHERE t.id = NEW.template_id AND t.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'event_template_workspace_mismatch'); END;

CREATE TRIGGER trg_plan_event_template_current_version
BEFORE UPDATE OF current_version_id, current_version ON plan_event_templates
WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_event_template_versions v WHERE v.id = NEW.current_version_id
    AND v.template_id = NEW.id AND v.workspace_id = NEW.workspace_id AND v.version_no = NEW.current_version
)
BEGIN SELECT RAISE(ABORT, 'event_template_version_mismatch'); END;

CREATE TRIGGER trg_plan_event_template_version_immutable_update
BEFORE UPDATE ON plan_event_template_versions
BEGIN SELECT RAISE(ABORT, 'event_template_version_immutable'); END;
CREATE TRIGGER trg_plan_event_template_version_immutable_delete
BEFORE DELETE ON plan_event_template_versions
BEGIN SELECT RAISE(ABORT, 'event_template_version_immutable'); END;

CREATE TABLE plan_item_details (
  plan_item_id TEXT PRIMARY KEY REFERENCES plan_items(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  location TEXT NOT NULL DEFAULT '',
  custom_values_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_values_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER trg_plan_item_details_workspace_insert
BEFORE INSERT ON plan_item_details
WHEN NOT EXISTS (SELECT 1 FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
  WHERE pi.id = NEW.plan_item_id AND p.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'event_details_workspace_mismatch'); END;
CREATE TRIGGER trg_plan_item_details_identity_update
BEFORE UPDATE OF plan_item_id, workspace_id ON plan_item_details
WHEN NEW.plan_item_id IS NOT OLD.plan_item_id OR NEW.workspace_id IS NOT OLD.workspace_id
BEGIN SELECT RAISE(ABORT, 'event_details_identity_immutable'); END;

CREATE TABLE plan_event_selection_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  event_template_version_id TEXT REFERENCES plan_event_template_versions(id) ON DELETE RESTRICT,
  department_text TEXT NOT NULL,
  month_key TEXT NOT NULL,
  method TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL CHECK(json_valid(source_snapshot_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX idx_plan_event_selection_owner ON plan_event_selection_runs(workspace_id, created_by_person_id, created_at DESC);
CREATE TRIGGER trg_plan_event_selection_template_workspace
BEFORE INSERT ON plan_event_selection_runs
WHEN NEW.event_template_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_event_template_versions v WHERE v.id = NEW.event_template_version_id AND v.workspace_id = NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'event_selection_workspace_mismatch'); END;
CREATE TRIGGER trg_plan_event_selection_immutable_update
BEFORE UPDATE ON plan_event_selection_runs
BEGIN SELECT RAISE(ABORT, 'event_selection_immutable'); END;
CREATE TRIGGER trg_plan_event_selection_immutable_delete
BEFORE DELETE ON plan_event_selection_runs
BEGIN SELECT RAISE(ABORT, 'event_selection_immutable'); END;

ALTER TABLE monthly_plans ADD COLUMN event_template_version_id TEXT REFERENCES plan_event_template_versions(id) ON DELETE RESTRICT;
ALTER TABLE monthly_plans ADD COLUMN department_text TEXT NOT NULL DEFAULT '';
ALTER TABLE monthly_plan_items ADD COLUMN location_override TEXT;
ALTER TABLE monthly_plan_items ADD COLUMN custom_values_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_values_json));
ALTER TABLE monthly_plan_items ADD COLUMN selection_run_id TEXT REFERENCES plan_event_selection_runs(id) ON DELETE RESTRICT;
ALTER TABLE monthly_plan_items ADD COLUMN selection_evidence_json TEXT CHECK(selection_evidence_json IS NULL OR json_valid(selection_evidence_json));

CREATE TRIGGER trg_monthly_event_template_workspace_insert
BEFORE INSERT ON monthly_plans
WHEN NEW.event_template_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_event_template_versions v WHERE v.id = NEW.event_template_version_id AND v.workspace_id = NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'monthly_event_template_workspace_mismatch'); END;
CREATE TRIGGER trg_monthly_event_template_workspace_update
BEFORE UPDATE OF event_template_version_id, workspace_id ON monthly_plans
WHEN NEW.event_template_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_event_template_versions v WHERE v.id = NEW.event_template_version_id AND v.workspace_id = NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'monthly_event_template_workspace_mismatch'); END;

CREATE TRIGGER trg_monthly_event_selection_workspace_insert
BEFORE INSERT ON monthly_plan_items
WHEN NEW.selection_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_event_selection_runs r JOIN monthly_plans m ON m.workspace_id = r.workspace_id
  WHERE r.id = NEW.selection_run_id AND m.id = NEW.monthly_plan_id
)
BEGIN SELECT RAISE(ABORT, 'monthly_event_selection_workspace_mismatch'); END;
CREATE TRIGGER trg_monthly_event_selection_workspace_update
BEFORE UPDATE OF selection_run_id ON monthly_plan_items
WHEN NEW.selection_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM plan_event_selection_runs r JOIN monthly_plans m ON m.workspace_id = r.workspace_id
  WHERE r.id = NEW.selection_run_id AND m.id = NEW.monthly_plan_id
)
BEGIN SELECT RAISE(ABORT, 'monthly_event_selection_workspace_mismatch'); END;
CREATE TRIGGER trg_monthly_event_selection_evidence_immutable
BEFORE UPDATE OF selection_run_id, selection_evidence_json ON monthly_plan_items
WHEN OLD.selection_run_id IS NOT NULL AND (
  NEW.selection_run_id IS NOT OLD.selection_run_id OR NEW.selection_evidence_json IS NOT OLD.selection_evidence_json
)
BEGIN SELECT RAISE(ABORT, 'monthly_event_selection_evidence_immutable'); END;
