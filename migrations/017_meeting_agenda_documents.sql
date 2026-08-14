CREATE TABLE meeting_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  protocol_template_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  extract_template_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  quorum INTEGER NOT NULL CHECK(quorum > 0),
  chairperson_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  secretary_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  updated_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE migration_017_decisions_backup AS SELECT * FROM decisions;
CREATE TABLE migration_017_agenda_backup AS SELECT * FROM agenda_items;
DELETE FROM agenda_items;

CREATE TABLE meetings_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  protocol_number TEXT,
  meeting_date TEXT,
  title TEXT NOT NULL,
  chairperson_raw TEXT,
  secretary_raw TEXT,
  attendees_raw TEXT,
  chairperson_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  secretary_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  quorum_required INTEGER CHECK(quorum_required IS NULL OR quorum_required > 0),
  protocol_template_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  extract_template_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;

INSERT INTO meetings_new(
  id, workspace_id, source_document_version_id, protocol_number, meeting_date,
  title, chairperson_raw, secretary_raw, attendees_raw, confidence, status,
  evidence_json, created_at, updated_at
)
SELECT
  id, workspace_id, source_document_version_id, protocol_number, meeting_date,
  title, chairperson_raw, secretary_raw, attendees_raw, confidence, status,
  evidence_json, created_at, updated_at
FROM meetings;

DROP TABLE meetings;
ALTER TABLE meetings_new RENAME TO meetings;
CREATE INDEX idx_meetings_date ON meetings(workspace_id, meeting_date);
CREATE INDEX idx_meetings_protocol_number
ON meetings(workspace_id, protocol_number, meeting_date);

INSERT INTO agenda_items(
  id, meeting_id, item_no, title, heard_text, discussed_text, decision_text,
  evidence_json, created_at
)
SELECT
  id, meeting_id, item_no, title, heard_text, discussed_text, decision_text,
  evidence_json, created_at
FROM migration_017_agenda_backup;

INSERT INTO decisions(
  id, agenda_item_id, text, responsible_raw, due_date, status, evidence_json, created_at
)
SELECT
  id, agenda_item_id, text, responsible_raw, due_date, status, evidence_json, created_at
FROM migration_017_decisions_backup;

DROP TABLE migration_017_decisions_backup;
DROP TABLE migration_017_agenda_backup;

ALTER TABLE agenda_items ADD COLUMN source_kind TEXT;
ALTER TABLE agenda_items ADD COLUMN source_id TEXT;
ALTER TABLE agenda_items ADD COLUMN source_label TEXT;
ALTER TABLE agenda_items ADD COLUMN updated_at TEXT;
CREATE INDEX idx_agenda_items_source
ON agenda_items(source_kind, source_id);
CREATE UNIQUE INDEX idx_agenda_items_unique_source_per_meeting
ON agenda_items(meeting_id, source_kind, source_id)
WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE meeting_documents (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  document_kind TEXT NOT NULL CHECK(document_kind IN ('protocol', 'extract')),
  question_numbers TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  template_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(meeting_id, document_kind, request_hash)
) STRICT;
CREATE INDEX idx_meeting_documents_meeting
ON meeting_documents(meeting_id, created_at DESC);
