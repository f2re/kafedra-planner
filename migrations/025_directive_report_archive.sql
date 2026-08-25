CREATE TABLE IF NOT EXISTS directive_report_materials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  directive_id TEXT NOT NULL REFERENCES directives(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  material_kind TEXT NOT NULL DEFAULT 'report',
  title TEXT NOT NULL,
  material_date TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'attached',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(directive_id, document_version_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_directive_report_materials_directive
ON directive_report_materials(workspace_id, directive_id, material_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_directive_report_materials_assignment
ON directive_report_materials(assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_directive_report_materials_document
ON directive_report_materials(document_version_id);

-- Existing directives become visible in the common calendar immediately after migration.
INSERT OR IGNORE INTO calendar_items(
  id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
  all_day, category, importance, status, description, item_kind,
  reminder_minutes, completed_at, revision, created_at, updated_at
)
SELECT
  'cal_' || lower(hex(randomblob(16))),
  d.workspace_id,
  'directive',
  d.id,
  trim(
    CASE
      WHEN d.directive_kind IN ('Приказ', 'приказ') OR lower(d.directive_kind) LIKE '%order%' THEN 'Приказ'
      WHEN d.directive_kind IN ('Указ', 'указ') OR lower(d.directive_kind) LIKE '%decree%' THEN 'Указ'
      ELSE 'Распоряжение'
    END
    || CASE WHEN d.document_number IS NOT NULL AND trim(d.document_number) <> '' THEN ' № ' || d.document_number ELSE '' END
    || ' · ' || d.title
  ),
  d.issued_at,
  NULL,
  1,
  CASE d.direction WHEN 'science' THEN 'science' WHEN 'education' THEN 'education' ELSE 'organizational' END,
  'normal',
  CASE WHEN d.status = 'cancelled' THEN 'cancelled' ELSE 'open' END,
  COALESCE(d.summary, 'Распорядительный документ'),
  'event',
  NULL,
  NULL,
  1,
  d.created_at,
  d.updated_at
FROM directives d
WHERE d.issued_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM calendar_items ci
    WHERE ci.workspace_id = d.workspace_id
      AND ci.source_kind = 'directive'
      AND ci.source_id = d.id
  );

CREATE TRIGGER IF NOT EXISTS trg_directive_calendar_insert
AFTER INSERT ON directives
WHEN NEW.issued_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO calendar_items(
    id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
    all_day, category, importance, status, description, item_kind,
    reminder_minutes, completed_at, revision, created_at, updated_at
  ) VALUES (
    'cal_' || lower(hex(randomblob(16))),
    NEW.workspace_id,
    'directive',
    NEW.id,
    trim(
      CASE
        WHEN NEW.directive_kind IN ('Приказ', 'приказ') OR lower(NEW.directive_kind) LIKE '%order%' THEN 'Приказ'
        WHEN NEW.directive_kind IN ('Указ', 'указ') OR lower(NEW.directive_kind) LIKE '%decree%' THEN 'Указ'
        ELSE 'Распоряжение'
      END
      || CASE WHEN NEW.document_number IS NOT NULL AND trim(NEW.document_number) <> '' THEN ' № ' || NEW.document_number ELSE '' END
      || ' · ' || NEW.title
    ),
    NEW.issued_at,
    NULL,
    1,
    CASE NEW.direction WHEN 'science' THEN 'science' WHEN 'education' THEN 'education' ELSE 'organizational' END,
    'normal',
    CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'open' END,
    COALESCE(NEW.summary, 'Распорядительный документ'),
    'event',
    NULL,
    NULL,
    1,
    NEW.created_at,
    NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_directive_calendar_update
AFTER UPDATE OF document_number, issued_at, title, summary, direction, status, directive_kind ON directives
BEGIN
  DELETE FROM calendar_items
  WHERE workspace_id = NEW.workspace_id
    AND source_kind = 'directive'
    AND source_id = NEW.id
    AND NEW.issued_at IS NULL;

  INSERT OR IGNORE INTO calendar_items(
    id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
    all_day, category, importance, status, description, item_kind,
    reminder_minutes, completed_at, revision, created_at, updated_at
  )
  SELECT
    'cal_' || lower(hex(randomblob(16))),
    NEW.workspace_id,
    'directive',
    NEW.id,
    trim(
      CASE
        WHEN NEW.directive_kind IN ('Приказ', 'приказ') OR lower(NEW.directive_kind) LIKE '%order%' THEN 'Приказ'
        WHEN NEW.directive_kind IN ('Указ', 'указ') OR lower(NEW.directive_kind) LIKE '%decree%' THEN 'Указ'
        ELSE 'Распоряжение'
      END
      || CASE WHEN NEW.document_number IS NOT NULL AND trim(NEW.document_number) <> '' THEN ' № ' || NEW.document_number ELSE '' END
      || ' · ' || NEW.title
    ),
    NEW.issued_at,
    NULL,
    1,
    CASE NEW.direction WHEN 'science' THEN 'science' WHEN 'education' THEN 'education' ELSE 'organizational' END,
    'normal',
    CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'open' END,
    COALESCE(NEW.summary, 'Распорядительный документ'),
    'event',
    NULL,
    NULL,
    1,
    NEW.created_at,
    NEW.updated_at
  WHERE NEW.issued_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM calendar_items ci
      WHERE ci.workspace_id = NEW.workspace_id
        AND ci.source_kind = 'directive'
        AND ci.source_id = NEW.id
    );

  UPDATE calendar_items
  SET
    title = trim(
      CASE
        WHEN NEW.directive_kind IN ('Приказ', 'приказ') OR lower(NEW.directive_kind) LIKE '%order%' THEN 'Приказ'
        WHEN NEW.directive_kind IN ('Указ', 'указ') OR lower(NEW.directive_kind) LIKE '%decree%' THEN 'Указ'
        ELSE 'Распоряжение'
      END
      || CASE WHEN NEW.document_number IS NOT NULL AND trim(NEW.document_number) <> '' THEN ' № ' || NEW.document_number ELSE '' END
      || ' · ' || NEW.title
    ),
    starts_at = NEW.issued_at,
    category = CASE NEW.direction WHEN 'science' THEN 'science' WHEN 'education' THEN 'education' ELSE 'organizational' END,
    status = CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'open' END,
    description = COALESCE(NEW.summary, 'Распорядительный документ'),
    revision = revision + 1,
    updated_at = NEW.updated_at
  WHERE workspace_id = NEW.workspace_id
    AND source_kind = 'directive'
    AND source_id = NEW.id
    AND NEW.issued_at IS NOT NULL;
END;

CREATE TRIGGER IF NOT EXISTS trg_directive_calendar_delete
AFTER DELETE ON directives
BEGIN
  DELETE FROM calendar_items
  WHERE workspace_id = OLD.workspace_id
    AND source_kind = 'directive'
    AND source_id = OLD.id;
END;
