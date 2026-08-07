import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { addFacet, addReview, findPerson, insertCalendarItem } from './persist-helpers.mjs';
import { parseJson, planKindLabel } from './shared.mjs';

const DIRECTIONS = new Set(['science', 'education', 'organizational', 'everyday']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function cleanOptional(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function dateValue(value) {
  const text = cleanOptional(value);
  if (!text) return null;
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/u);
  if (!match) fail('plan_item_date_invalid');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) fail('plan_item_date_invalid');
  return text;
}

function context(database, workspaceId, planId, itemId) {
  const row = database.get(`
    SELECT pi.*, p.workspace_id, p.source_document_version_id, p.plan_kind, p.period_key,
      p.title AS plan_title, dv.document_id AS source_document_id
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    WHERE p.workspace_id = ? AND p.id = ? AND pi.id = ?
  `, workspaceId, planId, itemId);
  if (!row) return null;
  return { ...row, evidence: parseJson(row.evidence_json, {}) };
}

function snapshot(row) {
  return {
    title: row.title,
    description: row.description,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    due_date: row.due_date,
    responsible_raw: row.responsible_raw,
    responsible_person_id: row.responsible_person_id,
    direction: row.direction,
    expected_result: row.expected_result
  };
}

function itemForProjection(row) {
  return {
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dueDate: row.due_date,
    responsibleRaw: row.responsible_raw,
    direction: row.direction,
    expectedResult: row.expected_result,
    evidence: row.evidence
  };
}

function deleteSearchProjection(database, workspaceId, itemId) {
  database.run(`
    DELETE FROM search_fts
    WHERE fragment_id IN (
      SELECT id FROM search_fragments
      WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
    )
  `, workspaceId, itemId);
  database.run(`
    DELETE FROM search_fragments
    WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
  `, workspaceId, itemId);
}

function syncMissingDateReview(database, row, now) {
  const missing = database.all(`
    SELECT id, title, source_item_key
    FROM plan_items
    WHERE plan_id = ? AND starts_at IS NULL AND due_date IS NULL
    ORDER BY source_item_key
  `, row.plan_id);
  const existing = database.get(`
    SELECT * FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND issue_code = 'plan_items_without_date'
    ORDER BY created_at DESC LIMIT 1
  `, row.workspace_id, row.source_document_version_id);

  if (!missing.length) {
    if (existing?.status === 'open') {
      database.run(`
        UPDATE review_items
        SET status = 'resolved', resolved_at = ?, resolution_json = ?
        WHERE id = ?
      `, now, JSON.stringify({ action: 'operator_correction', planId: row.plan_id }), existing.id);
    }
    return;
  }

  const explanation = `${missing.length} пункт(а/ов) сохранены, но не добавлены в календарь: срок отсутствует или задан неоднозначно.`;
  const contextJson = JSON.stringify({ planId: row.plan_id, items: missing });
  if (existing) {
    database.run(`
      UPDATE review_items
      SET status = 'open', resolved_at = NULL, resolution_json = NULL,
        explanation = ?, context_json = ?
      WHERE id = ?
    `, explanation, contextJson, existing.id);
    return;
  }
  addReview(
    database, row.workspace_id, row.source_document_version_id,
    'plan_items_without_date', 'В плане есть пункты без однозначного срока',
    explanation,
    'Уточните сроки по исходному документу; остальные пункты плана уже импортированы.',
    { planId: row.plan_id, items: missing }, now
  );
}

function rebuildProjection(database, row, now) {
  deleteSearchProjection(database, row.workspace_id, row.id);
  database.run(`
    DELETE FROM entity_facets
    WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
  `, row.workspace_id, row.id);
  database.run(`
    DELETE FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
  `, row.workspace_id, row.id);

  addFacet(database, row.workspace_id, 'plan_item', row.id, 'plan_kind', row.plan_kind, now);
  addFacet(database, row.workspace_id, 'plan_item', row.id, 'period', row.period_key, now);
  addFacet(database, row.workspace_id, 'plan_item', row.id, 'direction', row.direction, now);
  addFacet(database, row.workspace_id, 'plan_item', row.id, 'responsible', row.responsible_raw, now);
  addFacet(database, row.workspace_id, 'plan_item', row.id, 'date', row.due_date || row.starts_at, now);
  addSearchFragment(database, {
    workspaceId: row.workspace_id,
    sourceKind: 'plan_item',
    sourceId: row.id,
    documentVersionId: row.source_document_version_id,
    title: row.title,
    content: [
      row.description, row.responsible_raw, row.expected_result,
      row.period_key, planKindLabel(row.plan_kind)
    ].filter(Boolean).join('\n'),
    locator: row.evidence?.locator || {}
  });

  const plan = { id: row.plan_id, plan_kind: row.plan_kind, period_key: row.period_key };
  const item = itemForProjection(row);
  if (row.starts_at) {
    insertCalendarItem(database, {
      workspaceId: row.workspace_id, plan, planItemId: row.id, item,
      documentId: row.source_document_id, startsAt: row.starts_at,
      endsAt: row.ends_at || null, title: row.title, kind: 'event',
      status: 'confirmed', reminderMinutes: null, now
    });
  }
  if (row.due_date) {
    insertCalendarItem(database, {
      workspaceId: row.workspace_id, plan, planItemId: row.id, item,
      documentId: row.source_document_id, startsAt: row.due_date,
      title: row.starts_at ? `Срок: ${row.title}` : row.title, kind: 'task',
      status: 'open', reminderMinutes: 10080, now
    });
  }
  syncMissingDateReview(database, row, now);
}

function writeAudit(database, row, action, details, actorPersonId, now) {
  const id = newId('audit');
  database.run(`
    INSERT INTO audit_log(
      id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, 'plan_item', ?, ?, ?)
  `, id, row.workspace_id, actorPersonId || 'operator', action, row.id, JSON.stringify(details), now);
  return id;
}

function latestUndoableCorrection(database, workspaceId, itemId) {
  return database.get(`
    SELECT a.*
    FROM audit_log a
    WHERE a.workspace_id = ?
      AND a.subject_kind = 'plan_item'
      AND a.subject_id = ?
      AND a.action = 'plan.item.corrected'
      AND NOT EXISTS (
        SELECT 1 FROM audit_log u
        WHERE u.workspace_id = a.workspace_id
          AND u.subject_kind = 'plan_item'
          AND u.subject_id = a.subject_id
          AND u.action = 'plan.item.correction_undone'
          AND json_extract(u.details_json, '$.correctionAuditId') = a.id
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
  `, workspaceId, itemId) || null;
}

function result(database, workspaceId, planId, itemId) {
  const row = context(database, workspaceId, planId, itemId);
  if (!row) return null;
  const undo = latestUndoableCorrection(database, workspaceId, itemId);
  return {
    ...row,
    calendar_items: database.all(`
      SELECT * FROM calendar_items
      WHERE workspace_id = ? AND source_kind = 'plan_item' AND source_id = ?
      ORDER BY starts_at, item_kind
    `, workspaceId, itemId),
    correction: {
      canUndo: Boolean(undo),
      auditId: undo?.id || null,
      changedAt: undo?.created_at || null
    }
  };
}

export function updatePlanItem(database, workspaceId, planId, itemId, body = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = context(database, workspaceId, planId, itemId);
  if (!current) fail('plan_item_not_found');

  const title = hasOwn(body, 'title') ? String(body.title || '').trim() : current.title;
  if (!title) fail('plan_item_title_required');
  const startsAt = hasOwn(body, 'startsAt') ? dateValue(body.startsAt) : current.starts_at;
  const endsAt = hasOwn(body, 'endsAt') ? dateValue(body.endsAt) : current.ends_at;
  const dueDate = hasOwn(body, 'dueDate') ? dateValue(body.dueDate) : current.due_date;
  if (startsAt && endsAt && endsAt < startsAt) fail('plan_item_date_range_invalid');

  const responsibleRaw = hasOwn(body, 'responsibleRaw')
    ? cleanOptional(body.responsibleRaw)
    : current.responsible_raw;
  const responsible = responsibleRaw ? findPerson(database, workspaceId, responsibleRaw) : null;
  const direction = hasOwn(body, 'direction') ? String(body.direction || '').trim() : current.direction;
  if (!DIRECTIONS.has(direction)) fail('plan_item_direction_invalid');

  const next = {
    ...current,
    title,
    description: hasOwn(body, 'description') ? cleanOptional(body.description) : current.description,
    starts_at: startsAt,
    ends_at: endsAt,
    due_date: dueDate,
    responsible_raw: responsibleRaw,
    responsible_person_id: responsible?.id || null,
    direction,
    expected_result: hasOwn(body, 'expectedResult') ? cleanOptional(body.expectedResult) : current.expected_result
  };
  const previousSnapshot = snapshot(current);
  const nextSnapshot = snapshot(next);
  if (JSON.stringify(previousSnapshot) === JSON.stringify(nextSnapshot)) return result(database, workspaceId, planId, itemId);

  return database.transaction(() => {
    database.run(`
      UPDATE plan_items SET
        title = ?, description = ?, starts_at = ?, ends_at = ?, due_date = ?,
        responsible_raw = ?, responsible_person_id = ?, direction = ?,
        expected_result = ?, updated_at = ?
      WHERE id = ? AND plan_id = ?
    `, next.title, next.description, next.starts_at, next.ends_at, next.due_date,
    next.responsible_raw, next.responsible_person_id, next.direction,
    next.expected_result, now, itemId, planId);
    const saved = context(database, workspaceId, planId, itemId);
    rebuildProjection(database, saved, now);
    writeAudit(database, saved, 'plan.item.corrected', {
      previous: previousSnapshot,
      current: nextSnapshot,
      reason: cleanOptional(body.reason),
      evidencePreserved: true,
      sourceLocator: saved.evidence?.locator || null
    }, actorPersonId, now);
    return result(database, workspaceId, planId, itemId);
  });
}

export function undoPlanItemCorrection(database, workspaceId, planId, itemId, actorPersonId = null, now = new Date().toISOString()) {
  const current = context(database, workspaceId, planId, itemId);
  if (!current) fail('plan_item_not_found');
  const correction = latestUndoableCorrection(database, workspaceId, itemId);
  if (!correction) fail('plan_item_undo_unavailable');

  const details = parseJson(correction.details_json, {});
  const previous = details.previous;
  if (!previous || !previous.title) fail('plan_item_undo_invalid');

  return database.transaction(() => {
    database.run(`
      UPDATE plan_items SET
        title = ?, description = ?, starts_at = ?, ends_at = ?, due_date = ?,
        responsible_raw = ?, responsible_person_id = ?, direction = ?,
        expected_result = ?, updated_at = ?
      WHERE id = ? AND plan_id = ?
    `, previous.title, previous.description ?? null, previous.starts_at ?? null,
    previous.ends_at ?? null, previous.due_date ?? null, previous.responsible_raw ?? null,
    previous.responsible_person_id ?? null, previous.direction || 'organizational',
    previous.expected_result ?? null, now, itemId, planId);
    const restored = context(database, workspaceId, planId, itemId);
    rebuildProjection(database, restored, now);
    writeAudit(database, restored, 'plan.item.correction_undone', {
      correctionAuditId: correction.id,
      restored: snapshot(restored),
      evidencePreserved: true
    }, actorPersonId, now);
    return result(database, workspaceId, planId, itemId);
  });
}
