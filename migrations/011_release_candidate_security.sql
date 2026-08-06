ALTER TABLE auth_sessions ADD COLUMN csrf_token TEXT;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_workspace_active
ON auth_sessions(account_id, revoked_at, expires_at, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_people_manager_active
ON people(workspace_id, manager_id, status, display_name);
