CREATE TABLE IF NOT EXISTS auth_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('staff', 'manager', 'admin')),
  password_hash TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, normalized_username),
  UNIQUE(workspace_id, person_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auth_accounts_workspace_role
ON auth_accounts(workspace_id, role, is_active);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip_hash TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account_active
ON auth_sessions(account_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
ON auth_sessions(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES auth_accounts(id) ON DELETE SET NULL,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auth_audit_workspace_created
ON auth_audit_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_actor
ON auth_audit_events(account_id, created_at DESC);
