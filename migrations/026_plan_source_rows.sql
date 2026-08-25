CREATE TABLE IF NOT EXISTS plan_source_rows (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  source_row_key TEXT NOT NULL,
  group_kind TEXT NOT NULL CHECK(group_kind IN ('table','sheet','delimited','line')),
  group_name TEXT,
  row_number INTEGER NOT NULL CHECK(row_number > 0),
  row_role TEXT NOT NULL DEFAULT 'context' CHECK(row_role IN ('header','item','context')),
  raw_text TEXT NOT NULL,
  cells_json TEXT NOT NULL DEFAULT '[]',
  locator_json TEXT NOT NULL DEFAULT '{}',
  suggestion_json TEXT NOT NULL DEFAULT '{}',
  unmapped_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, source_row_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_plan_source_rows_plan
ON plan_source_rows(plan_id, group_kind, group_name, row_number);

CREATE INDEX IF NOT EXISTS idx_plan_source_rows_role
ON plan_source_rows(plan_id, row_role);

CREATE TABLE IF NOT EXISTS plan_source_row_items (
  source_row_id TEXT NOT NULL REFERENCES plan_source_rows(id) ON DELETE CASCADE,
  plan_item_id TEXT NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  split_index INTEGER NOT NULL DEFAULT 0 CHECK(split_index >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_row_id, plan_item_id),
  UNIQUE(plan_item_id),
  UNIQUE(source_row_id, split_index)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_plan_source_row_items_item
ON plan_source_row_items(plan_item_id);
