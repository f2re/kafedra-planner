CREATE TABLE IF NOT EXISTS periodic_task_evidence (
  id TEXT PRIMARY KEY,
  periodic_task_id TEXT NOT NULL REFERENCES periodic_tasks(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
  evidence_kind TEXT NOT NULL DEFAULT 'report',
  note TEXT,
  locator_json TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(review_status IN ('pending','approved','returned')),
  reviewed_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(periodic_task_id, document_version_id, evidence_kind)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_periodic_task_evidence_task
ON periodic_task_evidence(periodic_task_id, review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_periodic_task_evidence_document
ON periodic_task_evidence(document_version_id, periodic_task_id);
