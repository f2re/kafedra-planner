function organizationTablesPresent(database) {
  return Boolean(database.get(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'organizational_units'"
  ));
}

function ensureOrganizationRoot(database, workspace, now) {
  if (!workspace || !organizationTablesPresent(database)) return;
  database.run(`
    INSERT OR IGNORE INTO organizational_units(
      id, workspace_id, unit_kind, code, name, valid_from, status,
      evidence_json, created_at, updated_at
    ) VALUES (?, ?, 'organization', 'ROOT', ?, '2000-01-01', 'active', ?, ?, ?)
  `,
  `orgunit_root_${workspace.id}`,
  workspace.id,
  String(workspace.name || 'Рабочее пространство').trim() || 'Рабочее пространство',
  JSON.stringify({ bootstrap: true, provenance: 'system' }),
  now,
  now);
}

export function ensureDefaultWorkspace(database, now = new Date().toISOString()) {
  let workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) {
    database.run(
      'INSERT OR IGNORE INTO workspaces(id, code, name, created_at) VALUES (?, ?, ?, ?)',
      'ws_main',
      'main',
      'Кафедра',
      now
    );
    workspace = database.get("SELECT * FROM workspaces WHERE code = 'main'");
  }
  ensureOrganizationRoot(database, workspace, now);
  return workspace;
}
