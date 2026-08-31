CREATE TABLE IF NOT EXISTS academic_groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  normalized_code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, normalized_code)
) STRICT;

CREATE TABLE IF NOT EXISTS academic_periods (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  semester INTEGER NOT NULL CHECK(semester IN (1, 2)),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, academic_year, semester)
) STRICT;

CREATE TABLE IF NOT EXISTS academic_students (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_academic_students_name
ON academic_students(workspace_id, normalized_name);

CREATE TABLE IF NOT EXISTS academic_group_memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES academic_groups(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES academic_periods(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES academic_students(id) ON DELETE RESTRICT,
  source_student_key TEXT NOT NULL,
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  source_locator_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(group_id, period_id, source_student_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_academic_memberships_period
ON academic_group_memberships(workspace_id, period_id, group_id);

CREATE TABLE IF NOT EXISTS academic_disciplines (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, normalized_name)
) STRICT;

CREATE TABLE IF NOT EXISTS academic_grade_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  source_name TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES academic_groups(id) ON DELETE RESTRICT,
  period_id TEXT NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK(processing_status IN (
    'running', 'completed', 'completed_with_review', 'failed'
  )),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN (
    'active', 'archived', 'superseded'
  )),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0, 1)),
  superseded_by_import_id TEXT REFERENCES academic_grade_imports(id) ON DELETE SET NULL,
  profile_json TEXT NOT NULL,
  total_students INTEGER NOT NULL DEFAULT 0 CHECK(total_students >= 0),
  discipline_count INTEGER NOT NULL DEFAULT 0 CHECK(discipline_count >= 0),
  accepted_cells INTEGER NOT NULL DEFAULT 0 CHECK(accepted_cells >= 0),
  review_cells INTEGER NOT NULL DEFAULT 0 CHECK(review_cells >= 0),
  empty_cells INTEGER NOT NULL DEFAULT 0 CHECK(empty_cells >= 0),
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK(issue_count >= 0),
  error_message TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  archived_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  archive_reason TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(workspace_id, idempotency_key),
  UNIQUE(workspace_id, source_document_version_id, group_id, period_id, profile_hash)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_academic_grade_imports_period
ON academic_grade_imports(workspace_id, period_id, group_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_grade_imports_current
ON academic_grade_imports(workspace_id, group_id, period_id)
WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS academic_grade_import_metadata (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES academic_grade_imports(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL CHECK(field_key IN ('groupCode', 'academicYear', 'semester')),
  normalized_value TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('manual', 'cell')),
  source_locator_json TEXT NOT NULL,
  normalization_rule TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(import_id, field_key)
) STRICT;

CREATE TABLE IF NOT EXISTS academic_grade_import_disciplines (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES academic_grade_imports(id) ON DELETE CASCADE,
  discipline_id TEXT NOT NULL REFERENCES academic_disciplines(id) ON DELETE RESTRICT,
  source_column INTEGER NOT NULL CHECK(source_column > 0),
  source_name TEXT NOT NULL,
  source_header_cell TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(import_id, source_column),
  UNIQUE(import_id, discipline_id)
) STRICT;

CREATE TABLE IF NOT EXISTS academic_grade_import_students (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES academic_grade_imports(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES academic_group_memberships(id) ON DELETE RESTRICT,
  sheet_name TEXT NOT NULL,
  row_no INTEGER NOT NULL CHECK(row_no > 0),
  student_cell_address TEXT NOT NULL,
  source_locator_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(import_id, membership_id),
  UNIQUE(import_id, sheet_name, row_no)
) STRICT;

CREATE TABLE IF NOT EXISTS academic_grade_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES academic_grade_imports(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES academic_group_memberships(id) ON DELETE RESTRICT,
  discipline_id TEXT NOT NULL REFERENCES academic_disciplines(id) ON DELETE RESTRICT,
  raw_value TEXT NOT NULL,
  grade_category TEXT NOT NULL CHECK(grade_category IN (
    'excellent', 'good', 'satisfactory', 'unsatisfactory', 'not_attested', 'unknown'
  )),
  numeric_value INTEGER CHECK(numeric_value IS NULL OR numeric_value BETWEEN 2 AND 5),
  normalization_rule TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'needs_review')),
  review_message TEXT,
  sheet_name TEXT NOT NULL,
  cell_address TEXT NOT NULL,
  row_no INTEGER NOT NULL CHECK(row_no > 0),
  column_no INTEGER NOT NULL CHECK(column_no > 0),
  source_locator_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(import_id, sheet_name, row_no, column_no),
  UNIQUE(import_id, membership_id, discipline_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_academic_grade_records_summary
ON academic_grade_records(import_id, discipline_id, grade_category);

CREATE TABLE IF NOT EXISTS academic_grade_import_issues (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES academic_grade_imports(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  sheet_name TEXT,
  cell_address TEXT,
  row_no INTEGER,
  column_no INTEGER,
  raw_value TEXT,
  source_locator_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_academic_grade_import_issues_run
ON academic_grade_import_issues(import_id, row_no, column_no);
