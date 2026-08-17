import { parseJson } from './shared.mjs';

function supportingRows(database, workspaceId, targetKind, targetId) {
  return database.all(`
    SELECT sd.id, sd.document_number, sd.document_date, sd.title, sd.note,
      sd.document_version_id, sd.status, l.id AS link_id, l.relation_kind, l.note AS link_note,
      dv.document_id, d.title AS document_title, dv.original_name
    FROM supporting_document_links l
    JOIN supporting_documents sd ON sd.id = l.supporting_document_id
    LEFT JOIN document_versions dv ON dv.id = sd.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE l.workspace_id = ? AND l.target_kind = ? AND l.target_id = ? AND sd.status = 'active'
    ORDER BY sd.document_date DESC, sd.document_number, l.created_at DESC
  `, workspaceId, targetKind, targetId);
}

function assignmentForItem(database, itemId) {
  const row = database.get(`
    SELECT a.*, pia.execution_mode AS plan_execution_mode,
      pia.claimed_by_person_id, pia.created_at AS linked_at
    FROM plan_item_assignments pia
    JOIN assignments a ON a.id = pia.assignment_id
    WHERE pia.plan_item_id = ?
  `, itemId);
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidence_json, {}),
    executors: database.all(`
      SELECT ae.*, p.display_name, p.manager_id
      FROM assignment_executors ae
      LEFT JOIN people p ON p.id = ae.person_id
      WHERE ae.assignment_id = ?
      ORDER BY CASE ae.role WHEN 'executor' THEN 1 WHEN 'coexecutor' THEN 2 WHEN 'controller' THEN 3 ELSE 4 END,
        ae.executor_raw
    `, row.id)
  };
}

function planRow(database, workspaceId, planId) {
  const row = database.get(`
    SELECT p.*, owner.display_name AS owner_name,
      dv.document_id AS source_document_id, d.title AS source_document_title,
      dv.original_name AS source_original_name
    FROM plans p
    LEFT JOIN document_versions dv ON dv.id = p.source_document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    LEFT JOIN people owner ON owner.id = p.owner_person_id
    WHERE p.workspace_id = ? AND p.id = ?
  `, workspaceId, planId);
  if (!row) return null;
  return { ...row, evidence: parseJson(row.evidence_json, {}) };
}

function itemRows(database, workspaceId, planId) {
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
    `, row.id),
    assignment: assignmentForItem(database, row.id),
    supporting_documents: supportingRows(database, workspaceId, 'plan_item', row.id)
  }));
}

export function getPlan(database, workspaceId, planId) {
  const plan = planRow(database, workspaceId, planId);
  if (!plan) return null;
  return { ...plan, items: itemRows(database, workspaceId, planId) };
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
  const assignmentPeople = database.all(`
    SELECT ae.person_id, person.manager_id
    FROM plan_item_assignments pia
    JOIN assignment_executors ae ON ae.assignment_id = pia.assignment_id
    LEFT JOIN people person ON person.id = ae.person_id
    WHERE pia.plan_item_id = ? AND ae.person_id IS NOT NULL
  `, planItemId).flatMap((item) => [item.person_id, item.manager_id]);
  return [...new Set([
    row.responsible_person_id, row.owner_person_id, row.manager_id, ...assignmentPeople
  ].filter(Boolean))];
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
    LEFT JOIN document_versions dv ON dv.id = p.source_document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
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
