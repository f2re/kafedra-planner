import { AppError } from '../../core/src/errors.mjs';
import { managesPerson } from '../../auth/src/policy.mjs';
import { resolveObjectAccess } from '../../access-control/src/service.mjs';

const RANK = { none: 0, reader: 10, editor: 20, controller: 30, owner: 40, admin: 50 };
const REQUIRED = { read: 10, edit: 20, control: 30, manage: 40 };

function enough(role, action) {
  return Number(RANK[role] || 0) >= Number(REQUIRED[action] || REQUIRED.read);
}

function stronger(left, right) {
  return RANK[right.role] > RANK[left.role] ? right : left;
}

function planBase(database, workspaceId, planId) {
  return database.get(`
    SELECT p.id, p.origin_kind, p.owner_person_id, p.source_document_version_id,
      dv.document_id AS source_document_id
    FROM plans p
    LEFT JOIN document_versions dv ON dv.id = p.source_document_version_id
    WHERE p.workspace_id = ? AND p.id = ?
  `, workspaceId, planId) || null;
}

function policyFor(database, workspaceId, planId) {
  return database.get(`
    SELECT * FROM object_access_policies
    WHERE workspace_id = ? AND object_kind = 'plan' AND object_id = ?
  `, workspaceId, planId) || null;
}

function grantFor(database, workspaceId, planId, personId) {
  if (!personId) return null;
  return database.get(`
    SELECT * FROM object_acl_entries
    WHERE workspace_id = ? AND object_kind = 'plan' AND object_id = ? AND person_id = ?
  `, workspaceId, planId, personId) || null;
}

function participantCanReadPlan(database, workspaceId, planId, context) {
  if (!context?.personId) return null;
  const direct = database.get(`
    SELECT 1 AS present
    FROM plan_items pi
    JOIN plan_item_assignments pia ON pia.plan_item_id = pi.id
    JOIN assignments a ON a.id = pia.assignment_id AND a.workspace_id = ?
    JOIN assignment_executors ae ON ae.assignment_id = a.id
    WHERE pi.plan_id = ? AND ae.person_id = ?
    LIMIT 1
  `, workspaceId, planId, context.personId);
  if (direct) return { role: 'reader', reason: 'assignment_participant' };
  if (context.role !== 'manager') return null;
  const managed = database.get(`
    SELECT 1 AS present
    FROM plan_items pi
    JOIN plan_item_assignments pia ON pia.plan_item_id = pi.id
    JOIN assignments a ON a.id = pia.assignment_id AND a.workspace_id = ?
    JOIN assignment_executors ae ON ae.assignment_id = a.id
    JOIN people p ON p.id = ae.person_id
    WHERE pi.plan_id = ? AND p.manager_id = ?
    LIMIT 1
  `, workspaceId, planId, context.personId);
  return managed ? { role: 'reader', reason: 'manager_of_assignment_participant' } : null;
}

function itemParticipantRole(database, workspaceId, planItemId, context) {
  if (!context?.personId) return { role: 'none', reason: 'no_relation' };
  const rows = database.all(`
    SELECT ae.person_id, ae.role, p.manager_id
    FROM plan_item_assignments pia
    JOIN assignments a ON a.id = pia.assignment_id AND a.workspace_id = ?
    JOIN assignment_executors ae ON ae.assignment_id = a.id
    LEFT JOIN people p ON p.id = ae.person_id
    WHERE pia.plan_item_id = ? AND ae.person_id IS NOT NULL
  `, workspaceId, planItemId);
  let effective = { role: 'none', reason: 'no_relation' };
  for (const row of rows) {
    if (row.person_id === context.personId) {
      const role = row.role === 'controller' ? 'controller'
        : row.role === 'observer' ? 'reader' : 'editor';
      effective = stronger(effective, { role, reason: `assignment_${row.role}` });
      continue;
    }
    if (context.role === 'manager' && row.manager_id === context.personId) {
      effective = stronger(effective, { role: 'controller', reason: `manager_of:${row.person_id}` });
    }
  }
  return effective;
}

export function resolvePlanAccess(database, workspaceId, context, planId, action = 'read') {
  const plan = planBase(database, workspaceId, planId);
  if (!plan) return { allowed: false, role: 'none', reason: 'not_found', notFound: true };
  if (plan.source_document_id) {
    const inherited = resolveObjectAccess(database, workspaceId, context, 'document', plan.source_document_id, action);
    return { ...inherited, plan, inheritedFrom: 'document' };
  }
  if (!context?.authenticated) return { allowed: false, role: 'none', reason: 'not_authenticated', plan };
  if (!context.enabled || context.role === 'admin') {
    return { allowed: true, role: 'admin', reason: 'administrator', plan, inheritedFrom: 'plan' };
  }
  const policy = policyFor(database, workspaceId, planId);
  let effective = { role: 'none', reason: 'no_grant' };
  if (policy?.owner_person_id === context.personId) effective = { role: 'owner', reason: 'policy_owner' };
  const grant = grantFor(database, workspaceId, planId, context.personId);
  if (grant) effective = stronger(effective, { role: grant.access_role, reason: 'explicit_grant' });
  if (policy?.access_scope === 'workspace') effective = stronger(effective, { role: 'reader', reason: 'workspace_scope' });
  if (
    context.role === 'manager' && policy?.owner_person_id
    && managesPerson(database, workspaceId, context.personId, policy.owner_person_id)
  ) {
    effective = stronger(effective, { role: 'controller', reason: `manager_of_owner:${policy.owner_person_id}` });
  }
  const participant = participantCanReadPlan(database, workspaceId, planId, context);
  if (participant) effective = stronger(effective, participant);
  return {
    allowed: enough(effective.role, action), role: effective.role, reason: effective.reason,
    action, policy, plan, inheritedFrom: 'plan'
  };
}

export function assertPlanAccess(database, workspaceId, context, planId, action = 'read') {
  const access = resolvePlanAccess(database, workspaceId, context, planId, action);
  if (access.notFound) throw new AppError('plan_not_found', 'План не найден.', 404);
  if (!access.allowed) throw new AppError('plan_access_forbidden', 'Нет доступа к этому плану.', 403);
  return access;
}

export function planIdForItem(database, workspaceId, planItemId) {
  return database.get(`
    SELECT p.id FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, planItemId)?.id || null;
}

export function resolvePlanItemAccess(database, workspaceId, context, planItemId, action = 'read') {
  const planId = planIdForItem(database, workspaceId, planItemId);
  if (!planId) return { allowed: false, role: 'none', reason: 'not_found', notFound: true };
  const planAccess = resolvePlanAccess(database, workspaceId, context, planId, action);
  if (planAccess.allowed) return { ...planAccess, planId, itemScoped: false };
  if (planAccess.plan?.source_document_id) return { ...planAccess, planId, itemScoped: false };
  const participant = itemParticipantRole(database, workspaceId, planItemId, context);
  return {
    ...planAccess, allowed: enough(participant.role, action), role: participant.role,
    reason: participant.reason, action, planId, itemScoped: true
  };
}

export function assertPlanItemAccess(database, workspaceId, context, planItemId, action = 'read') {
  const access = resolvePlanItemAccess(database, workspaceId, context, planItemId, action);
  if (access.notFound) throw new AppError('plan_item_not_found', 'Пункт плана не найден.', 404);
  if (!access.allowed) throw new AppError('plan_access_forbidden', 'Нет доступа к этому пункту плана.', 403);
  return access;
}

export function createManualPlanPolicy(database, workspaceId, planId, ownerPersonId, accessScope = 'restricted', now = new Date().toISOString()) {
  const scope = accessScope === 'workspace' ? 'workspace' : 'restricted';
  database.run(`
    INSERT INTO object_access_policies(
      workspace_id, object_kind, object_id, owner_person_id, access_scope, created_at, updated_at
    ) VALUES (?, 'plan', ?, ?, ?, ?, ?)
  `, workspaceId, planId, ownerPersonId || null, scope, now, now);
  if (ownerPersonId) {
    database.run(`
      INSERT INTO object_acl_entries(
        id, workspace_id, object_kind, object_id, person_id, access_role,
        created_by_person_id, created_at, updated_at
      ) VALUES ('plan-owner-' || ?, ?, 'plan', ?, ?, 'owner', ?, ?, ?)
      ON CONFLICT(workspace_id, object_kind, object_id, person_id) DO UPDATE SET
        access_role = 'owner', updated_at = excluded.updated_at
    `, planId, workspaceId, planId, ownerPersonId, ownerPersonId, now, now);
  }
}
