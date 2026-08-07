CREATE TABLE IF NOT EXISTS notification_delivery_profiles (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  smtp_enabled INTEGER NOT NULL DEFAULT 0 CHECK(smtp_enabled IN (0, 1)),
  email_address TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 0 CHECK(telegram_enabled IN (0, 1)),
  telegram_chat_id TEXT,
  immediate_enabled INTEGER NOT NULL DEFAULT 1 CHECK(immediate_enabled IN (0, 1)),
  daily_digest_enabled INTEGER NOT NULL DEFAULT 0 CHECK(daily_digest_enabled IN (0, 1)),
  daily_digest_time TEXT NOT NULL DEFAULT '08:00',
  weekly_digest_enabled INTEGER NOT NULL DEFAULT 0 CHECK(weekly_digest_enabled IN (0, 1)),
  weekly_digest_day INTEGER NOT NULL DEFAULT 1 CHECK(weekly_digest_day BETWEEN 1 AND 7),
  weekly_digest_time TEXT NOT NULL DEFAULT '08:00',
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 1 CHECK(quiet_hours_enabled IN (0, 1)),
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end TEXT NOT NULL DEFAULT '07:00',
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, person_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notification_delivery_profiles_enabled
ON notification_delivery_profiles(workspace_id, smtp_enabled, telegram_enabled);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  notification_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('smtp', 'telegram')),
  delivery_kind TEXT NOT NULL CHECK(delivery_kind IN ('immediate', 'daily_digest', 'weekly_digest')),
  destination TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created', 'sent', 'delivered', 'confirmed', 'error')),
  retry_sequence INTEGER NOT NULL DEFAULT 0 CHECK(retry_sequence >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  available_at TEXT NOT NULL,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT,
  confirmed_at TEXT,
  UNIQUE(workspace_id, person_id, notification_key, channel)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
ON notification_deliveries(workspace_id, status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_person
ON notification_deliveries(workspace_id, person_id, created_at DESC);
