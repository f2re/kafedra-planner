CREATE TABLE scientific_item_manual_overrides (
  scientific_item_id TEXT PRIMARY KEY REFERENCES scientific_items(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT,
  kind TEXT,
  doi TEXT,
  publication_year INTEGER CHECK(publication_year IS NULL OR publication_year BETWEEN 1900 AND 2200),
  published_at TEXT CHECK(published_at IS NULL OR published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  venue TEXT,
  authors_json TEXT,
  classifications_json TEXT,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  updated_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_scientific_manual_overrides_workspace
ON scientific_item_manual_overrides(workspace_id, updated_at DESC);
