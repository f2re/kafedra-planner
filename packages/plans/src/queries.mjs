import { parseJson } from './shared.mjs';

function planRow(database, workspaceId, planId) {
  const row = database.get(`
    SELECT p.*, owner.display_name AS owner_name,
      dv.document_id AS source_document_id, d.title AS source_document_title,
      dv.original_name AS source_original_name
    FROM plans p
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN people owner ON owner.id = p.owner_person_id
    WHERE p.workspace_id = ? AND p.id = ?
  `, workspaceId, planId);
  if (!row) return null;
  return { ...row, evidence: parseJson(row.evidence_json, {}) };
}

function itemRows(database, planId) {
  return database.all(`
    SELECT pi.*, person.display_name AS responsible_name
    FROM plan_items pi
    LEFT JOIN people person ON person.id = pi.responsible_person_id
    WHERE pi.plan_id = ?
    ORDER BY COALESCE(pi.due_date, pi.starts_at, '9999-12-31'), pi.source_item_key
  `, planId).map((row) => ({
    ...row,
    evidence: parseJson(row.evidence_json, {}),
    calendar_items: database.all(`
      SELECT * FROM calendar_items
      WHERE source_kind = 'plan_item' AND source_id = ?
      ORDER BY starts_at, item_kind
    `, row.id)
  }));
}

export function getPlan(database, workspaceId, planId) {
  const plan = planRow(database, workspaceId, planId);
  if (!plan) return null;
  return { ...plan, items: itemRows(database, planId) };
}

export function planDocumentId(database, workspaceId, planId) {
  return database.get(`
    SELECT dv.document_id
    FROM plans p JOIN document_versions dv ON dv.id = p.source_document_version_id
    WHERE p.workspace_id = ? AND p.id = ?
  `, workspaceId, planId)?.document_id || null;
}

export function planItemDocumentId(database, workspaceId, planItemId) {
  return database.get(`
    SELECT dv.document_id
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, planItemId)?.document_id || null;
}

export function planItemAudience(database, workspaceId, planItemId) {
  const row = database.get(`
    SELECT pi.responsible_person_id, p.owner_person_id, responsible.manager_id
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id AND p.workspace_id = ?
    LEFT JOIN people responsible ON responsible.id = pi.responsible_person_id
    WHERE pi.id = ?
  `, workspaceId, planItemId);
  if (!row) return [];
  return [...new Set([row.responsible_person_id, row.owner_person_id, row.manager_id].filter(Boolean))];
}

function listWhere(filters, params) {
  const clauses = ['p.workspace_id = ?'];
  params.push(filters.workspaceId);
  if (filters.kind) { clauses.push('p.plan_kind = ?'); params.push(filters.kind); }
  if (filters.periodKind) { clauses.push('p.period_kind = ?'); params.push(filters.periodKind); }
  if (filters.periodKey) { clauses.push('p.period_key = ?'); params.push(filters.periodKey); }
  if (filters.status) { clauses.push('p.status = ?'); params.push(filters.status); }
  if (filters.ownerPersonId) { clauses.push('p.owner_person_id = ?'); params.push(filters.ownerPersonId); }
  if (filters.direction) {
    clauses.push('EXISTS (SELECT 1 FROM plan_items pi WHERE pi.plan_id = p.id AND pi.direction = ?)');
    params.push(filters.direction);
  }
  if (filters.responsible) {
    clauses.push(`EXISTS (
      SELECT 1 FROM plan_items pi LEFT JOIN people rp ON rp.id = pi.responsible_person_id
      WHERE pi.plan_id = p.id AND (pi.responsible_raw LIKE ? OR rp.display_name LIKE ?)
    )`);
    const value = `%${filters.responsible}%`;
    params.push(value, value);
  }
  if (filters.q) {
    clauses.push(`(
      p.title LIKE ? OR p.owner_raw LIKE ? OR p.period_key LIKE ? OR EXISTS (
        SELECT 1 FROM plan_items pi WHERE pi.plan_id = p.id
          AND (pi.title LIKE ? OR pi.description LIKE ? OR pi.expected_result LIKE ?)
      )
    )`);
    const value = `%${filters.q}%`;
    params.push(value, value, value, value, value, value);
  }
  return clauses;
}

export function listPlans(database, workspaceId, filters = {}) {
  const params = [];
  const clauses = listWhere({ ...filters, workspaceId }, params);
  const limit = Math.min(2000, Math.max(1, Number(filters.limit) || 300));
  params.push(limit);
  return database.all(`
    SELECT p.*, owner.display_name AS owner_name,
      dv.document_id AS source_document_id, d.title AS source_document_title,
      COUNT(pi.id) AS item_count,
      SUM(CASE WHEN pi.starts_at IS NOT NULL OR pi.due_date IS NOT NULL THEN 1 ELSE 0 END) AS dated_item_count,
      MIN(COALESCE(pi.starts_at, pi.due_date)) AS first_date,
      MAX(COALESCE(pi.due_date, pi.ends_at, pi.starts_at)) AS last_date,
      GROUP_CONCAT(DISTINCT pi.direction) AS directions
    FROM plans p
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN people owner ON owner.id = p.owner_person_id
    LEFT JOIN plan_items pi ON pi.plan_id = p.id
    WHERE ${clauses.join(' AND ')}
    GROUP BY p.id
    ORDER BY COALESCE(p.year_start, 0) DESC, p.updated_at DESC
    LIMIT ?
  `, ...params).map((row) => ({ ...row, evidence: parseJson(row.evidence_json, {}) }));
}

export function listPlanFacets(database, workspaceId) {
  const kinds = database.all(`SELECT plan_kind AS value, COUNT(*) AS count FROM plans WHERE workspace_id = ? GROUP BY plan_kind ORDER BY plan_kind`, workspaceId);
  const periods = database.all(`SELECT period_key AS value, COUNT(*) AS count FROM plans WHERE workspace_id = ? AND period_key IS NOT NULL GROUP BY period_key ORDER BY period_key DESC`, workspaceId);
  const directions = database.all(`
    SELECT pi.direction AS value, COUNT(*) AS count
    FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? GROUP BY pi.direction ORDER BY pi.direction
  `, workspaceId);
  return { kinds, periods, directions };
}
