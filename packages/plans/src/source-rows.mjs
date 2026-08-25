import { newId } from '../../core/src/ids.mjs';
import { updatePlanItem } from './corrections.mjs';
import { extractLineItems, extractPlanSourceRows, sourceRowsForLineItems } from './items.mjs';
import { setPlanItemExecution } from './manual.mjs';
import { getPlan } from './queries.mjs';
import { parseJson } from './shared.mjs';

const MODES = new Set(['track', 'assigned', 'open']);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
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
      pi.execution_mode, pi.confidence
    FROM plan_source_row_items l
    JOIN plan_items pi ON pi.id = l.plan_item_id
    WHERE l.source_row_id = ?
    ORDER BY l.split_index, pi.created_at, pi.id
  `, sourceRowId);
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
    const attention = row.row_role === 'item'
      ? (!items.length || unmapped.length > 0 || (suggestion.warnings || []).length > 0 || row.confidence < 0.75)
      : row.row_role === 'context' && cells.length >= 2;
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
      items
    };
  });
  return {
    items: rows,
    summary: {
      rows: rows.filter((row) => row.role !== 'header').length,
      recognized: rows.filter((row) => row.role === 'item').length,
      attention: rows.filter((row) => row.attention).length,
      materialized: rows.filter((row) => row.items.length > 0).length
    }
  };
}

function sourceRow(database, workspaceId, planId, sourceRowId) {
  const row = database.get(`
    SELECT psr.*, p.source_document_version_id
    FROM plan_source_rows psr
    JOIN plans p ON p.id = psr.plan_id
    WHERE p.workspace_id = ? AND p.id = ? AND psr.id = ?
  `, workspaceId, planId, sourceRowId);
  if (!row) fail('plan_source_row_not_found');
  return {
    ...row,
    locator: parseJson(row.locator_json, {}),
    suggestion: parseJson(row.suggestion_json, {}),
    unmapped: parseJson(row.unmapped_json, [])
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
  const input = {
    executionMode: mode,
    executorPersonIds: Array.isArray(task?.executorPersonIds) ? task.executorPersonIds.filter(Boolean) : [],
    controllerPersonId: task?.controllerPersonId || null,
    responsiblePersonId: task?.responsiblePersonId || null
  };
  return input;
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
