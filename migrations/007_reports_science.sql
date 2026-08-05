ALTER TABLE assignment_evidence ADD COLUMN match_status TEXT NOT NULL DEFAULT 'attached';
ALTER TABLE assignment_evidence ADD COLUMN match_score REAL;
ALTER TABLE assignment_evidence ADD COLUMN match_reasons_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE assignment_evidence ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE assignment_evidence ADD COLUMN reviewed_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE assignment_evidence ADD COLUMN reviewed_at TEXT;
ALTER TABLE assignment_evidence ADD COLUMN review_note TEXT;

CREATE TABLE IF NOT EXISTS report_match_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK(score >= 0 AND score <= 1),
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  UNIQUE(assignment_id, document_version_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_report_matches_document
ON report_match_candidates(workspace_id, document_version_id, status, score DESC);
CREATE INDEX IF NOT EXISTS idx_report_matches_assignment
ON report_match_candidates(assignment_id, status, score DESC);

CREATE TABLE IF NOT EXISTS scientific_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
  item_kind TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL,
  abstract_text TEXT,
  published_at TEXT,
  publication_year INTEGER,
  venue TEXT,
  doi TEXT,
  identifiers_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'proposed',
  direction TEXT NOT NULL DEFAULT 'science',
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, source_document_version_id)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scientific_items_doi
ON scientific_items(workspace_id, doi) WHERE doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scientific_items_period
ON scientific_items(workspace_id, publication_year, published_at, item_kind, status);

CREATE TABLE IF NOT EXISTS scientific_item_authors (
  scientific_item_id TEXT NOT NULL REFERENCES scientific_items(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  author_raw TEXT NOT NULL,
  author_order INTEGER NOT NULL DEFAULT 1,
  affiliation TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(scientific_item_id, author_raw)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_scientific_authors_person
ON scientific_item_authors(person_id, scientific_item_id);

CREATE TABLE IF NOT EXISTS scientific_item_classifications (
  id TEXT PRIMARY KEY,
  scientific_item_id TEXT NOT NULL REFERENCES scientific_items(id) ON DELETE CASCADE,
  classification_kind TEXT NOT NULL,
  classification_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(scientific_item_id, classification_kind, classification_value)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_scientific_classifications
ON scientific_item_classifications(classification_kind, classification_value, scientific_item_id);

CREATE TABLE IF NOT EXISTS scientific_item_evidence (
  id TEXT PRIMARY KEY,
  scientific_item_id TEXT NOT NULL REFERENCES scientific_items(id) ON DELETE CASCADE,
  document_version_id TEXT REFERENCES document_versions(id) ON DELETE RESTRICT,
  evidence_kind TEXT NOT NULL DEFAULT 'source',
  locator_json TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_scientific_evidence
ON scientific_item_evidence(scientific_item_id, evidence_kind, created_at DESC);
