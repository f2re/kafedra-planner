import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import { managesPerson } from '../../auth/src/policy.mjs';

const KINDS = new Set(['document', 'directive', 'scientific_item']);
const ROLES = new Set(['reader', 'editor', 'controller', 'owner']);
const SCOPES = new Set(['restricted', 'workspace']);
const RANK = { none: 0, reader: 10, editor: 20, controller: 30, owner: 40, admin: 50 };
const REQUIRED = { read: 10, edit: 20, control: 30, manage: 40 };

function roleAtLeast(role, action) {
  return Number(RANK[role] || 0) >= Number(REQUIRED[action] || REQUIRED.read);
}

function objectRow(database, workspaceId, objectKind, objectId) {
  if (objectKind === 'document') {
    return database.get(`
      SELECT d.id, d.title, d.current_version_id AS source_version_id
      FROM documents d WHERE d.workspace_id = ? AND d.id = ?
    `, workspaceId, objectId);
  }
  if (objectKind === 'directive') {
    return database.get(`
      SELECT d.id, d.title, d.source_document_version_id AS source_version_id,
        dv.document_id AS source_document_id
      FROM directives d
      JOIN document_versions dv ON dv.id = d.source_document_version_id
      WHERE d.workspace_id = ? AND d.id = ?
    `, workspaceId, objectId);
  }
  if (objectKind === 'scientific_item') {
    return database.get(`
      SELECT s.id, s.title, s.source_document_version_id AS source_version_id,
        dv.document_id AS source_document_id
      FROM scientific_items s
      LEFT JOIN document_versions dv ON dv.id = s.source_document_version_id
      WHERE s.workspace_id = ? AND s.id = ?
    `, workspaceId, objectId);
  }
  return null;
}

function relationForAssignmentRole(role, prefix = '') {
  if (role === 'controller') return `${prefix}controller`;
  if (role === 'observer') return `${prefix}observer`;
  return `${prefix}executor`;
}

function peopleForDocument(database, workspaceId, documentId) {
  return database.all(`
    WITH related(person_id, relation, priority) AS (
      SELECT ae.person_id,
        CASE
          WHEN ae.role = 'controller' THEN 'controller'
          WHEN ae.role = 'observer' THEN 'observer'
          ELSE 'assignment_executor'
        END,
        CASE WHEN ae.role = 'controller' THEN 30 WHEN ae.role = 'observer' THEN 10 ELSE 20 END
      FROM document_versions dv
      JOIN assignment_evidence ev ON ev.document_version_id = dv.id
      JOIN assignments a ON a.id = ev.assignment_id AND a.workspace_id = ?
      JOIN assignment_executors ae ON ae.assignment_id = a.id
      WHERE dv.document_id = ? AND ae.person_id IS NOT NULL
      UNION ALL
      SELECT ae.person_id,
        CASE
          WHEN ae.role = 'controller' THEN 'directive_controller'
          WHEN ae.role = 'observer' THEN 'directive_observer'
          ELSE 'directive_executor'
        END,
        CASE WHEN ae.role = 'controller' THEN 30 ELSE 10 END
      FROM document_versions dv
      JOIN directives d ON d.source_document_version_id = dv.id AND d.workspace_id = ?
      JOIN assignments a ON a.directive_id = d.id
      JOIN assignment_executors ae ON ae.assignment_id = a.id
      WHERE dv.document_id = ? AND ae.person_id IS NOT NULL
      UNION ALL
      SELECT sia.person_id, 'scientific_author', 40
      FROM document_versions dv
      JOIN scientific_items si ON si.source_document_version_id = dv.id AND si.workspace_id = ?
      JOIN scientific_item_authors sia ON sia.scientific_item_id = si.id
      WHERE dv.document_id = ? AND sia.person_id IS NOT NULL
      UNION ALL
      SELECT sia.person_id, 'scientific_evidence_author', 40
      FROM document_versions dv
      JOIN scientific_item_evidence sie ON sie.document_version_id = dv.id
      JOIN scientific_items si ON si.id = sie.scientific_item_id AND si.workspace_id = ?
      JOIN scientific_item_authors sia ON sia.scientific_item_id = si.id
      WHERE dv.document_id = ? AND sia.person_id IS NOT NULL
    )
    SELECT person_id, relation, MAX(priority) AS priority
    FROM related GROUP BY person_id, relation
    ORDER BY priority DESC, person_id
  `, workspaceId, documentId, workspaceId, documentId,
    workspaceId, documentId, workspaceId, documentId);
}

function peopleForDirective(database, workspaceId, directiveId) {
  return database.all(`
    SELECT ae.person_id, ae.role
    FROM assignments a
    JOIN assignment_executors ae ON ae.assignment_id = a.id
    WHERE a.workspace_id = ? AND a.directive_id = ? AND ae.person_id IS NOT NULL
    GROUP BY ae.person_id, ae.role
    ORDER BY ae.person_id
  `, workspaceId, directiveId).map((row) => ({
    person_id: row.person_id,
    relation: relationForAssignmentRole(row.role),
    priority: row.role === 'controller' ? 30 : row.role === 'observer' ? 10 : 20
  })).sort((a, b) => b.priority - a.priority || a.person_id.localeCompare(b.person_id));
}

function peopleForScience(database, workspaceId, itemId) {
  return database.all(`
    SELECT sia.person_id, 'author' AS relation, 40 AS priority
    FROM scientific_items si
    JOIN scientific_item_authors sia ON sia.scientific_item_id = si.id
    WHERE si.workspace_id = ? AND si.id = ? AND sia.person_id IS NOT NULL
    ORDER BY sia.author_order
  `, workspaceId, itemId);
}

function relatedPeople(database, workspaceId, objectKind, objectId) {
  if (objectKind === 'document') return peopleForDocument(database, workspaceId, objectId);
  if (objectKind === 'directive') return peopleForDirective(database, workspaceId, objectId);
  if (objectKind === 'scientific_item') return peopleForScience(database, workspaceId, objectId);
  return [];
}

function roleForRelatedPerson(relation) {
  if (relation.includes('author')) return 'owner';
  if (relation.includes('controller')) return 'controller';
  if (relation.includes('observer')) return 'reader';
  if (relation === 'assignment_executor') return 'editor';
  return 'reader';
}

export function ensureObjectPolicy(database, {
  workspaceId,
  objectKind,
  objectId,
  ownerPersonId = null,
  accessScope = 'restricted',
  now = new Date().toISOString()
}) {
  if (!KINDS.has(objectKind)) throw new Error('acl_object_kind_invalid');
  if (!SCOPES.has(accessScope)) throw new Error('acl_scope_invalid');
  database.run(`
    INSERT INTO object_access_policies(
      workspace_id, object_kind, object_id, owner_person_id, access_scope,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, object_kind, object_id) DO UPDATE SET
      owner_person_id = COALESCE(object_access_policies.owner_person_id, excluded.owner_person_id),
      updated_at = excluded.updated_at
  `, workspaceId, objectKind, objectId, ownerPersonId, accessScope, now, now);
  return getObjectPolicy(database, workspaceId, objectKind, objectId);
}

export function getObjectPolicy(database, workspaceId, objectKind, objectId) {
  return database.get(`
    SELECT p.*, owner.display_name AS owner_name
    FROM object_access_policies p
    LEFT JOIN people owner ON owner.id = p.owner_person_id
    WHERE p.workspace_id = ? AND p.object_kind = ? AND p.object_id = ?
  `, workspaceId, objectKind, objectId) || null;
}

function explicitGrant(database, workspaceId, objectKind, objectId, personId) {
  if (!personId) return null;
  return database.get(`
    SELECT e.*, p.display_name
    FROM object_acl_entries e
    LEFT JOIN people p ON p.id = e.person_id
    WHERE e.workspace_id = ? AND e.object_kind = ? AND e.object_id = ? AND e.person_id = ?
  `, workspaceId, objectKind, objectId, personId) || null;
}

function bestDynamicRole(database, workspaceId, context, objectKind, objectId, policy) {
  if (!context?.authenticated) return { role: 'none', reason: 'not_authenticated' };
  if (!context.enabled || context.role === 'admin') return { role: 'admin', reason: 'administrator' };
  if (policy?.owner_person_id === context.personId) return { role: 'owner', reason: 'policy_owner' };
  const grant = explicitGrant(database, workspaceId, objectKind, objectId, context.personId);
  if (grant) return { role: grant.access_role, reason: 'explicit_grant', grantId: grant.id };
  if (policy?.access_scope === 'workspace') return { role: 'reader', reason: 'workspace_scope' };

  let best = { role: 'none', reason: 'no_grant' };
  for (const related of relatedPeople(database, workspaceId, objectKind, objectId)) {
    if (related.person_id === context.personId) {
      const role = roleForRelatedPerson(related.relation);
      if (RANK[role] > RANK[best.role]) best = { role, reason: related.relation };
      continue;
    }
    if (
      context.role === 'manager'
      && managesPerson(database, workspaceId, context.personId, related.person_id)
      && RANK.controller > RANK[best.role]
    ) {
      best = { role: 'controller', reason: `manager_of:${related.person_id}` };
    }
  }
  if (
    context.role === 'manager'
    && policy?.owner_person_id
    && managesPerson(database, workspaceId, context.personId, policy.owner_person_id)
    && RANK.controller > RANK[best.role]
  ) {
    best = { role: 'controller', reason: `manager_of_owner:${policy.owner_person_id}` };
  }
  if (objectKind === 'scientific_item') {
    const item = objectRow(database, workspaceId, objectKind, objectId);
    if (item?.source_document_id) {
      const inherited = resolveObjectAccess(
        database, workspaceId, context, 'document', item.source_document_id, 'read', { skipExistence: false }
      );
      if (inherited.allowed && RANK.reader > RANK[best.role]) {
        best = { role: 'reader', reason: 'source_document' };
      }
    }
  }
  return best;
}

export function resolveObjectAccess(
  database,
  workspaceId,
  context,
  objectKind,
  objectId,
  action = 'read',
  { skipExistence = false } = {}
) {
  if (!KINDS.has(objectKind)) return { allowed: false, role: 'none', reason: 'unsupported_kind' };
  const object = skipExistence ? { id: objectId } : objectRow(database, workspaceId, objectKind, objectId);
  if (!object) return { allowed: false, role: 'none', reason: 'not_found', notFound: true };
  const policy = getObjectPolicy(database, workspaceId, objectKind, objectId);
  const effective = bestDynamicRole(database, workspaceId, context, objectKind, objectId, policy);
  return {
    allowed: roleAtLeast(effective.role, action),
    role: effective.role,
    reason: effective.reason,
    action,
    policy,
    object
  };
}

export function assertObjectAccess(database, workspaceId, context, objectKind, objectId, action = 'read') {
  const access = resolveObjectAccess(database, workspaceId, context, objectKind, objectId, action);
  if (access.notFound) throw new AppError('object_not_found', 'Объект не найден.', 404);
  if (!access.allowed) {
    throw new AppError('object_access_forbidden', 'Нет доступа к этому объекту.', 403);
  }
  return access;
}

export function documentIdForVersion(database, workspaceId, versionId) {
  return database.get(`
    SELECT d.id FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, versionId)?.id || null;
}

export function documentIdForExtraction(database, workspaceId, extractionId) {
  return database.get(`
    SELECT d.id FROM template_extractions te
    JOIN document_versions dv ON dv.id = te.document_version_id
    JOIN documents d ON d.id = dv.document_id
    WHERE te.workspace_id = ? AND te.id = ?
  `, workspaceId, extractionId)?.id || null;
}

export function assignmentAccess(database, workspaceId, context, assignmentId, action = 'read') {
  const assignment = database.get(
    'SELECT id FROM assignments WHERE workspace_id = ? AND id = ?', workspaceId, assignmentId
  );
  if (!assignment) return { allowed: false, notFound: true, role: 'none' };
  if (!context?.authenticated) return { allowed: false, role: 'none' };
  if (!context.enabled || context.role === 'admin') return { allowed: true, role: 'admin' };
  const people = database.all(`
    SELECT person_id, role FROM assignment_executors
    WHERE assignment_id = ? AND person_id IS NOT NULL
  `, assignmentId);
  const ownRoles = people.filter((row) => row.person_id === context.personId).map((row) => row.role);
  let role = 'none';
  if (ownRoles.some((item) => item === 'observer')) role = 'reader';
  if (ownRoles.some((item) => ['executor', 'coexecutor'].includes(item))) role = 'editor';
  if (ownRoles.some((item) => item === 'controller')) role = 'controller';
  if (context.role === 'manager' && people.some((row) =>
    managesPerson(database, workspaceId, context.personId, row.person_id)
  )) role = 'controller';
  return { allowed: roleAtLeast(role, action), role };
}

export function assertAssignmentAccess(database, workspaceId, context, assignmentId, action = 'read') {
  const access = assignmentAccess(database, workspaceId, context, assignmentId, action);
  if (access.notFound) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
  if (!access.allowed) throw new AppError('assignment_scope_forbidden', 'Нет доступа к этому поручению.', 403);
  return access;
}

export function canReadSearchResult(database, workspaceId, context, result) {
  const kind = String(result.source_kind || result.sourceKind || '');
  const sourceId = String(result.source_id || result.sourceId || '');
  if (kind === 'document') return resolveObjectAccess(database, workspaceId, context, 'document', sourceId).allowed;
  if (kind === 'directive') return resolveObjectAccess(database, workspaceId, context, 'directive', sourceId).allowed;
  if (kind === 'scientific_item') return resolveObjectAccess(database, workspaceId, context, 'scientific_item', sourceId).allowed;
  if (kind === 'assignment') return assignmentAccess(database, workspaceId, context, sourceId).allowed;
  if (kind === 'document_version') {
    const documentId = documentIdForVersion(database, workspaceId, sourceId);
    return Boolean(documentId && resolveObjectAccess(database, workspaceId, context, 'document', documentId).allowed);
  }
  if (kind === 'template_extraction') {
    const documentId = documentIdForExtraction(database, workspaceId, sourceId);
    return Boolean(documentId && resolveObjectAccess(database, workspaceId, context, 'document', documentId).allowed);
  }
  if (kind === 'meeting') {
    const documentId = database.get(`
      SELECT dv.document_id FROM meetings m
      JOIN document_versions dv ON dv.id = m.source_document_version_id
      WHERE m.workspace_id = ? AND m.id = ?
    `, workspaceId, sourceId)?.document_id;
    return Boolean(documentId && resolveObjectAccess(database, workspaceId, context, 'document', documentId).allowed);
  }
  if (result.document_version_id || result.documentVersionId) {
    const documentId = documentIdForVersion(
      database, workspaceId, result.document_version_id || result.documentVersionId
    );
    return Boolean(documentId && resolveObjectAccess(database, workspaceId, context, 'document', documentId).allowed);
  }
  return !context?.enabled || context?.role === 'admin';
}

export function canReadCalendarItem(database, workspaceId, context, item) {
  const sourceKind = String(item.source_kind || item.sourceKind || '');
  const sourceId = String(item.source_id || item.sourceId || '');
  if (sourceKind === 'assignment') return assignmentAccess(database, workspaceId, context, sourceId).allowed;
  if (sourceKind === 'directive') return resolveObjectAccess(database, workspaceId, context, 'directive', sourceId).allowed;
  if (sourceKind === 'periodic_task') {
    const task = database.get(`
      SELECT owner_person_id, manager_person_id FROM periodic_tasks
      WHERE workspace_id = ? AND id = ?
    `, workspaceId, sourceId);
    if (!task) return false;
    if (!context?.enabled || context.role === 'admin') return true;
    if ([task.owner_person_id, task.manager_person_id].includes(context.personId)) return true;
    return context.role === 'manager'
      && task.owner_person_id
      && managesPerson(database, workspaceId, context.personId, task.owner_person_id);
  }
  return true;
}

export function setObjectAccess(database, workspaceId, objectKind, objectId, body, actorPersonId = null, now = new Date().toISOString()) {
  if (!KINDS.has(objectKind)) throw new AppError('acl_object_kind_invalid', 'Этот тип объекта не поддерживает ACL.', 400);
  if (!objectRow(database, workspaceId, objectKind, objectId)) throw new AppError('object_not_found', 'Объект не найден.', 404);
  const accessScope = body.accessScope || 'restricted';
  if (!SCOPES.has(accessScope)) throw new AppError('acl_scope_invalid', 'Допустимы restricted и workspace.', 400);
  const ownerPersonId = body.ownerPersonId || null;
  if (ownerPersonId) {
    const owner = database.get('SELECT id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, ownerPersonId);
    if (!owner) throw new AppError('acl_owner_invalid', 'Владелец не найден в рабочем пространстве.', 400);
  }
  const grants = Array.isArray(body.grants) ? body.grants : [];
  for (const grant of grants) {
    if (!grant.personId || !ROLES.has(grant.role)) {
      throw new AppError('acl_grant_invalid', 'Для каждого доступа укажите сотрудника и роль.', 400);
    }
    const person = database.get('SELECT id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, grant.personId);
    if (!person) throw new AppError('acl_person_invalid', 'Сотрудник ACL не найден.', 400);
  }
  database.transaction(() => {
    database.run(`
      INSERT INTO object_access_policies(
        workspace_id, object_kind, object_id, owner_person_id, access_scope, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, object_kind, object_id) DO UPDATE SET
        owner_person_id = excluded.owner_person_id,
        access_scope = excluded.access_scope,
        updated_at = excluded.updated_at
    `, workspaceId, objectKind, objectId, ownerPersonId, accessScope, now, now);
    database.run(`
      DELETE FROM object_acl_entries WHERE workspace_id = ? AND object_kind = ? AND object_id = ?
    `, workspaceId, objectKind, objectId);
    for (const grant of grants) {
      database.run(`
        INSERT INTO object_acl_entries(
          id, workspace_id, object_kind, object_id, person_id, access_role,
          created_by_person_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, newId('acl'), workspaceId, objectKind, objectId, grant.personId,
      grant.role, actorPersonId, now, now);
    }
  });
  return explainObjectAccess(database, workspaceId, objectKind, objectId);
}

export function explainObjectAccess(database, workspaceId, objectKind, objectId) {
  const object = objectRow(database, workspaceId, objectKind, objectId);
  if (!object) throw new AppError('object_not_found', 'Объект не найден.', 404);
  const policy = getObjectPolicy(database, workspaceId, objectKind, objectId) || {
    workspace_id: workspaceId,
    object_kind: objectKind,
    object_id: objectId,
    owner_person_id: null,
    owner_name: null,
    access_scope: 'restricted'
  };
  const grants = database.all(`
    SELECT e.*, p.display_name
    FROM object_acl_entries e
    JOIN people p ON p.id = e.person_id
    WHERE e.workspace_id = ? AND e.object_kind = ? AND e.object_id = ?
    ORDER BY p.display_name
  `, workspaceId, objectKind, objectId);
  const inferred = relatedPeople(database, workspaceId, objectKind, objectId).map((row) => ({
    personId: row.person_id,
    relation: row.relation,
    role: roleForRelatedPerson(row.relation)
  }));
  return { objectKind, objectId, object, policy, grants, inferred };
}

export function accessAuditDetails(explanation) {
  return {
    objectKind: explanation.objectKind,
    objectId: explanation.objectId,
    accessScope: explanation.policy?.access_scope || 'restricted',
    ownerPersonId: explanation.policy?.owner_person_id || null,
    grants: explanation.grants.map((grant) => ({ personId: grant.person_id, role: grant.access_role }))
  };
}
