ALTER TABLE documents ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE documents ADD COLUMN archived_at TEXT;
ALTER TABLE documents ADD COLUMN archived_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN archive_reason TEXT;
ALTER TABLE documents ADD COLUMN replacement_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX idx_documents_lifecycle
ON documents(workspace_id, lifecycle_status, updated_at DESC);
CREATE INDEX idx_documents_replacement
ON documents(workspace_id, replacement_document_id);

ALTER TABLE plans ADD COLUMN archived_at TEXT;
ALTER TABLE plans ADD COLUMN archived_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE plans ADD COLUMN archive_reason TEXT;
ALTER TABLE plans ADD COLUMN replacement_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;

CREATE INDEX idx_plans_replacement
ON plans(workspace_id, replacement_plan_id);
