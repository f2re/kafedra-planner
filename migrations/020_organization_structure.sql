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

CREATE TABLE scientific_author_affiliations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scientific_item_id TEXT NOT NULL,
  author_raw TEXT NOT NULL,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES person_appointments(id) ON DELETE SET NULL,
  organization_unit_id TEXT REFERENCES organization_units(id) ON DELETE SET NULL,
  position_id TEXT REFERENCES organization_positions(id) ON DELETE SET NULL,
  unit_name_snapshot TEXT,
  position_name_snapshot TEXT,
  valid_on TEXT NOT NULL
    CHECK(valid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_kind TEXT NOT NULL DEFAULT 'derived' CHECK(source_kind IN ('derived', 'manual')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(scientific_item_id, author_raw)
    REFERENCES scientific_item_authors(scientific_item_id, author_raw) ON DELETE CASCADE,
  UNIQUE(scientific_item_id, author_raw)
) STRICT;
CREATE INDEX idx_scientific_author_affiliations_person
ON scientific_author_affiliations(workspace_id, person_id, valid_on, scientific_item_id);
CREATE INDEX idx_scientific_author_affiliations_unit
ON scientific_author_affiliations(workspace_id, organization_unit_id, valid_on, scientific_item_id);

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

-- Для уже известных авторов фиксируется подразделение на дату публикации. Если в старой
-- установке структура ещё не была описана, остаётся только персональная связь без выдуманного факта.
WITH author_dates AS (
  SELECT sia.scientific_item_id, sia.author_raw, sia.person_id, si.workspace_id,
    COALESCE(
      substr(si.published_at, 1, 10),
      CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31', si.publication_year) END,
      substr(si.created_at, 1, 10),
      date('now')
    ) AS valid_on
  FROM scientific_item_authors sia
  JOIN scientific_items si ON si.id = sia.scientific_item_id
  WHERE sia.person_id IS NOT NULL
), resolved AS (
  SELECT ad.*,
    (SELECT pa.id FROM person_appointments pa
      WHERE pa.workspace_id = ad.workspace_id AND pa.person_id = ad.person_id
        AND pa.status <> 'cancelled'
        AND pa.valid_from <= ad.valid_on
        AND (pa.valid_to IS NULL OR pa.valid_to >= ad.valid_on)
      ORDER BY pa.appointment_kind = 'primary' DESC, pa.valid_from DESC LIMIT 1) AS appointment_id
  FROM author_dates ad
)
INSERT INTO scientific_author_affiliations(
  id, workspace_id, scientific_item_id, author_raw, person_id, appointment_id,
  organization_unit_id, position_id, unit_name_snapshot, position_name_snapshot,
  valid_on, source_kind, evidence_json, created_at, updated_at
)
SELECT
  'scienceaff_' || lower(hex(randomblob(16))), r.workspace_id, r.scientific_item_id,
  r.author_raw, r.person_id, pa.id, pa.organization_unit_id, pa.position_id,
  ou.name, COALESCE(op.name, pa.position_title_snapshot), r.valid_on, 'derived',
  json_object('source', 'organization_migration', 'appointmentId', pa.id),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM resolved r
LEFT JOIN person_appointments pa ON pa.id = r.appointment_id
LEFT JOIN organization_units ou ON ou.id = pa.organization_unit_id
LEFT JOIN organization_positions op ON op.id = pa.position_id;

-- Новые научные карточки автоматически получают только выводимый снимок. Ручная коррекция
-- хранится отдельно и не перезаписывается этим триггером.
CREATE TRIGGER scientific_author_affiliation_after_insert
AFTER INSERT ON scientific_item_authors
WHEN NEW.person_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO scientific_author_affiliations(
    id, workspace_id, scientific_item_id, author_raw, person_id, appointment_id,
    organization_unit_id, position_id, unit_name_snapshot, position_name_snapshot,
    valid_on, source_kind, evidence_json, created_at, updated_at
  )
  SELECT
    'scienceaff_' || lower(hex(randomblob(16))), si.workspace_id, NEW.scientific_item_id,
    NEW.author_raw, NEW.person_id, pa.id, pa.organization_unit_id, pa.position_id,
    ou.name, COALESCE(op.name, pa.position_title_snapshot),
    COALESCE(
      substr(si.published_at, 1, 10),
      CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31', si.publication_year) END,
      substr(si.created_at, 1, 10), date('now')
    ),
    'derived', json_object('source', 'organization_trigger', 'appointmentId', pa.id),
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM scientific_items si
  LEFT JOIN person_appointments pa ON pa.id = (
    SELECT candidate.id FROM person_appointments candidate
    WHERE candidate.workspace_id = si.workspace_id AND candidate.person_id = NEW.person_id
      AND candidate.status <> 'cancelled'
      AND candidate.valid_from <= COALESCE(
        substr(si.published_at, 1, 10),
        CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31', si.publication_year) END,
        substr(si.created_at, 1, 10), date('now')
      )
      AND (candidate.valid_to IS NULL OR candidate.valid_to >= COALESCE(
        substr(si.published_at, 1, 10),
        CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31', si.publication_year) END,
        substr(si.created_at, 1, 10), date('now')
      ))
    ORDER BY candidate.appointment_kind = 'primary' DESC, candidate.valid_from DESC LIMIT 1
  )
  LEFT JOIN organization_units ou ON ou.id = pa.organization_unit_id
  LEFT JOIN organization_positions op ON op.id = pa.position_id
  WHERE si.id = NEW.scientific_item_id;
END;
