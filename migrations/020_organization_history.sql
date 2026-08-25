CREATE TABLE organizational_units (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_unit_id TEXT REFERENCES organizational_units(id) ON DELETE RESTRICT,
  unit_kind TEXT NOT NULL DEFAULT 'department'
    CHECK(unit_kind IN ('organization','faculty','department','laboratory','section','other')),
  code TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  short_name TEXT,
  valid_from TEXT NOT NULL CHECK(valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT CHECK(valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(valid_to IS NULL OR valid_to >= valid_from),
  CHECK(parent_unit_id IS NULL OR parent_unit_id <> id)
) STRICT;
CREATE UNIQUE INDEX idx_organizational_units_code
ON organizational_units(workspace_id, code) WHERE code IS NOT NULL;
CREATE INDEX idx_organizational_units_tree
ON organizational_units(workspace_id, parent_unit_id, valid_from, valid_to, status, name);

CREATE TABLE organization_positions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX idx_organization_positions_code
ON organization_positions(workspace_id, code) WHERE code IS NOT NULL;
CREATE INDEX idx_organization_positions_name
ON organization_positions(workspace_id, status, name);

CREATE TABLE person_appointments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  unit_id TEXT NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
  position_id TEXT REFERENCES organization_positions(id) ON DELETE RESTRICT,
  manager_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  appointment_kind TEXT NOT NULL DEFAULT 'primary' CHECK(appointment_kind IN ('primary','additional')),
  valid_from TEXT NOT NULL CHECK(valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT CHECK(valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  change_reason TEXT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(valid_to IS NULL OR valid_to >= valid_from),
  CHECK(manager_person_id IS NULL OR manager_person_id <> person_id)
) STRICT;
CREATE INDEX idx_person_appointments_person
ON person_appointments(workspace_id, person_id, appointment_kind, valid_from DESC, valid_to);
CREATE INDEX idx_person_appointments_unit
ON person_appointments(workspace_id, unit_id, valid_from, valid_to, person_id);
CREATE INDEX idx_person_appointments_manager
ON person_appointments(workspace_id, manager_person_id, valid_from, valid_to);

CREATE TRIGGER person_primary_appointment_no_overlap_insert
BEFORE INSERT ON person_appointments
WHEN NEW.appointment_kind = 'primary' AND EXISTS (
  SELECT 1 FROM person_appointments pa
  WHERE pa.workspace_id = NEW.workspace_id AND pa.person_id = NEW.person_id
    AND pa.appointment_kind = 'primary'
    AND NOT (COALESCE(pa.valid_to,'9999-12-31') < NEW.valid_from
      OR COALESCE(NEW.valid_to,'9999-12-31') < pa.valid_from)
)
BEGIN
  SELECT RAISE(ABORT, 'person_appointment_primary_overlap');
END;

CREATE TRIGGER person_primary_appointment_no_overlap_update
BEFORE UPDATE OF workspace_id, person_id, appointment_kind, valid_from, valid_to ON person_appointments
WHEN NEW.appointment_kind = 'primary' AND EXISTS (
  SELECT 1 FROM person_appointments pa
  WHERE pa.id <> NEW.id AND pa.workspace_id = NEW.workspace_id AND pa.person_id = NEW.person_id
    AND pa.appointment_kind = 'primary'
    AND NOT (COALESCE(pa.valid_to,'9999-12-31') < NEW.valid_from
      OR COALESCE(NEW.valid_to,'9999-12-31') < pa.valid_from)
)
BEGIN
  SELECT RAISE(ABORT, 'person_appointment_primary_overlap');
END;

CREATE TABLE scientific_author_affiliations (
  id TEXT PRIMARY KEY,
  scientific_item_id TEXT NOT NULL,
  author_raw TEXT NOT NULL,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES person_appointments(id) ON DELETE SET NULL,
  unit_id TEXT REFERENCES organizational_units(id) ON DELETE SET NULL,
  position_id TEXT REFERENCES organization_positions(id) ON DELETE SET NULL,
  unit_name_snapshot TEXT,
  position_name_snapshot TEXT,
  valid_on TEXT NOT NULL CHECK(valid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_kind TEXT NOT NULL DEFAULT 'derived' CHECK(source_kind IN ('derived','manual')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(scientific_item_id, author_raw)
    REFERENCES scientific_item_authors(scientific_item_id, author_raw) ON DELETE CASCADE,
  UNIQUE(scientific_item_id, author_raw)
) STRICT;
CREATE INDEX idx_scientific_affiliations_person
ON scientific_author_affiliations(person_id, valid_on, scientific_item_id);
CREATE INDEX idx_scientific_affiliations_unit
ON scientific_author_affiliations(unit_id, valid_on, scientific_item_id);

INSERT INTO organizational_units(
  id, workspace_id, unit_kind, code, name, valid_from, status,
  evidence_json, created_at, updated_at
)
SELECT 'orgunit_' || lower(hex(randomblob(16))), id, 'organization', 'ROOT',
  COALESCE(NULLIF(trim(name),''), 'Рабочее пространство'), '2000-01-01', 'active',
  '{"migration":20,"legacyRoot":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM workspaces;

INSERT INTO organization_positions(
  id, workspace_id, name, status, evidence_json, created_at, updated_at
)
SELECT 'orgpos_' || lower(hex(randomblob(16))), workspace_id, trim(position), 'active',
  '{"migration":20,"legacyPosition":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM people
WHERE NULLIF(trim(position),'') IS NOT NULL
GROUP BY workspace_id, trim(position);

INSERT INTO person_appointments(
  id, workspace_id, person_id, unit_id, position_id, manager_person_id,
  appointment_kind, valid_from, evidence_json, change_reason, created_at, updated_at
)
SELECT 'appointment_' || lower(hex(randomblob(16))), p.workspace_id, p.id, ou.id, op.id,
  p.manager_id, 'primary', COALESCE(substr(p.created_at,1,10),'2000-01-01'),
  '{"migration":20,"legacyPersonFields":true}',
  'Перенос текущей должности и руководителя из схемы 19', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM people p
JOIN organizational_units ou ON ou.workspace_id = p.workspace_id AND ou.code = 'ROOT'
LEFT JOIN organization_positions op
  ON op.workspace_id = p.workspace_id AND op.name = trim(p.position);

INSERT INTO scientific_author_affiliations(
  id, scientific_item_id, author_raw, person_id, appointment_id, unit_id, position_id,
  unit_name_snapshot, position_name_snapshot, valid_on, source_kind, evidence_json,
  created_at, updated_at
)
SELECT 'scienceaff_' || lower(hex(randomblob(16))), sia.scientific_item_id, sia.author_raw,
  sia.person_id, pa.id, pa.unit_id, pa.position_id, ou.name, op.name,
  COALESCE(si.published_at,
    CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31',si.publication_year) END,
    substr(si.created_at,1,10), date('now')),
  'derived', '{"migration":20,"derivedFromAppointment":true}',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM scientific_item_authors sia
JOIN scientific_items si ON si.id = sia.scientific_item_id
LEFT JOIN person_appointments pa ON pa.id = (
  SELECT candidate.id FROM person_appointments candidate
  WHERE candidate.workspace_id = si.workspace_id AND candidate.person_id = sia.person_id
    AND candidate.valid_from <= COALESCE(si.published_at,
      CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31',si.publication_year) END,
      substr(si.created_at,1,10), date('now'))
    AND (candidate.valid_to IS NULL OR candidate.valid_to >= COALESCE(si.published_at,
      CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31',si.publication_year) END,
      substr(si.created_at,1,10), date('now')))
  ORDER BY candidate.appointment_kind = 'primary' DESC, candidate.valid_from DESC LIMIT 1
)
LEFT JOIN organizational_units ou ON ou.id = pa.unit_id
LEFT JOIN organization_positions op ON op.id = pa.position_id
WHERE sia.person_id IS NOT NULL;

CREATE TRIGGER scientific_author_affiliation_after_insert
AFTER INSERT ON scientific_item_authors
WHEN NEW.person_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO scientific_author_affiliations(
    id, scientific_item_id, author_raw, person_id, appointment_id, unit_id, position_id,
    unit_name_snapshot, position_name_snapshot, valid_on, source_kind, evidence_json,
    created_at, updated_at
  )
  SELECT 'scienceaff_' || lower(hex(randomblob(16))), NEW.scientific_item_id, NEW.author_raw,
    NEW.person_id, pa.id, pa.unit_id, pa.position_id, ou.name, op.name,
    COALESCE(si.published_at,
      CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31',si.publication_year) END,
      substr(si.created_at,1,10), date('now')),
    'derived', '{"derivedFromAppointment":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM scientific_items si
  LEFT JOIN person_appointments pa ON pa.id = (
    SELECT candidate.id FROM person_appointments candidate
    WHERE candidate.workspace_id = si.workspace_id AND candidate.person_id = NEW.person_id
      AND candidate.valid_from <= COALESCE(si.published_at,
        CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31',si.publication_year) END,
        substr(si.created_at,1,10), date('now'))
      AND (candidate.valid_to IS NULL OR candidate.valid_to >= COALESCE(si.published_at,
        CASE WHEN si.publication_year IS NOT NULL THEN printf('%04d-12-31',si.publication_year) END,
        substr(si.created_at,1,10), date('now')))
    ORDER BY candidate.appointment_kind = 'primary' DESC, candidate.valid_from DESC LIMIT 1
  )
  LEFT JOIN organizational_units ou ON ou.id = pa.unit_id
  LEFT JOIN organization_positions op ON op.id = pa.position_id
  WHERE si.id = NEW.scientific_item_id;
END;
