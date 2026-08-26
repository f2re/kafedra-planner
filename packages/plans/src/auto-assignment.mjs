import { newId } from '../../core/src/ids.mjs';
import { resolvePersonAppointment } from '../../organization/src/appointments.mjs';
import { setPlanItemExecution } from './manual.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function asOfDate(item, now) {
  return String(item.due_date || item.starts_at || now || '').slice(0, 10);
}

export function resolvePlanController(database, workspaceId, responsiblePersonId, item = {}, now = new Date().toISOString()) {
  if (!responsiblePersonId) return { personId: null, source: null };
  const person = database.get(`
    SELECT id, manager_id FROM people
    WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, responsiblePersonId);
  if (!person) return { personId: null, source: null };

  let appointment = null;
  const validOn = asOfDate(item, now);
  if (validOn) {
    try {
      appointment = resolvePersonAppointment(database, workspaceId, responsiblePersonId, validOn, { kind: 'primary' });
    } catch {
      appointment = null;
    }
  }
  const candidateId = appointment?.manager_person_id || person.manager_id || null;
  if (!candidateId) return { personId: null, source: null };
  const manager = database.get(`
    SELECT id FROM people
    WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, candidateId);
  if (!manager) return { personId: null, source: null };
  return {
    personId: manager.id,
    source: appointment?.manager_person_id ? 'appointment' : 'legacy_manager',
    appointmentId: appointment?.id || null,
    validOn: validOn || null
  };
}

export function autoAssignImportedPlanItem(
  database,
  workspaceId,
  itemId,
  now = new Date().toISOString()
) {
  const item = database.get(`
    SELECT pi.*, p.origin_kind AS plan_origin_kind
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, itemId);
  if (!item || item.origin_kind !== 'extracted' || item.plan_origin_kind === 'manual') {
    return { assigned: false, reason: 'not_imported' };
  }
  if (!item.responsible_person_id) return { assigned: false, reason: 'responsible_unresolved' };

  const existing = database.get('SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id = ?', itemId);
  if (existing) return { assigned: false, reason: 'already_linked', assignmentId: existing.assignment_id };

  const controller = resolvePlanController(database, workspaceId, item.responsible_person_id, item, now);
  setPlanItemExecution(database, workspaceId, itemId, {
    executionMode: 'assigned',
    responsiblePersonId: item.responsible_person_id,
    executorPersonIds: [item.responsible_person_id],
    controllerPersonId: controller.personId
  }, null, now);

  const linked = database.get('SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id = ?', itemId);
  if (!linked) return { assigned: false, reason: 'link_not_created' };
  const assignment = database.get('SELECT evidence_json FROM assignments WHERE id = ?', linked.assignment_id);
  const evidence = parseJson(assignment?.evidence_json, {});
  database.run('UPDATE assignments SET evidence_json = ?, updated_at = ? WHERE id = ?', JSON.stringify({
    ...evidence,
    automaticAssignment: {
      rule: 'responsible_normalized_exact',
      responsiblePersonId: item.responsible_person_id,
      responsibleRaw: item.responsible_raw || null,
      controllerPersonId: controller.personId,
      controllerSource: controller.source,
      appointmentId: controller.appointmentId || null,
      validOn: controller.validOn || null
    }
  }), now, linked.assignment_id);
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, 'system', 'plan_item.assignment_auto_created', 'plan_item', ?, ?, ?)
  `, newId('audit'), workspaceId, itemId, JSON.stringify({
    assignmentId: linked.assignment_id,
    responsiblePersonId: item.responsible_person_id,
    match: 'normalized_exact',
    controllerPersonId: controller.personId,
    controllerSource: controller.source
  }), now);
  return {
    assigned: true,
    assignmentId: linked.assignment_id,
    responsiblePersonId: item.responsible_person_id,
    controllerPersonId: controller.personId,
    controllerSource: controller.source
  };
}
