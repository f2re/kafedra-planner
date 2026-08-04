export function ensureDefaultWorkspace(database, now = new Date().toISOString()) {
  const existing = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (existing) return existing;
  database.run(
    'INSERT OR IGNORE INTO workspaces(id, code, name, created_at) VALUES (?, ?, ?, ?)',
    'ws_main',
    'main',
    'Кафедра',
    now
  );
  return database.get("SELECT * FROM workspaces WHERE code = 'main'");
}
