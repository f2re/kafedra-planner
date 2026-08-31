import { newId } from '../../core/src/ids.mjs';
import { updatePlanItem } from './corrections.mjs';
import { extractLineItems, extractPlanSourceRows, sourceRowsForLineItems } from './items.mjs';
import { setPlanItemExecution } from './manual.mjs';
import { getPlan } from './queries.mjs';
import { parseJson } from './shared.mjs';

const MODES = new Set(['track', 'assigned', 'open']);
const INCLUSION_STATES = new Set(['included', 'excluded']);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function cleanReason(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > 500) fail('plan_source_row_decision_reason_too_long', { max: 500 });
  return result;
}

function blocksForVersion(database, documentVersionId) {
  return database.all(`
    SELECT text, locator_json, metadata_json
    FROM document_blocks
    WHERE document_version_id = ?
    ORDER BY sequence_no
  `, documentVersionId).map((row) => ({
    text: row.text,
    locator: parseJson(row.locator_json, {}),
    metadata: parseJson(row.metadata_json, {})
  }));
}

function normalizedSourceRows(blocks, plan) {
  const period = {
    kind: plan.period_kind,
    periodKind: plan.period_kind,
    key: plan.period_key,
    yearStart: plan.year_start,
    yearEnd: plan.year_end
  };
  let rows = extractPlanSourceRows(blocks, period);
  if (!rows.some((row) => row.role === 'item')) {
    const items = extractLineItems(blocks, period);
    const existingKeys = new Set(rows.map((row) => row.sourceRowKey));
    rows = rows.concat(sourceRowsForLineItems(items).filter((row) => !existingKeys.has(row.sourceRowKey)));
  }
  return rows;
}

export function persistPlanSourceRows(database, planId, sourceRows = [], now = new Date().toISOString()) {
  const ids = new Map();
  for (const row of sourceRows || []) {
    if (!row?.sourceRowKey || !row.rawText) continue;
    const proposedId = newId('plansrcrow');
    database.run(`
      INSERT INTO plan_source_rows(
        id, plan_id, source_row_key, group_kind, group_name, row_number, row_role,
        raw_text, cells_json, locator_json, suggestion_json, unmapped_json,
        confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id, source_row_key) DO UPDATE SET
        group_kind = excluded.group_kind,
        group_name = excluded.group_name,
        row_number = excluded.row_number,
        row_role = excluded.row_role,
        raw_text = excluded.raw_text,
        cells_json = excluded.cells_json,
        locator_json = excluded.locator_json,
        suggestion_json = excluded.suggestion_json,
        unmapped_json = excluded.unmapped_json,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `, proposedId, planId, row.sourceRowKey, row.groupKind || 'line', row.groupName || null,
    Number(row.rowNumber || 1), row.role || 'context', row.rawText,
    JSON.stringify(row.cells || []), JSON.stringify(row.locator || {}), JSON.stringify(row.suggestion || {}),
    JSON.stringify(row.unmapped || []), Number(row.confidence || 0), now, now);
    const stored = database.get(
      'SELECT id FROM plan_source_rows WHERE plan_id = ? AND source_row_key = ?', planId, row.sourceRowKey
    );
    if (stored) ids.set(row.sourceRowKey, stored.id);
  }
  return ids;
}

export function linkPlanItemsToSourceRows(database, planId, now = new Date().toISOString()) {
  const rows = database.all(`
    SELECT pi.id AS plan_item_id, psr.id AS source_row_id
    FROM plan_items pi
    JOIN plan_source_rows psr
      ON psr.plan_id = pi.plan_id AND psr.source_row_key = pi.source_item_key
    WHERE pi.plan_id = ?
  `, planId);
  for (const row of rows) {
    database.run(`
      INSERT OR IGNORE INTO plan_source_row_items(source_row_id, plan_item_id, split_index, created_at)
      VALUES (?, ?, 0, ?)
    `, row.source_row_id, row.plan_item_id, now);
  }
}

export function ensurePlanSourceRows(database, workspaceId, planId, now = new Date().toISOString()) {
  const plan = database.get(`
    SELECT * FROM plans WHERE workspace_id = ? AND id = ?
  `, workspaceId, planId);
  if (!plan) fail('plan_source_plan_not_found');
  if (!plan.source_document_version_id) return plan;

  const count = Number(database.get(
    'SELECT COUNT(*) AS n FROM plan_source_rows WHERE plan_id = ?', planId
  )?.n || 0);
  if (!count) {
    const blocks = blocksForVersion(database, plan.source_document_version_id);
    if (blocks.length) persistPlanSourceRows(database, planId, normalizedSourceRows(blocks, plan), now);
  }
  linkPlanItemsToSourceRows(database, planId, now);
  return plan;
}

function linkedItems(database, sourceRowId) {
  return database.all(`
    SELECT l.split_index, pi.id, pi.item_no, pi.title, pi.description,
      pi.starts_at, pi.ends_at, pi.due_date, pi.responsible_raw,
      pi.responsible_person_id, pi.direction, pi.expected_result, pi.status,
      pi.execution_mode, pi.confidence, pi.origin_kind, pi.created_by_person_id,
      pi.created_at, pi.updated_at
    FROM plan_source_row_items l
    JOIN plan_items pi ON pi.id = l.plan_item_id
    WHERE l.source_row_id = ?
    ORDER BY l.split_index, pi.created_at, pi.id
  `, sourceRowId);
}

function latestDecision(database, sourceRowId) {
  const row = database.get(`
    SELECT inclusion_status, actor_person_id, reason, impact_json, created_at
    FROM plan_source_row_decisions
    WHERE source_row_id = ?
    ORDER BY decision_no DESC
    LIMIT 1
  `, sourceRowId);
  if (!row) return null;
  return {
    inclusionStatus: row.inclusion_status,
    actorPersonId: row.actor_person_id,
    reason: row.reason,
    impact: parseJson(row.impact_json, {}),
    createdAt: row.created_at
  };
}

function decisionHistoryCount(database, sourceRowId) {
  return Number(database.get(
    'SELECT COUNT(*) AS n FROM plan_source_row_decisions WHERE source_row_id = ?',
    sourceRowId
  )?.n || 0);
}

export function listPlanSourceRows(database, workspaceId, planId) {
  ensurePlanSourceRows(database, workspaceId, planId);
  const rows = database.all(`
    SELECT * FROM plan_source_rows
    WHERE plan_id = ?
    ORDER BY
      CASE group_kind WHEN 'table' THEN 1 WHEN 'sheet' THEN 2 WHEN 'delimited' THEN 3 ELSE 4 END,
      group_name, row_number, id
  `, planId).map((row) => {
    const suggestion = parseJson(row.suggestion_json, {});
    const cells = parseJson(row.cells_json, []);
    const unmapped = parseJson(row.unmapped_json, []);
    const items = linkedItems(database, row.id);
    const inclusionStatus = row.inclusion_status || 'included';
    const attention = inclusionStatus === 'included' && (
      row.row_role === 'item'
        ? (!items.length || unmapped.length > 0 || (suggestion.warnings || []).length > 0 || row.confidence < 0.75)
        : row.row_role === 'context' && cells.length >= 2
    );
    return {
      id: row.id,
      sourceRowKey: row.source_row_key,
      groupKind: row.group_kind,
      groupName: row.group_name,
      rowNumber: row.row_number,
      role: row.row_role,
      rawText: row.raw_text,
      cells,
      locator: parseJson(row.locator_json, {}),
      suggestion,
      unmapped,
      confidence: row.confidence,
      attention,
      inclusionStatus,
      inclusionDecidedByPersonId: row.inclusion_decided_by_person_id,
      inclusionDecidedAt: row.inclusion_decided_at,
      inclusionReason: row.inclusion_reason,
      decisionHistoryCount: decisionHistoryCount(database, row.id),
      latestDecision: latestDecision(database, row.id),
      items
    };
  });
  return {
    items: rows,
    summary: {
      rows: rows.filter((row) => row.role !== 'header').length,
      recognized: rows.filter((row) => row.role === 'item').length,
      attention: rows.filter((row) => row.attention).length,
      materialized: rows.filter((row) =>
        row.inclusionStatus === 'included' && row.items.some((item) => item.status !== 'cancelled')
      ).length,
      included: rows.filter((row) => row.role !== 'header' && row.inclusionStatus === 'included').length,
      excluded: rows.filter((row) => row.role !== 'header' && row.inclusionStatus === 'excluded').length
    }
  };
}

function sourceRow(database, workspaceId, planId, sourceRowId) {
  const row = database.get(`
    SELECT psr.*, p.workspace_id, p.source_document_version_id
    FROM plan_source_rows psr
    JOIN plans p ON p.id = psr.plan_id
    WHERE p.workspace_id = ? AND p.id = ? AND psr.id = ?
  `, workspaceId, planId, sourceRowId);
  if (!row) fail('plan_source_row_not_found');
  return {
    ...row,
    inclusion_status: row.inclusion_status || 'included',
    locator: parseJson(row.locator_json, {}),
    suggestion: parseJson(row.suggestion_json, {}),
    unmapped: parseJson(row.unmapped_json, []),
    exclusionSnapshot: parseJson(row.exclusion_snapshot_json, {})
  };
}

function sourceNote(row) {
  const values = (row.unmapped || []).map((cell) => {
    const text = String(cell?.text || '').trim();
    if (!text) return null;
    const label = String(cell?.label || '').trim();
    return label ? `${label}: ${text}` : text;
  }).filter(Boolean);
  if (!values.length) return null;
  return `Из исходной строки: ${values.join(' | ')}`;
}

function taskBody(task, row) {
  const body = {
    title: String(task?.title || '').trim(),
    description: task?.description == null ? null : String(task.description).trim() || null,
    startsAt: task?.startsAt || null,
    endsAt: task?.endsAt || null,
    dueDate: task?.dueDate || null,
    responsibleRaw: task?.responsibleRaw == null ? null : String(task.responsibleRaw).trim() || null,
    direction: task?.direction || 'organizational',
    expectedResult: task?.expectedResult == null ? null : String(task.expectedResult).trim() || null,
    reason: 'Разбор исходной строки плана оператором'
  };
  if (!body.title) fail('plan_source_task_title_required');
  const note = task?.keepUnmappedInComment === false ? null : sourceNote(row);
  if (note && !String(body.description || '').includes(note)) {
    body.description = [body.description, note].filter(Boolean).join('\n');
  }
  return body;
}

function existingLink(database, sourceRowId, splitIndex) {
  return database.get(`
    SELECT l.*, pi.plan_id, pi.execution_mode
    FROM plan_source_row_items l
    JOIN plan_items pi ON pi.id = l.plan_item_id
    WHERE l.source_row_id = ? AND l.split_index = ?
  `, sourceRowId, splitIndex) || null;
}

function insertDerivedItem(database, planId, row, splitIndex, actorPersonId, now) {
  const itemId = newId('planitem');
  const sourceItemKey = `${row.source_row_key}:split:${splitIndex}`;
  database.run(`
    INSERT INTO plan_items(
      id, plan_id, source_item_key, origin_kind, execution_mode, item_no, title, description,
      starts_at, ends_at, due_date, responsible_raw, responsible_person_id, direction,
      expected_result, status, confidence, evidence_json, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'extracted', 'track', NULL, '(черновик из исходной строки)', NULL,
      NULL, NULL, NULL, NULL, NULL, 'organizational', NULL, 'planned', ?, ?, ?, ?, ?)
  `, itemId, planId, sourceItemKey, Number(row.confidence || 0), JSON.stringify({
    source: 'plan_source_row',
    provenance: 'operator_split',
    sourceRowId: row.id,
    splitIndex,
    locator: row.locator,
    sourceRowKey: row.source_row_key,
    raw: row.raw_text
  }), actorPersonId || null, now, now);
  database.run(`
    INSERT INTO plan_source_row_items(source_row_id, plan_item_id, split_index, created_at)
    VALUES (?, ?, ?, ?)
  `, row.id, itemId, splitIndex, now);
  return itemId;
}

function executionInput(task) {
  const mode = task?.executionMode || 'track';
  if (!MODES.has(mode)) fail('plan_source_execution_mode_invalid');
  return {
    executionMode: mode,
    executorPersonIds: Array.isArray(task?.executorPersonIds) ? task.executorPersonIds.filter(Boolean) : [],
    controllerPersonId: task?.controllerPersonId || null,
    responsiblePersonId: task?.responsiblePersonId || null
  };
}

function undoableCorrectionCount(database, workspaceId, itemId) {
  return Number(database.get(`
    SELECT COUNT(*) AS n
    FROM audit_log a
    WHERE a.workspace_id = ?
      AND a.subject_kind = 'plan_item'
      AND a.subject_id = ?
      AND a.action = 'plan.item.corrected'
      AND NOT EXISTS (
        SELECT 1 FROM audit_log u
        WHERE u.workspace_id = a.workspace_id
          AND u.subject_kind = a.subject_kind
          AND u.subject_id = a.subject_id
          AND u.action = 'plan.item.correction_undone'
          AND json_extract(u.details_json, '$.correctionAuditId') = a.id
      )
  `, workspaceId, itemId)?.n || 0);
}

function itemDecisionDetail(database, workspaceId, item) {
  const assignment = database.get(`
    SELECT a.id, a.status, a.completed_at, a.updated_at
    FROM plan_item_assignments pia
    JOIN assignments a ON a.id = pia.assignment_id
    WHERE pia.plan_item_id = ?
  `, item.id) || null;
  const calendars = database.all(`
    SELECT id, item_kind, title, status, completed_at, revision, updated_at
    FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
    ORDER BY starts_at, item_kind, id
  `, workspaceId, item.id);
  const assignmentUpdates = assignment ? Number(database.get(
    'SELECT COUNT(*) AS n FROM assignment_updates WHERE assignment_id = ?',
    assignment.id
  )?.n || 0) : 0;
  const assignmentEvidence = assignment ? Number(database.get(
    'SELECT COUNT(*) AS n FROM assignment_evidence WHERE assignment_id = ?',
    assignment.id
  )?.n || 0) : 0;
  const supportingDocuments = Number(database.get(`
    SELECT COUNT(*) AS n
    FROM supporting_document_links
    WHERE workspace_id = ?
      AND (
        (target_kind = 'plan_item' AND target_id = ?)
        OR (target_kind = 'assignment' AND target_id = ?)
      )
  `, workspaceId, item.id, assignment?.id || '')?.n || 0);
  const corrections = undoableCorrectionCount(database, workspaceId, item.id);
  const blockReasons = [];
  if (item.status === 'completed' || assignment?.status === 'completed' || calendars.some((row) => row.status === 'completed')) {
    blockReasons.push('completed_work');
  }
  if (item.origin_kind === 'manual' || item.created_by_person_id || corrections > 0 || assignmentUpdates > 0) {
    blockReasons.push('manual_authority');
  }
  return {
    ...item,
    assignment,
    calendars,
    assignmentUpdates,
    assignmentEvidence,
    supportingDocuments,
    corrections,
    blockReasons: [...new Set(blockReasons)]
  };
}

export function getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId) {
  ensurePlanSourceRows(database, workspaceId, planId);
  const row = sourceRow(database, workspaceId, planId, sourceRowId);
  const items = linkedItems(database, row.id).map((item) => itemDecisionDetail(database, workspaceId, item));
  const blockers = items.flatMap((item) => item.blockReasons.map((reason) => ({
    reason,
    itemId: item.id,
    title: item.title,
    assignmentId: item.assignment?.id || null
  })));
  const activeAssignments = items.filter((item) =>
    item.assignment && !['cancelled', 'completed'].includes(item.assignment.status)
  ).length;
  const activeCalendarItems = items.reduce((count, item) =>
    count + item.calendars.filter((calendar) => calendar.status !== 'cancelled').length, 0);
  const evidenceLinks = items.reduce((count, item) =>
    count + item.assignmentEvidence + item.supportingDocuments, 0);
  const confirmationRequired = blockers.length === 0 && (activeAssignments > 0 || evidenceLinks > 0);
  return {
    sourceRowId: row.id,
    inclusionStatus: row.inclusion_status,
    mode: blockers.length ? 'blocked' : (confirmationRequired ? 'confirm' : 'immediate'),
    canExclude: blockers.length === 0,
    confirmationRequired,
    summary: {
      linkedItems: items.length,
      activeItems: items.filter((item) => item.status !== 'cancelled').length,
      activeAssignments,
      activeCalendarItems,
      evidenceLinks,
      blockers: blockers.length
    },
    blockers,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      executionMode: item.execution_mode,
      assignmentId: item.assignment?.id || null,
      assignmentStatus: item.assignment?.status || null,
      calendarCount: item.calendars.filter((calendar) => calendar.status !== 'cancelled').length,
      evidenceCount: item.assignmentEvidence + item.supportingDocuments,
      manuallyAuthoritative: item.blockReasons.includes('manual_authority'),
      completed: item.blockReasons.includes('completed_work')
    }))
  };
}

function decisionNumber(database, sourceRowId) {
  return Number(database.get(`
    SELECT COALESCE(MAX(decision_no), 0) + 1 AS next_no
    FROM plan_source_row_decisions
    WHERE source_row_id = ?
  `, sourceRowId)?.next_no || 1);
}

function writeDecision(database, row, inclusionStatus, actorPersonId, reason, impact, snapshot, now) {
  const id = newId('plansrcdecision');
  database.run(`
    INSERT INTO plan_source_row_decisions(
      id, source_row_id, decision_no, inclusion_status, actor_person_id,
      reason, impact_json, snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, row.id, decisionNumber(database, row.id), inclusionStatus, actorPersonId || null,
  reason, JSON.stringify(impact || {}), JSON.stringify(snapshot || {}), now);
  database.run(`
    INSERT INTO audit_log(
      id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, 'plan_source_row', ?, ?, ?)
  `, newId('audit'), row.workspace_id, actorPersonId || 'operator',
  inclusionStatus === 'excluded' ? 'plan.source_row.excluded' : 'plan.source_row.restored',
  row.id, JSON.stringify({
    planId: row.plan_id,
    inclusionStatus,
    reason,
    impact,
    evidencePreserved: true
  }), now);
  return id;
}

function exclusionSnapshot(items, now) {
  return {
    version: 1,
    excludedAt: now,
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      updatedAt: item.updated_at,
      changed: item.status !== 'cancelled',
      assignment: item.assignment ? {
        id: item.assignment.id,
        status: item.assignment.status,
        completedAt: item.assignment.completed_at,
        updatedAt: item.assignment.updated_at,
        changed: item.assignment.status !== 'cancelled'
      } : null,
      calendars: item.calendars.map((calendar) => ({
        id: calendar.id,
        status: calendar.status,
        completedAt: calendar.completed_at,
        revision: calendar.revision,
        updatedAt: calendar.updated_at,
        changed: calendar.status !== 'cancelled'
      }))
    }))
  };
}

function cancelSnapshotProjections(database, snapshot, now) {
  for (const item of snapshot.items || []) {
    if (item.assignment?.changed) {
      database.run(`
        UPDATE assignments
        SET status = 'cancelled', completed_at = NULL, updated_at = ?
        WHERE id = ? AND status <> 'cancelled'
      `, now, item.assignment.id);
    } else if (item.changed) {
      database.run(`
        UPDATE plan_items
        SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status <> 'cancelled'
      `, now, item.id);
    }
    for (const calendar of item.calendars || []) {
      if (!calendar.changed) continue;
      database.run(`
        UPDATE calendar_items
        SET status = 'cancelled', completed_at = NULL, revision = revision + 1, updated_at = ?
        WHERE id = ? AND status <> 'cancelled'
      `, now, calendar.id);
    }
  }
}

function restoreSnapshotProjections(database, snapshot, now) {
  const result = { restoredCalendars: 0, restoredAssignments: 0, restoredItems: 0, skipped: [] };
  const excludedAt = snapshot?.excludedAt;
  if (!excludedAt) return result;

  for (const item of snapshot.items || []) {
    for (const calendar of item.calendars || []) {
      if (!calendar.changed) continue;
      const restored = database.run(`
        UPDATE calendar_items
        SET status = ?, completed_at = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND status = 'cancelled' AND updated_at = ?
      `, calendar.status, calendar.completedAt ?? null, now, calendar.id, excludedAt);
      if (Number(restored.changes || 0) > 0) result.restoredCalendars += 1;
      else result.skipped.push({ kind: 'calendar_item', id: calendar.id });
    }
  }

  for (const item of snapshot.items || []) {
    if (item.assignment?.changed) {
      const restored = database.run(`
        UPDATE assignments
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'cancelled' AND updated_at = ?
      `, item.assignment.status, item.assignment.completedAt ?? null, now, item.assignment.id, excludedAt);
      if (Number(restored.changes || 0) > 0) result.restoredAssignments += 1;
      else result.skipped.push({ kind: 'assignment', id: item.assignment.id });
      continue;
    }
    if (!item.changed) continue;
    const restored = database.run(`
      UPDATE plan_items
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = 'cancelled' AND updated_at = ?
    `, item.status, now, item.id, excludedAt);
    if (Number(restored.changes || 0) > 0) result.restoredItems += 1;
    else result.skipped.push({ kind: 'plan_item', id: item.id });
  }
  return result;
}

export function setPlanSourceRowInclusion(
  database,
  workspaceId,
  planId,
  sourceRowId,
  input = {},
  actorPersonId = null,
  now = new Date().toISOString()
) {
  ensurePlanSourceRows(database, workspaceId, planId, now);
  const requested = String(input.inclusionStatus || '').trim();
  if (!INCLUSION_STATES.has(requested)) fail('plan_source_row_decision_invalid');
  const reason = cleanReason(input.reason);
  const current = sourceRow(database, workspaceId, planId, sourceRowId);
  if (current.inclusion_status === requested) {
    return {
      idempotent: true,
      inclusionStatus: requested,
      impact: getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId),
      sourceRows: listPlanSourceRows(database, workspaceId, planId)
    };
  }

  if (requested === 'excluded') {
    const initialImpact = getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId);
    if (!initialImpact.canExclude) fail('plan_source_row_decision_blocked', { impact: initialImpact });
    if (initialImpact.confirmationRequired && input.confirmImpact !== true) {
      fail('plan_source_row_decision_confirmation_required', { impact: initialImpact });
    }

    return database.transaction(() => {
      const row = sourceRow(database, workspaceId, planId, sourceRowId);
      if (row.inclusion_status === 'excluded') {
        return {
          idempotent: true,
          inclusionStatus: 'excluded',
          impact: getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId),
          sourceRows: listPlanSourceRows(database, workspaceId, planId)
        };
      }
      const impact = getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId);
      if (!impact.canExclude) fail('plan_source_row_decision_blocked', { impact });
      if (impact.confirmationRequired && input.confirmImpact !== true) {
        fail('plan_source_row_decision_confirmation_required', { impact });
      }
      const items = linkedItems(database, row.id).map((item) => itemDecisionDetail(database, workspaceId, item));
      const snapshot = exclusionSnapshot(items, now);
      cancelSnapshotProjections(database, snapshot, now);
      database.run(`
        UPDATE plan_source_rows
        SET inclusion_status = 'excluded',
            inclusion_decided_by_person_id = ?,
            inclusion_decided_at = ?,
            inclusion_reason = ?,
            exclusion_snapshot_json = ?,
            updated_at = ?
        WHERE id = ? AND plan_id = ?
      `, actorPersonId || null, now, reason, JSON.stringify(snapshot), now, row.id, planId);
      const decisionId = writeDecision(
        database, row, 'excluded', actorPersonId, reason, impact, snapshot, now
      );
      database.run('UPDATE plans SET updated_at = ? WHERE id = ?', now, planId);
      return {
        idempotent: false,
        decisionId,
        inclusionStatus: 'excluded',
        impact,
        restoration: null,
        sourceRows: listPlanSourceRows(database, workspaceId, planId)
      };
    });
  }

  return database.transaction(() => {
    const row = sourceRow(database, workspaceId, planId, sourceRowId);
    if (row.inclusion_status === 'included') {
      return {
        idempotent: true,
        inclusionStatus: 'included',
        impact: getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId),
        sourceRows: listPlanSourceRows(database, workspaceId, planId)
      };
    }
    const snapshot = row.exclusionSnapshot;
    const restoration = restoreSnapshotProjections(database, snapshot, now);
    const impact = getPlanSourceRowDecisionImpact(database, workspaceId, planId, sourceRowId);
    database.run(`
      UPDATE plan_source_rows
      SET inclusion_status = 'included',
          inclusion_decided_by_person_id = ?,
          inclusion_decided_at = ?,
          inclusion_reason = ?,
          exclusion_snapshot_json = '{}',
          updated_at = ?
      WHERE id = ? AND plan_id = ?
    `, actorPersonId || null, now, reason, now, row.id, planId);
    const decisionId = writeDecision(
      database, row, 'included', actorPersonId, reason, impact,
      { restoredFrom: snapshot, restoration }, now
    );
    database.run('UPDATE plans SET updated_at = ? WHERE id = ?', now, planId);
    return {
      idempotent: false,
      decisionId,
      inclusionStatus: 'included',
      impact,
      restoration,
      sourceRows: listPlanSourceRows(database, workspaceId, planId)
    };
  });
}

export function materializePlanSourceRow(
  database,
  workspaceId,
  planId,
  sourceRowId,
  input = {},
  actorPersonId = null,
  now = new Date().toISOString()
) {
  ensurePlanSourceRows(database, workspaceId, planId, now);
  const row = sourceRow(database, workspaceId, planId, sourceRowId);
  if (row.inclusion_status === 'excluded') fail('plan_source_row_excluded');
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (!tasks.length) fail('plan_source_tasks_required');
  if (tasks.length > 20) fail('plan_source_tasks_too_many');

  return database.transaction(() => {
    const savedIds = [];
    tasks.forEach((task, splitIndex) => {
      const body = taskBody(task, row);
      const link = existingLink(database, row.id, splitIndex);
      const itemId = link?.plan_item_id || insertDerivedItem(
        database, planId, row, splitIndex, actorPersonId, now
      );
      updatePlanItem(database, workspaceId, planId, itemId, body, actorPersonId, now);
      const mode = task?.executionMode || 'track';
      try {
        setPlanItemExecution(database, workspaceId, itemId, {
          ...executionInput(task),
          executionMode: mode
        }, actorPersonId, now);
      } catch (error) {
        if (String(error?.code || error?.message) === 'manual_plan_execution_already_linked' && mode === 'track') {
          fail('plan_source_assignment_preserved', { itemId });
        }
        throw error;
      }
      savedIds.push(itemId);
    });
    database.run('UPDATE plan_source_rows SET updated_at = ? WHERE id = ?', now, row.id);
    database.run('UPDATE plans SET updated_at = ? WHERE id = ?', now, planId);

    const retained = database.all(`
      SELECT plan_item_id FROM plan_source_row_items
      WHERE source_row_id = ? AND split_index >= ? ORDER BY split_index
    `, row.id, tasks.length).map((item) => item.plan_item_id);
    return {
      plan: getPlan(database, workspaceId, planId),
      sourceRows: listPlanSourceRows(database, workspaceId, planId),
      savedItemIds: savedIds,
      retainedItemIds: retained
    };
  });
}
