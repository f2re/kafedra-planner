CREATE TABLE organization_units (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES organization_units(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK(length(trim(code)) > 0),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  unit_kind TEXT NOT NULL DEFAULT 'department'
    CHECK(unit_kind IN ('organization', 'faculty', 'department', 'laboratory', 'section', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, code),
  CHECK(parent_id IS NULL OR parent_id <> id)
) STRICT;
CREATE INDEX idx_organization_units_tree
ON organization_units(workspace_id, parent_id, status, sort_order, name);

CREATE TABLE organization_positions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK(length(trim(code)) > 0),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK(category IN ('leadership', 'teaching', 'research', 'engineering', 'administrative', 'support', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, code)
) STRICT;
CREATE INDEX idx_organization_positions_lookup
ON organization_positions(workspace_id, status, category, name);

CREATE TABLE person_appointments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  organization_unit_id TEXT NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  position_id TEXT REFERENCES organization_positions(id) ON DELETE RESTRICT,
  position_title_snapshot TEXT,
  appointment_kind TEXT NOT NULL DEFAULT 'primary'
    CHECK(appointment_kind IN ('primary', 'additional', 'temporary')),
  workload_fraction REAL NOT NULL DEFAULT 1.0
    CHECK(workload_fraction > 0 AND workload_fraction <= 1.5),
  valid_from TEXT NOT NULL
    CHECK(valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT
    CHECK(valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended', 'cancelled')),
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(valid_to IS NULL OR valid_to >= valid_from),
  CHECK(position_id IS NOT NULL OR length(trim(COALESCE(position_title_snapshot, ''))) > 0)
) STRICT;
CREATE INDEX idx_person_appointments_person_period
ON person_appointments(workspace_id, person_id, valid_from, valid_to, status);
CREATE INDEX idx_person_appointments_unit_period
ON person_appointments(workspace_id, organization_unit_id, valid_from, valid_to, status);
CREATE INDEX idx_person_appointments_position
ON person_appointments(workspace_id, position_id, status);

CREATE TABLE organization_unit_managers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_unit_id TEXT NOT NULL REFERENCES organization_units(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES person_appointments(id) ON DELETE SET NULL,
  valid_from TEXT NOT NULL
    CHECK(valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT
    CHECK(valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended', 'cancelled')),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(valid_to IS NULL OR valid_to >= valid_from)
) STRICT;
CREATE INDEX idx_organization_unit_managers_period
ON organization_unit_managers(workspace_id, organization_unit_id, valid_from, valid_to, status);
CREATE INDEX idx_organization_unit_managers_person
ON organization_unit_managers(workspace_id, person_id, valid_from, valid_to, status);

-- Старые поля people.position/manager_id сохраняются. Для подтверждённых текстовых
-- должностей создаётся нейтральное историческое назначение без выдумывания новой структуры.
INSERT INTO organization_units(
  id, workspace_id, parent_id, code, name, unit_kind, status, sort_order,
  created_by_person_id, created_at, updated_at
)
SELECT
  'unit_legacy_' || w.id,
  w.id,
  NULL,
  'legacy-root',
  COALESCE(NULLIF(trim(w.name), ''), 'Организация'),
  'organization',
  'active',
  0,
  NULL,
  COALESCE(w.created_at, CURRENT_TIMESTAMP),
  COALESCE(w.created_at, CURRENT_TIMESTAMP)
FROM workspaces w
WHERE EXISTS (
  SELECT 1 FROM people p
  WHERE p.workspace_id = w.id AND length(trim(COALESCE(p.position, ''))) > 0
);

INSERT INTO person_appointments(
  id, workspace_id, person_id, organization_unit_id, position_id,
  position_title_snapshot, appointment_kind, workload_fraction,
  valid_from, valid_to, status, source_document_version_id, evidence_json,
  created_by_person_id, created_at, updated_at
)
SELECT
  'appt_legacy_' || p.id,
  p.workspace_id,
  p.id,
  'unit_legacy_' || p.workspace_id,
  NULL,
  trim(p.position),
  'primary',
  1.0,
  substr(COALESCE(p.created_at, CURRENT_TIMESTAMP), 1, 10),
  NULL,
  CASE WHEN p.status = 'inactive' THEN 'ended' ELSE 'active' END,
  NULL,
  json_object(
    'source', 'legacy_people',
    'position', p.position,
    'managerPersonId', p.manager_id,
    'migratedAt', CURRENT_TIMESTAMP
  ),
  NULL,
  COALESCE(p.created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM people p
WHERE length(trim(COALESCE(p.position, ''))) > 0;
