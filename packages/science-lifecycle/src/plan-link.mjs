import { newId } from '../../core/src/ids.mjs';
import { createManualPlanItem } from '../../plans/src/manual.mjs';
import { getScienceLifecycleItem } from './service.mjs';

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value, max = 4000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function date(value, field) {
  const raw = String(value || '').slice(0, 10);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('science_lifecycle_date_invalid', { field });
  }
  return raw;
}

function audit(database, workspaceId, actorPersonId, action, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, 'scientific_item', ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action, subjectId, JSON.stringify(details), now);
}

export function linkSciencePlan(database, workspaceId, scientificItemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const science = getScienceLifecycleItem(database, workspaceId, scientificItemId);
  if (!science) fail('scientific_item_not_found');
  if (science.plan_link) {
    if (input.planItemId && science.plan_link.plan_item_id === input.planItemId) return science;
    fail('science_plan_link_exists', { planItemId: science.plan_link.plan_item_id });
  }
  return database.transaction(() => {
    let planItemId = input.planItemId || null;
    let assignmentId = null;
    if (!planItemId) {
      if (!input.planId) fail('science_plan_required');
      const explicitExpectedResult = text(input.expectedResult, 4000);
      const created = createManualPlanItem(database, workspaceId, input.planId, {
        title: text(input.title, 1000) || science.next_action || `Подготовить: ${science.title}`,
        description: text(input.description, 12000) || `Научный материал: ${science.title}`,
        startsAt: date(input.startsAt, 'startsAt'),
        dueDate: date(input.dueDate || science.next_action_due, 'dueDate'),
        direction: 'science',
        expectedResult: explicitExpectedResult || (science.lifecycle_status === 'published' ? 'Публикация' : 'Научный материал'),
        executionMode: input.executionMode || 'track',
        responsiblePersonId: input.responsiblePersonId || null,
        executorPersonIds: input.executorPersonIds || [],
        controllerPersonId: input.controllerPersonId || null
      }, actorPersonId, now);
      planItemId = created.id;
      assignmentId = created.assignment?.id || null;
    } else {
      const item = database.get(`
        SELECT pi.id FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
        WHERE p.workspace_id = ? AND pi.id = ?
      `, workspaceId, planItemId);
      if (!item) fail('science_plan_item_not_found');
      assignmentId = database.get('SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id = ?', planItemId)?.assignment_id || null;
    }
    database.run(`
      INSERT INTO scientific_item_plan_links(
        scientific_item_id, workspace_id, plan_item_id, assignment_id,
        created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, scientificItemId, workspaceId, planItemId, assignmentId, actorPersonId, now, now);
    audit(database, workspaceId, actorPersonId, 'science.plan_linked', scientificItemId, { planItemId, assignmentId }, now);
    return getScienceLifecycleItem(database, workspaceId, scientificItemId);
  });
}
