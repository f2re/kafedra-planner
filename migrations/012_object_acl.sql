CREATE TABLE IF NOT EXISTS object_access_policies (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  access_scope TEXT NOT NULL DEFAULT 'restricted'
    CHECK(access_scope IN ('restricted', 'workspace')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, object_kind, object_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_object_access_owner
ON object_access_policies(workspace_id, owner_person_id, object_kind);

CREATE TABLE IF NOT EXISTS object_acl_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  access_role TEXT NOT NULL CHECK(access_role IN ('reader', 'editor', 'controller', 'owner')),
  created_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, object_kind, object_id, person_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_object_acl_person
ON object_acl_entries(workspace_id, person_id, object_kind, object_id);
CREATE INDEX IF NOT EXISTS idx_object_acl_object
ON object_acl_entries(workspace_id, object_kind, object_id, access_role);

INSERT OR IGNORE INTO object_access_policies(
  workspace_id, object_kind, object_id, owner_person_id, access_scope, created_at, updated_at
)
SELECT d.workspace_id, 'document', d.id,
  COALESCE(
    (
      SELECT ae.person_id
      FROM document_versions dv
      JOIN assignment_evidence ev ON ev.document_version_id = dv.id
      JOIN assignment_executors ae ON ae.assignment_id = ev.assignment_id
      WHERE dv.document_id = d.id AND ae.person_id IS NOT NULL AND ae.role <> 'controller'
      ORDER BY ev.created_at, ae.created_at LIMIT 1
    ),
    (
      SELECT ae.person_id
      FROM document_versions dv
      JOIN directives dir ON dir.source_document_version_id = dv.id
      JOIN assignments a ON a.directive_id = dir.id
      JOIN assignment_executors ae ON ae.assignment_id = a.id
      WHERE dv.document_id = d.id AND ae.person_id IS NOT NULL AND ae.role <> 'controller'
      ORDER BY a.created_at, ae.created_at LIMIT 1
    ),
    (
      SELECT sia.person_id
      FROM document_versions dv
      JOIN scientific_items si ON si.source_document_version_id = dv.id
      JOIN scientific_item_authors sia ON sia.scientific_item_id = si.id
      WHERE dv.document_id = d.id AND sia.person_id IS NOT NULL
      ORDER BY sia.author_order LIMIT 1
    )
  ),
  'restricted', d.created_at, d.updated_at
FROM documents d;

INSERT OR IGNORE INTO object_access_policies(
  workspace_id, object_kind, object_id, owner_person_id, access_scope, created_at, updated_at
)
SELECT dir.workspace_id, 'directive', dir.id,
  (
    SELECT ae.person_id
    FROM assignments a
    JOIN assignment_executors ae ON ae.assignment_id = a.id
    WHERE a.directive_id = dir.id AND ae.person_id IS NOT NULL AND ae.role <> 'controller'
    ORDER BY a.created_at, ae.created_at LIMIT 1
  ),
  'restricted', dir.created_at, dir.updated_at
FROM directives dir;

INSERT OR IGNORE INTO object_access_policies(
  workspace_id, object_kind, object_id, owner_person_id, access_scope, created_at, updated_at
)
SELECT si.workspace_id, 'scientific_item', si.id,
  (
    SELECT sia.person_id
    FROM scientific_item_authors sia
    WHERE sia.scientific_item_id = si.id AND sia.person_id IS NOT NULL
    ORDER BY sia.author_order LIMIT 1
  ),
  'restricted', si.created_at, si.updated_at
FROM scientific_items si;
