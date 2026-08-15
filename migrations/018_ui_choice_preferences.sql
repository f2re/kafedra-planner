CREATE TABLE IF NOT EXISTS ui_choice_preferences (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  context_key TEXT NOT NULL,
  choice_value TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, account_id, context_key, interaction_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ui_choice_preferences_rank
ON ui_choice_preferences(workspace_id, account_id, context_key, choice_value, selected_at DESC);
