import { resolvePlanItemAccess } from './access.mjs';

// Resolution is synchronous. Keeping a stack per Database makes indirect chains
// (export → source plan → document → export) fail closed without altering callers.
const activeDocuments = new WeakMap();

function denied(reason = 'monthly_export_source_unavailable') {
  return { allowed: false, role: 'none', reason };
}

export function resolveMonthlyExportSources(database, workspaceId, context, documentId, resolveDocumentAccess) {
  if (!database.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'monthly_plan_exports'")) return null;
  const row = database.get(`
    SELECT d.document_type, e.*, p.created_by_person_id AS draft_owner_person_id
    FROM documents d
    LEFT JOIN monthly_plan_exports e ON e.generated_document_id = d.id AND e.workspace_id = d.workspace_id
    LEFT JOIN monthly_plans p ON p.id = e.monthly_plan_id AND p.workspace_id = e.workspace_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
  if (!row || (!row.id && row.document_type !== 'monthly_plan_export')) return null;
  if (!row.id || row.status !== 'completed' || !context?.authenticated) return denied();
  if (context.enabled && context.role !== 'admin'
    && (!context.personId || row.draft_owner_person_id !== context.personId)) return denied('monthly_export_owner_required');
  const active = activeDocuments.get(database) || new Set();
  const key = `${workspaceId}:${documentId}`;
  if (active.has(key) || active.size >= 64) return denied('monthly_export_source_cycle');
  active.add(key);
  activeDocuments.set(database, active);
  try {
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot_json); } catch { return denied('monthly_export_snapshot_invalid'); }
    if (!snapshot || snapshot.monthlyPlanId !== row.monthly_plan_id
      || !Array.isArray(snapshot.items) || !snapshot.items.length || snapshot.items.length > 5000) return denied('monthly_export_snapshot_invalid');
    for (const item of snapshot.items) {
      if (typeof item?.source?.id !== 'string'
        || !resolvePlanItemAccess(database, workspaceId, context, item.source.id, 'read').allowed) return denied();
      if (item.source.source_document_version_id) {
        const version = database.get(`
          SELECT v.document_id FROM document_versions v JOIN documents d ON d.id = v.document_id
          WHERE v.id = ? AND d.workspace_id = ?
        `, item.source.source_document_version_id, workspaceId);
        if (!version || version.document_id !== item.source.source_document_id
          || !resolveDocumentAccess(version.document_id).allowed) return denied();
      } else if (item.source.source_document_id) {
        // A document-backed source must retain an exact immutable version.
        return denied('monthly_export_snapshot_invalid');
      }
    }
    if (row.template_id) {
      const version = database.get(`
        SELECT v.document_id FROM document_versions v JOIN documents d ON d.id = v.document_id
        WHERE v.id = ? AND d.workspace_id = ?
      `, row.template_document_version_id, workspaceId);
      if (snapshot.template?.id !== row.template_id
        || snapshot.template?.documentVersionId !== row.template_document_version_id
        || !version || version.document_id !== snapshot.template?.documentId
        || !resolveDocumentAccess(version.document_id).allowed) return denied();
    } else if (snapshot.template !== null) return denied('monthly_export_snapshot_invalid');
    if (snapshot.eventTemplate) {
      const template = database.get(`SELECT t.created_by_person_id, v.template_id
        FROM plan_event_template_versions v JOIN plan_event_templates t ON t.id = v.template_id
        WHERE v.id = ? AND v.workspace_id = ? AND t.workspace_id = ?`, snapshot.eventTemplate.id, workspaceId, workspaceId);
      if (!template || template.template_id !== snapshot.eventTemplate.templateId
        || (context.enabled && context.role !== 'admin' && context.personId !== template.created_by_person_id)) {
        return denied('monthly_export_event_template_unavailable');
      }
    }
    return { allowed: true, reason: 'monthly_export_sources_accessible' };
  } finally {
    active.delete(key);
    if (!active.size) activeDocuments.delete(database);
  }
}
