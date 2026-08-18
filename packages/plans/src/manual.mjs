import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { ensureAssignmentPlanMetrics } from '../../plan-fact/src/service.mjs';
import { getPlan } from './queries.mjs';
import { addFacet, insertCalendarItem } from './persist-helpers.mjs';
import { planKindLabel, planLabel } from './shared.mjs';
import { createManualPlanPolicy } from './access.mjs';

const PLAN_KINDS = new Set(['department', 'faculty', 'unit', 'personal', 'organization']);
const DIRECTIONS = new Set(['organizational', 'education', 'science', 'everyday']);
const MODES = new Set(['track', 'assigned', 'open']);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value, max = 1000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function isoDate(value, field) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(20\d{2})-(\d{2})-(\d{2})$/u);
  if (!match) fail('manual_plan_date_invalid', { field });
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    fail('manual_plan_date_invalid', { field });
  }
  return raw;
}

function normalizePeriod(input = {}) {
  const periodKind = input.periodKind === 'academic' ? 'academic' : input.periodKind === 'calendar' ? 'calendar' : null;
  if (!periodKind) fail('manual_plan_period_kind_invalid');
  if (periodKind === 'calendar') {
    const year = Number(input.yearStart || input.periodKey || input.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2099) fail('manual_plan_period_invalid');
    return { periodKind, periodKey: String(year), yearStart: year, yearEnd: year };
  }
  const explicitStart = Number(input.yearStart);
  const explicitEnd = Number(input.yearEnd);
  let yearStart = explicitStart;
  let yearEnd = explicitEnd;
  const match = String(input.periodKey || '').match(/^\s*(20\d{2})\s*[/–—-]\s*(20\d{2}|\d{2})\s*$/u);
  if (!yearStart && match) yearStart = Number(match[1]);
  if (!yearEnd && match) yearEnd = match[2].length === 2
    ? Math.floor(yearStart / 100) * 100 + Number(match[2]) : Number(match[2]);
  if (!Number.isInteger(yearStart) || !Number.isInteger(yearEnd) || yearEnd < yearStart || yearEnd > yearStart + 2) {
    fail('manual_plan_period_invalid');
  }
  return { periodKind, periodKey: `${yearStart}/${String(yearEnd).slice(-2)}`, yearStart, yearEnd };
}

function person(database, workspaceId, personId) {
  if (!personId) return null;
  return database.get(`
    SELECT id, display_name, manager_id FROM people
    WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, personId) || null;
}

function requirePerson(database, workspaceId, personId, field) {
  const row = person(database, workspaceId, personId);
  if (!row) fail('manual_plan_person_not_found', { field, personId });
  return row;
}

function audit(database, workspaceId, actorPersonId, action, subjectKind, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action, subjectKind, subjectId,
  JSON.stringify(details || {}), now);
}

function clearSearch(database, sourceKind, sourceId) {
  const ids = database.all(
    'SELECT id FROM search_fragments WHERE source_kind = ? AND source_id = ?', sourceKind, sourceId
  ).map((row) => row.id);
  for (const id of ids) database.run('DELETE FROM search_fts WHERE fragment_id = ?', id);
  database.run('DELETE FROM search_fragments WHERE source_kind = ? AND source_id = ?', sourceKind, sourceId);
}

function indexPlan(database, workspaceId, plan, items, now) {
  clearSearch(database, 'plan', plan.id);
  addSearchFragment(database, {
    workspaceId, sourceKind: 'plan', sourceId: plan.id, documentVersionId: null,
    title: planLabel(plan),
    content: [plan.title, plan.period_key, plan.owner_raw, ...items.map((item) => item.title)].filter(Boolean).join('\n'),
    locator: { kind: 'manual_plan', planId: plan.id, provenance: 'manual' }
  });
  database.run("DELETE FROM entity_facets WHERE source_kind = 'plan' AND source_id = ?", plan.id);
  addFacet(database, workspaceId, 'plan', plan.id, 'kind', plan.plan_kind, now);
  addFacet(database, workspaceId, 'plan', plan.id, 'period', plan.period_key, now);
  addFacet(database, workspaceId, 'plan', plan.id, 'owner', plan.owner_raw, now);
  addFacet(database, workspaceId, 'plan', plan.id, 'status', plan.status, now);
}

function indexItem(database, workspaceId, plan, item, now) {
  clearSearch(database, 'plan_item', item.id);
  addSearchFragment(database, {
    workspaceId, sourceKind: 'plan_item', sourceId: item.id, documentVersionId: null,
    title: item.title,
    content: [item.description, item.responsible_raw, item.expected_result, plan.period_key,
      planKindLabel(plan.plan_kind)].filter(Boolean).join('\n'),
    locator: { kind: 'manual_plan_item', planId: plan.id, planItemId: item.id, provenance: 'manual' }
  });
  database.run("DELETE FROM entity_facets WHERE source_kind = 'plan_item' AND source_id = ?", item.id);
  addFacet(database, workspaceId, 'plan_item', item.id, 'plan_kind', plan.plan_kind, now);
  addFacet(database, workspaceId, 'plan_item', item.id, 'period', plan.period_key, now);
  addFacet(database, workspaceId, 'plan_item', item.id, 'direction', item.direction, now);
  addFacet(database, workspaceId, 'plan_item', item.id, 'responsible', item.responsible_raw, now);
  addFacet(database, workspaceId, 'plan_item', item.id, 'date', item.due_date || item.starts_at, now);
}

function syncCalendar(database, workspaceId, plan, item, now) {
  database.run("DELETE FROM calendar_items WHERE source_kind = 'plan_item' AND source_id = ?", item.id);
  const projected = {
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    dueDate: item.due_date,
    responsibleRaw: item.responsible_raw,
    expectedResult: item.expected_result,
    description: item.description,
    direction: item.direction,
    evidence: { locator: { kind: 'manual_plan_item', planId: plan.id, planItemId: item.id, provenance: 'manual' } }
  };
  if (item.starts_at) {
    insertCalendarItem(database, {
      workspaceId, plan, planItemId: item.id, item: projected, documentId: null,
      startsAt: item.starts_at, endsAt: item.ends_at || null, title: item.title,
      kind: 'event', status: 'confirmed', reminderMinutes: null, now
    });
  }
  if (item.due_date) {
    insertCalendarItem(database, {
      workspaceId, plan, planItemId: item.id, item: projected, documentId: null,
      startsAt: item.due_date, title: item.starts_at ? `Срок: ${item.title}` : item.title,
      kind: 'task', status: item.status === 'completed' ? 'completed' : 'open', reminderMinutes: 10080, now
    });
  }
}

function savedItem(database, workspaceId, itemId) {
  const plan = database.get(`
    SELECT p.* FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, itemId);
  return plan ? getPlan(database, workspaceId, plan.id)?.items.find((item) => item.id === itemId) || null : null;
}

export function createManualPlan(database, workspaceId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const planKind = PLAN_KINDS.has(input.planKind) ? input.planKind : null;
  if (!planKind) fail('manual_plan_kind_invalid');
  const period = normalizePeriod(input);
  const actor = actorPersonId ? requirePerson(database, workspaceId, actorPersonId, 'actorPersonId') : null;
  let owner = input.ownerPersonId ? requirePerson(database, workspaceId, input.ownerPersonId, 'ownerPersonId') : null;
  if (planKind === 'personal' && !owner) owner = actor;
  const id = newId('plan');
  const title = text(input.title, 500) || `${planKindLabel(planKind)} · ${period.periodKey}`;
  const ownerRaw = owner?.display_name || text(input.ownerRaw, 500);
  const accessScope = input.accessScope === 'workspace' || (input.accessScope !== 'restricted' && planKind !== 'personal')
    ? 'workspace' : 'restricted';
  database.transaction(() => {
    database.run(`
      INSERT INTO plans(
        id, workspace_id, source_document_version_id, origin_kind, plan_kind, period_kind,
        period_key, year_start, year_end, owner_person_id, owner_raw, title, status,
        confidence, evidence_json, created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, NULL, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)
    `, id, workspaceId, planKind, period.periodKind, period.periodKey, period.yearStart, period.yearEnd,
    owner?.id || null, ownerRaw, title,
    JSON.stringify({ source: 'manual', provenance: 'operator', enteredByPersonId: actorPersonId, enteredAt: now }),
    actorPersonId, now, now);
    createManualPlanPolicy(database, workspaceId, id, actorPersonId || owner?.id || null, accessScope, now);
    const row = database.get('SELECT * FROM plans WHERE id = ?', id);
    indexPlan(database, workspaceId, row, [], now);
    audit(database, workspaceId, actorPersonId, 'plan.manual_created', 'plan', id, {
      planKind, ...period, ownerPersonId: owner?.id || null, accessScope
    }, now);
  });
  return getPlan(database, workspaceId, id);
}

function normalizeItem(database, workspaceId, input, current = {}) {
  const title = text(input.title ?? current.title, 1000);
  if (!title) fail('manual_plan_item_title_required');
  const startsAt = isoDate(input.startsAt ?? input.starts_at ?? current.starts_at, 'startsAt');
  const endsAt = isoDate(input.endsAt ?? input.ends_at ?? current.ends_at, 'endsAt');
  const dueDate = isoDate(input.dueDate ?? input.due_date ?? current.due_date, 'dueDate');
  if (endsAt && !startsAt) fail('manual_plan_item_start_required');
  if (startsAt && endsAt && endsAt < startsAt) fail('manual_plan_item_range_invalid');
  const direction = input.direction ?? current.direction ?? 'organizational';
  if (!DIRECTIONS.has(direction)) fail('manual_plan_direction_invalid');
  const executionMode = input.executionMode ?? input.execution_mode ?? current.execution_mode ?? 'track';
  if (!MODES.has(executionMode)) fail('manual_plan_execution_mode_invalid');
  const responsiblePersonId = input.responsiblePersonId !== undefined
    ? (input.responsiblePersonId || null) : (current.responsible_person_id || null);
  const responsible = responsiblePersonId ? requirePerson(database, workspaceId, responsiblePersonId, 'responsiblePersonId') : null;
  return {
    title,
    description: text(input.description ?? current.description, 12000),
    startsAt, endsAt, dueDate, direction, executionMode,
    expectedResult: text(input.expectedResult ?? input.expected_result ?? current.expected_result, 4000),
    responsiblePersonId: responsible?.id || null,
    responsibleRaw: responsible?.display_name || text(input.responsibleRaw ?? current.responsible_raw, 500),
    itemNo: text(input.itemNo ?? input.item_no ?? current.item_no, 100)
  };
}

export function createManualPlanItem(database, workspaceId, planId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const plan = database.get('SELECT * FROM plans WHERE workspace_id = ? AND id = ?', workspaceId, planId);
  if (!plan) fail('manual_plan_not_found');
  if (plan.origin_kind !== 'manual') fail('manual_plan_item_requires_manual_plan');
  const normalized = normalizeItem(database, workspaceId, input);
  const id = newId('planitem');
  const itemNo = normalized.itemNo || String(Number(database.get(
    'SELECT COUNT(*) AS n FROM plan_items WHERE plan_id = ?', planId
  )?.n || 0) + 1);
  database.transaction(() => {
    database.run(`
      INSERT INTO plan_items(
        id, plan_id, source_item_key, origin_kind, execution_mode, item_no, title, description,
        starts_at, ends_at, due_date, responsible_raw, responsible_person_id, direction,
        expected_result, status, confidence, evidence_json, created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?)
    `, id, planId, `manual:${id}`, normalized.executionMode, itemNo, normalized.title, normalized.description,
    normalized.startsAt, normalized.endsAt, normalized.dueDate, normalized.responsibleRaw,
    normalized.responsiblePersonId, normalized.direction, normalized.expectedResult,
    JSON.stringify({ source: 'manual', provenance: 'operator', locator: { kind: 'manual_plan_item', planId, planItemId: id }, enteredByPersonId: actorPersonId, enteredAt: now }),
    actorPersonId, now, now);
    const row = database.get('SELECT * FROM plan_items WHERE id = ?', id);
    syncCalendar(database, workspaceId, plan, row, now);
    indexItem(database, workspaceId, plan, row, now);
    database.run('UPDATE plans SET updated_at = ? WHERE id = ?', now, planId);
    indexPlan(database, workspaceId, { ...plan, updated_at: now }, database.all('SELECT title FROM plan_items WHERE plan_id = ?', planId), now);
    audit(database, workspaceId, actorPersonId, 'plan_item.manual_created', 'plan_item', id, {
      planId, executionMode: normalized.executionMode
    }, now);
  });
  const item = savedItem(database, workspaceId, id);
  if (normalized.executionMode !== 'track') {
    return setPlanItemExecution(database, workspaceId, id, {
      ...input, executionMode: normalized.executionMode
    }, actorPersonId, now);
  }
  return item;
}

export function updateManualPlanItem(database, workspaceId, itemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = database.get(`
    SELECT pi.*, p.workspace_id, p.origin_kind AS plan_origin_kind
    FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, itemId);
  if (!current) fail('manual_plan_item_not_found');
  if (current.origin_kind !== 'manual' || current.plan_origin_kind !== 'manual') fail('manual_plan_item_required');
  const normalized = normalizeItem(database, workspaceId, input, current);
  const relation = database.get('SELECT * FROM plan_item_assignments WHERE plan_item_id = ?', itemId);
  if (relation && normalized.executionMode === 'track') fail('manual_plan_execution_already_linked');
  database.transaction(() => {
    database.run(`
      UPDATE plan_items SET item_no = ?, title = ?, description = ?, starts_at = ?, ends_at = ?,
        due_date = ?, responsible_raw = ?, responsible_person_id = ?, direction = ?, expected_result = ?,
        execution_mode = ?, updated_at = ? WHERE id = ?
    `, normalized.itemNo || current.item_no, normalized.title, normalized.description, normalized.startsAt,
    normalized.endsAt, normalized.dueDate, normalized.responsibleRaw, normalized.responsiblePersonId,
    normalized.direction, normalized.expectedResult, normalized.executionMode, now, itemId);
    const plan = database.get('SELECT * FROM plans WHERE id = ?', current.plan_id);
    const row = database.get('SELECT * FROM plan_items WHERE id = ?', itemId);
    syncCalendar(database, workspaceId, plan, row, now);
    indexItem(database, workspaceId, plan, row, now);
    database.run('UPDATE plans SET updated_at = ? WHERE id = ?', now, current.plan_id);
    audit(database, workspaceId, actorPersonId, 'plan_item.manual_updated', 'plan_item', itemId, {
      planId: current.plan_id, previous: {
        title: current.title, startsAt: current.starts_at, endsAt: current.ends_at,
        dueDate: current.due_date, direction: current.direction, executionMode: current.execution_mode
      }
    }, now);
  });
  if (normalized.executionMode !== 'track') {
    return setPlanItemExecution(database, workspaceId, itemId, { ...input, executionMode: normalized.executionMode }, actorPersonId, now);
  }
  return savedItem(database, workspaceId, itemId);
}

function executorList(database, workspaceId, input, item, mode) {
  const ids = Array.isArray(input.executorPersonIds) ? input.executorPersonIds.filter(Boolean) : [];
  if (input.responsiblePersonId) ids.unshift(input.responsiblePersonId);
  if (!ids.length && item.responsible_person_id) ids.push(item.responsible_person_id);
  const unique = [...new Set(ids)];
  if (mode === 'assigned' && !unique.length) fail('manual_plan_executor_required');
  return unique.map((id) => requirePerson(database, workspaceId, id, 'executorPersonIds'));
}

function upsertExecutors(database, assignmentId, executors, controller, now, preserveClaimantId = null) {
  database.run(`
    DELETE FROM assignment_executors
    WHERE assignment_id = ? AND NOT (role = 'executor' AND person_id = ?)
  `, assignmentId, preserveClaimantId || '__none__');
  for (const [index, row] of executors.entries()) {
    if (row.id === preserveClaimantId) continue;
    database.run(`
      INSERT OR IGNORE INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, assignmentId, row.id, row.display_name, index === 0 ? 'executor' : 'coexecutor', now);
  }
  if (controller) {
    database.run(`
      INSERT OR IGNORE INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
      VALUES (?, ?, ?, 'controller', ?)
    `, assignmentId, controller.id, controller.display_name, now);
  }
}

export function setPlanItemExecution(database, workspaceId, itemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const item = database.get(`
    SELECT pi.*, p.id AS plan_id, p.plan_kind, p.period_key
    FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.id = ?
  `, workspaceId, itemId);
  if (!item) fail('manual_plan_item_not_found');
  const mode = input.executionMode || input.execution_mode || item.execution_mode || 'track';
  if (!MODES.has(mode)) fail('manual_plan_execution_mode_invalid');
  const existing = database.get('SELECT * FROM plan_item_assignments WHERE plan_item_id = ?', itemId);
  if (mode === 'track') {
    if (existing) fail('manual_plan_execution_already_linked');
    database.run("UPDATE plan_items SET execution_mode = 'track', updated_at = ? WHERE id = ?", now, itemId);
    return savedItem(database, workspaceId, itemId);
  }
  const executors = executorList(database, workspaceId, input, item, mode);
  const controllerId = input.controllerPersonId || actorPersonId || null;
  const controller = controllerId ? requirePerson(database, workspaceId, controllerId, 'controllerPersonId') : null;
  const assignmentId = existing?.assignment_id || newId('assignment');
  database.transaction(() => {
    if (!existing) {
      database.run(`
        INSERT INTO assignments(
          id, workspace_id, directive_id, source_item_no, title, instruction_text, starts_at,
          due_date, direction, priority, status, expected_result, report_required,
          confidence, evidence_json, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'normal', 'open', ?, 1, 1, ?, ?, ?)
      `, assignmentId, workspaceId, item.item_no, item.title, item.description || item.title,
      item.starts_at, item.due_date || item.starts_at, item.direction, item.expected_result,
      JSON.stringify({ source: 'plan_item', provenance: item.origin_kind === 'manual' ? 'manual' : 'extracted', planId: item.plan_id, planItemId: item.id }), now, now);
      database.run(`
        INSERT INTO plan_item_assignments(
          plan_item_id, assignment_id, execution_mode, claimed_by_person_id,
          created_by_person_id, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?)
      `, itemId, assignmentId, mode, actorPersonId, now, now);
    } else {
      database.run(`
        UPDATE assignments SET source_item_no = ?, title = ?, instruction_text = ?, starts_at = ?,
          due_date = ?, direction = ?, expected_result = ?, updated_at = ? WHERE id = ?
      `, item.item_no, item.title, item.description || item.title, item.starts_at,
      item.due_date || item.starts_at, item.direction, item.expected_result, now, assignmentId);
      database.run('UPDATE plan_item_assignments SET execution_mode = ?, updated_at = ? WHERE plan_item_id = ?', mode, now, itemId);
    }
    const claimedBy = existing?.claimed_by_person_id || null;
    upsertExecutors(database, assignmentId, mode === 'open' ? [] : executors, controller, now, claimedBy);
    database.run('UPDATE plan_items SET execution_mode = ?, updated_at = ? WHERE id = ?', mode, now, itemId);
    ensureAssignmentPlanMetrics(database, workspaceId, assignmentId, now);
    audit(database, workspaceId, actorPersonId, existing ? 'plan_item.assignment_updated' : 'plan_item.assignment_created',
      'plan_item', itemId, { assignmentId, executionMode: mode }, now);
  });
  return savedItem(database, workspaceId, itemId);
}

export function claimOpenPlanItem(database, workspaceId, itemId, actorPersonId, now = new Date().toISOString()) {
  if (!actorPersonId) fail('manual_plan_claim_person_required');
  const actor = requirePerson(database, workspaceId, actorPersonId, 'actorPersonId');
  return database.transaction(() => {
    const row = database.get(`
      SELECT pi.plan_id, pia.* FROM plan_items pi
      JOIN plan_item_assignments pia ON pia.plan_item_id = pi.id
      JOIN plans p ON p.id = pi.plan_id
      WHERE p.workspace_id = ? AND pi.id = ?
    `, workspaceId, itemId);
    if (!row) fail('manual_plan_assignment_not_found');
    if (row.execution_mode !== 'open') fail('manual_plan_claim_not_open');
    if (row.claimed_by_person_id && row.claimed_by_person_id !== actorPersonId) fail('manual_plan_already_claimed');
    if (!row.claimed_by_person_id) {
      const existingExecutor = database.get(`
        SELECT person_id FROM assignment_executors
        WHERE assignment_id = ? AND role IN ('executor', 'coexecutor') LIMIT 1
      `, row.assignment_id);
      if (existingExecutor?.person_id && existingExecutor.person_id !== actorPersonId) fail('manual_plan_already_claimed');
      database.run(`
        INSERT OR IGNORE INTO assignment_executors(assignment_id, person_id, executor_raw, role, created_at)
        VALUES (?, ?, ?, 'executor', ?)
      `, row.assignment_id, actorPersonId, actor.display_name, now);
      database.run(`
        UPDATE plan_item_assignments SET claimed_by_person_id = ?, updated_at = ? WHERE plan_item_id = ?
      `, actorPersonId, now, itemId);
      database.run(`
        UPDATE plan_items SET responsible_person_id = ?, responsible_raw = ?, updated_at = ? WHERE id = ?
      `, actorPersonId, actor.display_name, now, itemId);
      database.run(`
        INSERT INTO assignment_updates(id, assignment_id, actor_person_id, status, progress_percent, note, created_at)
        VALUES (?, ?, ?, 'open', 0, 'Задача взята в работу.', ?)
      `, newId('update'), row.assignment_id, actorPersonId, now);
      const plan = database.get('SELECT * FROM plans WHERE id = ?', row.plan_id);
      const item = database.get('SELECT * FROM plan_items WHERE id = ?', itemId);
      syncCalendar(database, workspaceId, plan, item, now);
      audit(database, workspaceId, actorPersonId, 'plan_item.open_claimed', 'plan_item', itemId,
        { assignmentId: row.assignment_id }, now);
    }
    return savedItem(database, workspaceId, itemId);
  });
}

export function planGenerationInput(database, workspaceId, planId, idempotencyKey = null) {
  const plan = getPlan(database, workspaceId, planId);
  if (!plan) fail('manual_plan_not_found');
  return {
    idempotencyKey: idempotencyKey || `plan:${plan.id}:${plan.updated_at}`,
    title: plan.title,
    targetPeriod: {
      periodKind: plan.period_kind,
      periodKey: plan.period_key,
      yearStart: plan.year_start,
      yearEnd: plan.year_end
    },
    items: plan.items.map((item) => ({
      itemNo: item.item_no,
      title: item.title,
      description: item.description,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      dueDate: item.due_date,
      responsibleRaw: item.responsible_raw,
      direction: item.direction,
      expectedResult: item.expected_result
    }))
  };
}
