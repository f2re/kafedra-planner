CREATE TABLE monthly_plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  month_key TEXT NOT NULL CHECK(month_key GLOB '20[0-9][0-9]-[0-9][0-9]' AND substr(month_key, 6, 2) BETWEEN '01' AND '12'),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  template_id TEXT REFERENCES plan_document_templates(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX idx_monthly_plans_period ON monthly_plans(workspace_id, month_key, updated_at DESC);
CREATE INDEX idx_monthly_plans_owner ON monthly_plans(workspace_id, created_by_person_id, updated_at DESC);

CREATE TABLE monthly_plan_items (
  id TEXT PRIMARY KEY,
  monthly_plan_id TEXT NOT NULL REFERENCES monthly_plans(id) ON DELETE RESTRICT,
  plan_item_id TEXT NOT NULL REFERENCES plan_items(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position >= 0),
  title_override TEXT CHECK(title_override IS NULL OR length(trim(title_override)) > 0),
  date_text_override TEXT,
  responsible_override TEXT,
  expected_result_override TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(monthly_plan_id, plan_item_id)
) STRICT;
CREATE INDEX idx_monthly_plan_items_order ON monthly_plan_items(monthly_plan_id, position, id);
CREATE INDEX idx_monthly_plan_items_source ON monthly_plan_items(plan_item_id);

CREATE TRIGGER trg_monthly_plan_item_workspace_insert
BEFORE INSERT ON monthly_plan_items
WHEN NOT EXISTS (
  SELECT 1 FROM monthly_plans mp
  JOIN plan_items pi ON pi.id = NEW.plan_item_id
  JOIN plans p ON p.id = pi.plan_id AND p.workspace_id = mp.workspace_id
  WHERE mp.id = NEW.monthly_plan_id
)
BEGIN
  SELECT RAISE(ABORT, 'monthly_plan_source_workspace_mismatch');
END;

CREATE TRIGGER trg_monthly_plan_item_workspace_update
BEFORE UPDATE OF monthly_plan_id, plan_item_id ON monthly_plan_items
WHEN NOT EXISTS (
  SELECT 1 FROM monthly_plans mp
  JOIN plan_items pi ON pi.id = NEW.plan_item_id
  JOIN plans p ON p.id = pi.plan_id AND p.workspace_id = mp.workspace_id
  WHERE mp.id = NEW.monthly_plan_id
)
BEGIN
  SELECT RAISE(ABORT, 'monthly_plan_source_workspace_mismatch');
END;

CREATE TABLE monthly_plan_exports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  monthly_plan_id TEXT NOT NULL REFERENCES monthly_plans(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  template_id TEXT REFERENCES plan_document_templates(id) ON DELETE RESTRICT,
  template_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  generated_document_id TEXT REFERENCES documents(id) ON DELETE RESTRICT,
  generated_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  output_sha256 TEXT REFERENCES file_blobs(sha256) ON DELETE RESTRICT,
  error_message TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK((template_id IS NULL AND template_document_version_id IS NULL)
    OR (template_id IS NOT NULL AND template_document_version_id IS NOT NULL)),
  CHECK(status <> 'completed' OR (generated_document_id IS NOT NULL
    AND generated_document_version_id IS NOT NULL AND output_sha256 IS NOT NULL AND completed_at IS NOT NULL)),
  UNIQUE(workspace_id, idempotency_key)
) STRICT;
CREATE INDEX idx_monthly_plan_exports_plan ON monthly_plan_exports(monthly_plan_id, started_at DESC);

CREATE TRIGGER trg_monthly_plan_export_snapshot_immutable
BEFORE UPDATE ON monthly_plan_exports
WHEN NEW.id IS NOT OLD.id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.monthly_plan_id IS NOT OLD.monthly_plan_id
  OR NEW.revision IS NOT OLD.revision
  OR NEW.template_id IS NOT OLD.template_id
  OR NEW.template_document_version_id IS NOT OLD.template_document_version_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.snapshot_json IS NOT OLD.snapshot_json
  OR NEW.created_by_person_id IS NOT OLD.created_by_person_id
  OR NEW.started_at IS NOT OLD.started_at
  OR (OLD.status = 'completed' AND (
    NEW.status IS NOT OLD.status
    OR NEW.generated_document_id IS NOT OLD.generated_document_id
    OR NEW.generated_document_version_id IS NOT OLD.generated_document_version_id
    OR NEW.output_sha256 IS NOT OLD.output_sha256
    OR NEW.completed_at IS NOT OLD.completed_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'monthly_plan_export_snapshot_immutable');
END;

CREATE TRIGGER trg_monthly_plan_export_workspace_insert
BEFORE INSERT ON monthly_plan_exports
WHEN NOT EXISTS (SELECT 1 FROM monthly_plans p WHERE p.id = NEW.monthly_plan_id AND p.workspace_id = NEW.workspace_id)
  OR (NEW.template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plan_document_templates t WHERE t.id = NEW.template_id
      AND t.workspace_id = NEW.workspace_id AND t.source_document_version_id = NEW.template_document_version_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'monthly_plan_export_workspace_mismatch');
END;

CREATE TRIGGER trg_monthly_plan_export_document_insert
BEFORE INSERT ON monthly_plan_exports
WHEN (NEW.generated_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents d WHERE d.id = NEW.generated_document_id AND d.workspace_id = NEW.workspace_id
  ))
  OR (NEW.generated_document_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document_versions v WHERE v.id = NEW.generated_document_version_id AND v.document_id = NEW.generated_document_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'monthly_plan_export_document_mismatch');
END;

CREATE TRIGGER trg_monthly_plan_export_document_update
BEFORE UPDATE OF generated_document_id, generated_document_version_id ON monthly_plan_exports
WHEN (NEW.generated_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents d WHERE d.id = NEW.generated_document_id AND d.workspace_id = NEW.workspace_id
  ))
  OR (NEW.generated_document_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document_versions v WHERE v.id = NEW.generated_document_version_id AND v.document_id = NEW.generated_document_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'monthly_plan_export_document_mismatch');
END;
