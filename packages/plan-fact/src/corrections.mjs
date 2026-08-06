import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import {
  getAssignmentPlanFact as getBaseAssignmentPlanFact,
  listPlanFact as listBasePlanFact
} from './service.mjs';

const ALLOWED_FIELDS = new Set(['target_numeric', 'actual_numeric']);

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

function daysBetween(from, to) {
  const left = new Date(`${dateOnly(from)}T00:00:00Z`);
  const right = new Date(`${dateOnly(to)}T00:00:00Z`);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return null;
  return Math.round((right.getTime() - left.getTime()) / 86_400_000);
}

function correctionKey(fieldKind, metricKey, evidenceId = null) {
  return `${fieldKind}:${evidenceId || ''}:${metricKey}`;
}

function serializeCorrection(row) {
  if (!row) return null;
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    assignmentEvidenceId: row.assignment_evidence_id,
    metricKey: row.metric_key,
    fieldKind: row.field_kind,
    machineValue: row.machine_value,
    correctedValue: row.corrected_value,
    reason: row.reason,
    actorPersonId: row.actor_person_id,
    actorName: row.actor_name,
    supersededById: row.superseded_by_id,
    revertedAt: row.reverted_at,
    revertedByPersonId: row.reverted_by_person_id,
    revertedByName: row.reverted_by_name,
    revertReason: row.revert_reason,
    createdAt: row.created_at,
    active: !row.superseded_by_id && !row.reverted_at
  };
}

export function listMetricCorrections(database, workspaceId, assignmentId) {
  return database.all(`
    SELECT c.*,
      actor.display_name AS actor_name,
      reverted_by.display_name AS reverted_by_name
    FROM plan_fact_metric_corrections c
    LEFT JOIN people actor ON actor.id = c.actor_person_id
    LEFT JOIN people reverted_by ON reverted_by.id = c.reverted_by_person_id
    WHERE c.workspace_id = ? AND c.assignment_id = ?
    ORDER BY c.created_at DESC, c.id DESC
  `, workspaceId, assignmentId).map(serializeCorrection);
}

function activeCorrectionMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.active) continue;
    map.set(correctionKey(row.fieldKind, row.metricKey, row.assignmentEvidenceId), row);
  }
  return map;
}

function riskForItem(item, progressPercent, now = new Date()) {
  if (item.status === 'completed') return { code: 'completed', label: 'Выполнено', severity: 'ok' };
  if (item.status === 'rework') return { code: 'rework', label: 'Требуется доработка', severity: 'high' };
  if (item.status === 'submitted') return { code: 'review', label: 'Ожидает проверки', severity: 'normal' };
  if (!item.dueDate) return { code: 'no_due_date', label: 'Нет срока', severity: 'warning' };

  const current = now instanceof Date ? now : new Date(now);
  const today = dateOnly(current.toISOString());
  const daysLeft = daysBetween(today, item.dueDate);
  if (daysLeft !== null && daysLeft < 0) {
    return { code: 'overdue', label: `Просрочено на ${Math.abs(daysLeft)} дн.`, severity: 'critical', daysLeft };
  }

  const start = dateOnly(item.startsAt);
  const totalDays = start ? daysBetween(start, item.dueDate) : null;
  const elapsedDays = start ? daysBetween(start, today) : null;
  const expected = totalDays && totalDays > 0 && elapsedDays !== null
    ? Math.max(0, Math.min(100, Math.round(elapsedDays / totalDays * 100)))
    : daysLeft !== null && daysLeft <= 7 ? 65 : 0;
  const progress = Number.isFinite(progressPercent) ? progressPercent : 0;
  if (daysLeft !== null && daysLeft <= 14 && progress + 15 < expected) {
    return { code: 'at_risk', label: 'Риск срыва', severity: 'high', daysLeft, expectedProgress: expected };
  }
  if (daysLeft !== null && daysLeft <= 7) {
    return { code: 'due_soon', label: `Срок через ${daysLeft} дн.`, severity: 'warning', daysLeft };
  }
  return { code: 'on_track', label: 'По плану', severity: 'ok', daysLeft, expectedProgress: expected };
}

function applyMetricCorrection(metric, map, evidenceId) {
  const targetCorrection = map.get(correctionKey('target_numeric', metric.key, null)) || null;
  const actualCorrection = map.get(correctionKey('actual_numeric', metric.key, evidenceId)) || null;
  const machineTargetNumeric = metric.machineTargetNumeric ?? metric.targetNumeric ?? null;
  const machineActualNumeric = metric.machineActualNumeric ?? metric.actualNumeric ?? null;
  const targetNumeric = targetCorrection ? targetCorrection.correctedValue : machineTargetNumeric;
  const actualNumeric = actualCorrection ? actualCorrection.correctedValue : machineActualNumeric;
  const unitMismatch = metric.status === 'unit_mismatch';
  const ratio = !unitMismatch
    && Number.isFinite(targetNumeric)
    && targetNumeric > 0
    && Number.isFinite(actualNumeric)
    ? actualNumeric / targetNumeric
    : null;

  return {
    ...metric,
    machineTargetNumeric,
    machineActualNumeric,
    targetNumeric,
    actualNumeric,
    attainmentPercent: ratio === null ? null : Math.round(ratio * 100),
    delta: ratio === null ? null : actualNumeric - targetNumeric,
    status: unitMismatch
      ? 'unit_mismatch'
      : ratio === null
        ? (Number.isFinite(actualNumeric) ? 'unplanned' : 'missing')
        : ratio >= 1 ? 'met' : 'below',
    targetCorrection,
    actualCorrection,
    corrected: Boolean(targetCorrection || actualCorrection)
  };
}

function decorateAssignment(database, workspaceId, item, now = new Date()) {
  if (!item || item.sourceKind !== 'assignment') return item;
  const corrections = listMetricCorrections(database, workspaceId, item.id);
  const active = activeCorrectionMap(corrections);
  const selectedEvidenceId = item.currentOutcome?.assignment_evidence_id
    || item.approvedOutcome?.assignment_evidence_id
    || null;
  const metrics = item.metrics.map((metric) => applyMetricCorrection(metric, active, selectedEvidenceId));
  const activeCount = corrections.filter((entry) => entry.active).length;
  const ratios = metrics
    .map((metric) => metric.attainmentPercent)
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(100, value)));
  const progressPercent = activeCount && ratios.length
    ? Math.round(ratios.reduce((sum, value) => sum + value, 0) / ratios.length)
    : item.progressPercent;

  return {
    ...item,
    selectedEvidenceId,
    metrics,
    corrections,
    correctionCount: activeCount,
    progressPercent,
    risk: riskForItem(item, progressPercent, now),
    summary: {
      planned: metrics.filter((metric) => metric.targetNumeric !== null || metric.targetText).length,
      measured: metrics.filter((metric) => metric.actualNumeric !== null || metric.actualText).length,
      met: metrics.filter((metric) => metric.status === 'met').length,
      below: metrics.filter((metric) => metric.status === 'below').length,
      missing: metrics.filter((metric) => metric.status === 'missing').length,
      corrected: metrics.filter((metric) => metric.corrected).length
    }
  };
}

export function getCorrectedAssignmentPlanFact(database, workspaceId, assignmentId, options = {}) {
  const item = getBaseAssignmentPlanFact(database, workspaceId, assignmentId, options);
  return decorateAssignment(database, workspaceId, item, options.now || new Date());
}

export function listCorrectedPlanFact(database, workspaceId, filters = {}, now = new Date()) {
  const result = listBasePlanFact(database, workspaceId, filters, now);
  const items = result.items.map((item) => decorateAssignment(database, workspaceId, item, now));
  return {
    ...result,
    items,
    summary: {
      total: items.length,
      completed: items.filter((item) => item.status === 'completed').length,
      submitted: items.filter((item) => item.status === 'submitted').length,
      atRisk: items.filter((item) => ['at_risk', 'overdue', 'rework'].includes(item.risk?.code)).length,
      overdue: items.filter((item) => item.risk?.code === 'overdue').length,
      corrected: items.filter((item) => Number(item.correctionCount || 0) > 0).length,
      averageProgress: items.length
        ? Math.round(items.reduce((sum, item) => sum + Number(item.progressPercent || 0), 0) / items.length)
        : 0
    }
  };
}

function requireAssignment(database, workspaceId, assignmentId) {
  const assignment = database.get(
    'SELECT id FROM assignments WHERE workspace_id = ? AND id = ?',
    workspaceId,
    assignmentId
  );
  if (!assignment) throw new AppError('assignment_not_found', 'Поручение не найдено.', 404);
  return assignment;
}

function requireActor(database, workspaceId, actorPersonId) {
  if (!actorPersonId) return null;
  const actor = database.get(
    'SELECT id FROM people WHERE workspace_id = ? AND id = ?',
    workspaceId,
    actorPersonId
  );
  if (!actor) throw new AppError('actor_not_found', 'Сотрудник, вносящий исправление, не найден.', 404);
  return actor.id;
}

function machineMetricValue(database, assignmentId, metricKey, fieldKind, evidenceId) {
  if (fieldKind === 'target_numeric') {
    const row = database.get(`
      SELECT target_numeric AS value
      FROM assignment_plan_metrics
      WHERE assignment_id = ? AND metric_key = ?
    `, assignmentId, metricKey);
    if (!row) throw new AppError('plan_metric_not_found', 'Плановый показатель не найден.', 404);
    return row.value;
  }

  if (!evidenceId) {
    throw new AppError('evidence_required', 'Для исправления факта укажите версию отчёта.', 400);
  }
  const row = database.get(`
    SELECT o.actual_numeric AS value
    FROM assignment_metric_observations o
    JOIN assignment_evidence e ON e.id = o.assignment_evidence_id
    WHERE o.assignment_id = ? AND o.assignment_evidence_id = ?
      AND o.metric_key = ? AND e.assignment_id = ?
  `, assignmentId, evidenceId, metricKey, assignmentId);
  if (!row) throw new AppError('fact_metric_not_found', 'Фактический показатель в выбранном отчёте не найден.', 404);
  return row.value;
}

export function createMetricCorrection(database, workspaceId, assignmentId, input, now = new Date().toISOString()) {
  requireAssignment(database, workspaceId, assignmentId);
  getBaseAssignmentPlanFact(database, workspaceId, assignmentId);
  const fieldKind = String(input.fieldKind || '');
  if (!ALLOWED_FIELDS.has(fieldKind)) {
    throw new AppError('correction_field_invalid', 'Можно исправить только числовой план или факт.', 400);
  }
  const metricKey = String(input.metricKey || '').trim();
  if (!metricKey) throw new AppError('metric_key_required', 'Укажите показатель.', 400);
  const correctedValue = Number(input.value);
  if (!Number.isFinite(correctedValue)) {
    throw new AppError('correction_value_invalid', 'Исправленное значение должно быть числом.', 400);
  }
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) {
    throw new AppError('correction_reason_required', 'Укажите причину исправления.', 400);
  }
  const actorPersonId = requireActor(database, workspaceId, input.actorPersonId || null);
  const assignmentEvidenceId = fieldKind === 'actual_numeric'
    ? String(input.assignmentEvidenceId || '').trim() || null
    : null;
  const machineValue = machineMetricValue(
    database,
    assignmentId,
    metricKey,
    fieldKind,
    assignmentEvidenceId
  );
  const id = newId('metriccorrection');

  database.transaction(() => {
    const current = database.get(`
      SELECT id FROM plan_fact_metric_corrections
      WHERE workspace_id = ? AND assignment_id = ?
        AND COALESCE(assignment_evidence_id, '') = COALESCE(?, '')
        AND metric_key = ? AND field_kind = ?
        AND superseded_by_id IS NULL AND reverted_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `, workspaceId, assignmentId, assignmentEvidenceId, metricKey, fieldKind);
    if (current) {
      database.run(
        'UPDATE plan_fact_metric_corrections SET superseded_by_id = ? WHERE id = ?',
        id,
        current.id
      );
    }
    database.run(`
      INSERT INTO plan_fact_metric_corrections(
        id, workspace_id, assignment_id, assignment_evidence_id,
        metric_key, field_kind, machine_value, corrected_value,
        reason, actor_person_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, workspaceId, assignmentId, assignmentEvidenceId, metricKey,
    fieldKind, machineValue, correctedValue, reason, actorPersonId, now);
  });

  return {
    correction: listMetricCorrections(database, workspaceId, assignmentId)
      .find((entry) => entry.id === id),
    item: getCorrectedAssignmentPlanFact(database, workspaceId, assignmentId, { now: new Date(now) })
  };
}

export function revertMetricCorrection(database, workspaceId, correctionId, input = {}, now = new Date().toISOString()) {
  const correction = database.get(`
    SELECT * FROM plan_fact_metric_corrections
    WHERE workspace_id = ? AND id = ?
  `, workspaceId, correctionId);
  if (!correction) throw new AppError('correction_not_found', 'Исправление не найдено.', 404);
  if (correction.superseded_by_id || correction.reverted_at) {
    throw new AppError('correction_not_active', 'Это исправление уже не является действующим.', 409);
  }
  const actorPersonId = requireActor(database, workspaceId, input.actorPersonId || null);
  const reason = String(input.reason || '').trim();

  database.transaction(() => {
    database.run(`
      UPDATE plan_fact_metric_corrections
      SET reverted_at = ?, reverted_by_person_id = ?, revert_reason = ?
      WHERE id = ?
    `, now, actorPersonId, reason || null, correctionId);
    const previous = database.get(`
      SELECT id FROM plan_fact_metric_corrections
      WHERE superseded_by_id = ? AND reverted_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `, correctionId);
    if (previous) {
      database.run(
        'UPDATE plan_fact_metric_corrections SET superseded_by_id = NULL WHERE id = ?',
        previous.id
      );
    }
  });

  return {
    item: getCorrectedAssignmentPlanFact(
      database,
      workspaceId,
      correction.assignment_id,
      { now: new Date(now) }
    ),
    corrections: listMetricCorrections(database, workspaceId, correction.assignment_id)
  };
}
