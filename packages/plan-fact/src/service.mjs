import { newId } from '../../core/src/ids.mjs';
import { extractPlanMetrics, extractReportFacts, looksLikeReportFacts, normalizeMetricName } from '../../reports/src/facts.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

function daysBetween(from, to) {
  const left = new Date(`${dateOnly(from)}T00:00:00Z`);
  const right = new Date(`${dateOnly(to)}T00:00:00Z`);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return null;
  return Math.round((right.getTime() - left.getTime()) / 86_400_000);
}

function assignmentBase(database, workspaceId, assignmentId) {
  const assignment = database.get(`
    SELECT a.*, d.document_number, d.issued_at, d.title AS directive_title,
      dv.document_id AS source_document_id
    FROM assignments a
    LEFT JOIN directives d ON d.id = a.directive_id
    LEFT JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, assignmentId);
  if (!assignment) return null;
  assignment.executors = database.all(`
    SELECT ae.*, p.display_name, p.email, p.manager_id,
      manager.display_name AS manager_name
    FROM assignment_executors ae
    LEFT JOIN people p ON p.id = ae.person_id
    LEFT JOIN people manager ON manager.id = p.manager_id
    WHERE ae.assignment_id = ?
    ORDER BY CASE ae.role WHEN 'executor' THEN 1 WHEN 'coexecutor' THEN 2 WHEN 'controller' THEN 3 ELSE 4 END,
      ae.executor_raw
  `, assignmentId);
  return assignment;
}

export function ensureAssignmentPlanMetrics(database, workspaceId, assignmentId, now = new Date().toISOString()) {
  const assignment = assignmentBase(database, workspaceId, assignmentId);
  if (!assignment) return [];
  const existing = database.all('SELECT * FROM assignment_plan_metrics WHERE assignment_id = ? ORDER BY metric_name', assignmentId);
  if (existing.length) return existing.map((row) => ({ ...row, evidence: parseJson(row.evidence_json, {}) }));

  const source = [assignment.expected_result, assignment.instruction_text].filter(Boolean).join('\n');
  const metrics = extractPlanMetrics(source);
  for (const metric of metrics) {
    database.run(`
      INSERT INTO assignment_plan_metrics(
        id, assignment_id, metric_key, metric_name, unit, target_numeric,
        target_text, evidence_json, source_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?, ?)
      ON CONFLICT(assignment_id, metric_key) DO UPDATE SET
        metric_name = excluded.metric_name,
        unit = COALESCE(assignment_plan_metrics.unit, excluded.unit),
        target_numeric = COALESCE(assignment_plan_metrics.target_numeric, excluded.target_numeric),
        target_text = COALESCE(assignment_plan_metrics.target_text, excluded.target_text),
        evidence_json = excluded.evidence_json,
        updated_at = excluded.updated_at
    `, newId('planmetric'), assignmentId, metric.key, metric.name, metric.unit,
    metric.targetNumeric, metric.targetText, JSON.stringify(metric.evidence || {}), now, now);
  }
  return database.all('SELECT * FROM assignment_plan_metrics WHERE assignment_id = ? ORDER BY metric_name', assignmentId)
    .map((row) => ({ ...row, evidence: parseJson(row.evidence_json, {}) }));
}

export function ensureReportFactExtraction(database, workspaceId, documentVersionId, now = new Date().toISOString()) {
  const existing = database.get(`
    SELECT * FROM report_fact_extractions
    WHERE workspace_id = ? AND document_version_id = ?
  `, workspaceId, documentVersionId);
  if (existing) return {
    ...existing,
    metrics: parseJson(existing.metrics_json, []),
    evidence: parseJson(existing.evidence_json, {})
  };

  const document = database.get(`
    SELECT dv.id, dv.extracted_text, d.title
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, documentVersionId);
  if (!document?.extracted_text || !looksLikeReportFacts(document.extracted_text, document.title)) return null;
  const result = extractReportFacts(document.extracted_text, document.title);
  const id = newId('reportfacts');
  database.run(`
    INSERT INTO report_fact_extractions(
      id, workspace_id, document_version_id, result_state, summary,
      progress_percent, metrics_json, evidence_json, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, workspaceId, documentVersionId, result.resultState, result.summary,
  result.progressPercent, JSON.stringify(result.metrics), JSON.stringify(result.evidence),
  result.confidence, now, now);
  const saved = database.get('SELECT * FROM report_fact_extractions WHERE id = ?', id);
  return saved ? { ...saved, metrics: result.metrics, evidence: result.evidence } : null;
}

export function applyReportFactsToAssignment(database, workspaceId, assignmentId, assignmentEvidenceId, extraction, now = new Date().toISOString()) {
  const assignment = assignmentBase(database, workspaceId, assignmentId);
  if (!assignment || !extraction || !assignmentEvidenceId) return null;
  ensureAssignmentPlanMetrics(database, workspaceId, assignmentId, now);

  database.run(`
    INSERT INTO assignment_outcomes(
      id, assignment_id, assignment_evidence_id, result_state, summary,
      progress_percent, confidence, evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(assignment_evidence_id) DO UPDATE SET
      result_state = excluded.result_state,
      summary = excluded.summary,
      progress_percent = excluded.progress_percent,
      confidence = excluded.confidence,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at
  `, newId('outcome'), assignmentId, assignmentEvidenceId, extraction.result_state || extraction.resultState || 'unknown',
  extraction.summary || null, extraction.progress_percent ?? extraction.progressPercent ?? null,
  extraction.confidence || 0, JSON.stringify(extraction.evidence || parseJson(extraction.evidence_json, {})), now, now);

  const metrics = extraction.metrics || parseJson(extraction.metrics_json, []);
  for (const metric of metrics) {
    if (metric.actualNumeric === null && !metric.actualText) continue;
    const key = metric.key || normalizeMetricName(metric.name);
    database.run(`
      INSERT INTO assignment_metric_observations(
        id, assignment_id, assignment_evidence_id, metric_key, metric_name,
        unit, actual_numeric, actual_text, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assignment_evidence_id, metric_key) DO UPDATE SET
        metric_name = excluded.metric_name,
        unit = excluded.unit,
        actual_numeric = excluded.actual_numeric,
        actual_text = excluded.actual_text,
        evidence_json = excluded.evidence_json
    `, newId('metricobs'), assignmentId, assignmentEvidenceId, key,
    metric.name || key, metric.unit || null, metric.actualNumeric,
    metric.actualText || null, JSON.stringify(metric.evidence || {}), now);
  }
  return getAssignmentPlanFact(database, workspaceId, assignmentId, { ensure: false, now });
}

function outcomeRows(database, assignmentId) {
  return database.all(`
    SELECT ao.*, ae.document_version_id, ae.review_status, ae.review_note,
      ae.reviewed_at, ae.reviewed_by_person_id,
      dv.document_id AS report_document_id, d.title AS report_document_title,
      dv.original_name AS report_original_name
    FROM assignment_outcomes ao
    JOIN assignment_evidence ae ON ae.id = ao.assignment_evidence_id
    LEFT JOIN document_versions dv ON dv.id = ae.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE ao.assignment_id = ?
    ORDER BY ao.created_at DESC
  `, assignmentId).map((row) => ({ ...row, evidence: parseJson(row.evidence_json, {}) }));
}

function observationsForEvidence(database, evidenceId) {
  if (!evidenceId) return [];
  return database.all(`
    SELECT * FROM assignment_metric_observations
    WHERE assignment_evidence_id = ? ORDER BY metric_name
  `, evidenceId).map((row) => ({ ...row, evidence: parseJson(row.evidence_json, {}) }));
}

function riskFor(assignment, progressPercent, now = new Date()) {
  if (assignment.status === 'completed') return { code: 'completed', label: 'Выполнено', severity: 'ok' };
  if (assignment.status === 'rework') return { code: 'rework', label: 'Требуется доработка', severity: 'high' };
  if (assignment.status === 'submitted') return { code: 'review', label: 'Ожидает проверки', severity: 'normal' };
  if (!assignment.due_date) return { code: 'no_due_date', label: 'Нет срока', severity: 'warning' };

  const today = dateOnly(now.toISOString());
  const daysLeft = daysBetween(today, assignment.due_date);
  if (daysLeft !== null && daysLeft < 0) return { code: 'overdue', label: `Просрочено на ${Math.abs(daysLeft)} дн.`, severity: 'critical', daysLeft };

  const start = dateOnly(assignment.starts_at || assignment.issued_at || assignment.created_at);
  const totalDays = start ? daysBetween(start, assignment.due_date) : null;
  const elapsedDays = start ? daysBetween(start, today) : null;
  const expected = totalDays && totalDays > 0 && elapsedDays !== null
    ? Math.max(0, Math.min(100, Math.round(elapsedDays / totalDays * 100)))
    : daysLeft !== null && daysLeft <= 7 ? 65 : 0;
  const progress = Number.isFinite(progressPercent) ? progressPercent : 0;
  if (daysLeft !== null && daysLeft <= 14 && progress + 15 < expected) {
    return { code: 'at_risk', label: 'Риск срыва', severity: 'high', daysLeft, expectedProgress: expected };
  }
  if (daysLeft !== null && daysLeft <= 7) return { code: 'due_soon', label: `Срок через ${daysLeft} дн.`, severity: 'warning', daysLeft };
  return { code: 'on_track', label: 'По плану', severity: 'ok', daysLeft, expectedProgress: expected };
}

function metricComparison(plan, observation) {
  const target = plan?.target_numeric;
  const actual = observation?.actual_numeric;
  const unitMismatch = Boolean(plan?.unit && observation?.unit && plan.unit !== observation.unit);
  const ratio = !unitMismatch && Number.isFinite(target) && target > 0 && Number.isFinite(actual)
    ? actual / target
    : null;
  return {
    key: plan?.metric_key || observation?.metric_key,
    name: plan?.metric_name || observation?.metric_name,
    unit: plan?.unit || observation?.unit || null,
    targetNumeric: target ?? null,
    targetText: plan?.target_text || null,
    actualNumeric: actual ?? null,
    actualText: observation?.actual_text || null,
    attainmentPercent: ratio === null ? null : Math.round(ratio * 100),
    delta: ratio === null ? null : actual - target,
    status: unitMismatch ? 'unit_mismatch' : ratio === null ? (observation ? 'unplanned' : 'missing') : ratio >= 1 ? 'met' : 'below',
    planEvidence: plan?.evidence || {},
    factEvidence: observation?.evidence || {}
  };
}

function latestProgress(database, assignmentId) {
  const update = database.get(`
    SELECT progress_percent, id, created_at FROM assignment_updates
    WHERE assignment_id = ? AND progress_percent IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `, assignmentId);
  return update || null;
}

export function getAssignmentPlanFact(database, workspaceId, assignmentId, { ensure = true, now = new Date() } = {}) {
  const assignment = assignmentBase(database, workspaceId, assignmentId);
  if (!assignment) return null;
  if (ensure) {
    ensureAssignmentPlanMetrics(database, workspaceId, assignmentId);
    const evidences = database.all(`
      SELECT id, document_version_id FROM assignment_evidence
      WHERE assignment_id = ? AND evidence_kind = 'report'
      ORDER BY created_at
    `, assignmentId);
    for (const evidence of evidences) {
      const exists = database.get('SELECT 1 AS present FROM assignment_outcomes WHERE assignment_evidence_id = ?', evidence.id);
      if (exists || !evidence.document_version_id) continue;
      const extraction = ensureReportFactExtraction(database, workspaceId, evidence.document_version_id);
      if (extraction) applyReportFactsToAssignment(database, workspaceId, assignmentId, evidence.id, extraction);
    }
  }

  const plans = database.all('SELECT * FROM assignment_plan_metrics WHERE assignment_id = ? ORDER BY metric_name', assignmentId)
    .map((row) => ({ ...row, evidence: parseJson(row.evidence_json, {}) }));
  const outcomes = outcomeRows(database, assignmentId);
  const currentOutcome = outcomes.find((item) => item.review_status !== 'returned') || outcomes[0] || null;
  const approvedOutcome = outcomes.find((item) => item.review_status === 'approved') || null;
  const selectedOutcome = currentOutcome || approvedOutcome;
  const observations = observationsForEvidence(database, selectedOutcome?.assignment_evidence_id);
  const observationMap = new Map(observations.map((item) => [item.metric_key, item]));
  const comparisons = plans.map((plan) => metricComparison(plan, observationMap.get(plan.metric_key)));
  const plannedKeys = new Set(plans.map((item) => item.metric_key));
  for (const observation of observations) {
    if (!plannedKeys.has(observation.metric_key)) comparisons.push(metricComparison(null, observation));
  }

  const metricProgressValues = comparisons
    .map((item) => item.attainmentPercent)
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(100, value)));
  const update = latestProgress(database, assignmentId);
  const progressPercent = selectedOutcome?.progress_percent ?? update?.progress_percent
    ?? (metricProgressValues.length
      ? Math.round(metricProgressValues.reduce((sum, value) => sum + value, 0) / metricProgressValues.length)
      : assignment.status === 'completed' ? 100 : 0);
  const risk = riskFor(assignment, progressPercent, now instanceof Date ? now : new Date(now));
  const owners = assignment.executors.filter((item) => ['executor', 'coexecutor'].includes(item.role));
  const controllers = assignment.executors.filter((item) => item.role === 'controller');
  const managerIds = [...new Set([
    ...controllers.map((item) => item.person_id),
    ...owners.map((item) => item.manager_id)
  ].filter(Boolean))];

  return {
    sourceKind: 'assignment',
    id: assignment.id,
    title: assignment.title,
    instructionText: assignment.instruction_text,
    expectedResult: assignment.expected_result,
    documentNumber: assignment.document_number,
    sourceDocumentId: assignment.source_document_id,
    direction: assignment.direction,
    status: assignment.status,
    startsAt: assignment.starts_at || assignment.issued_at,
    dueDate: assignment.due_date,
    completedAt: assignment.completed_at,
    priority: assignment.priority,
    owners,
    controllers,
    ownerPersonIds: [...new Set(owners.map((item) => item.person_id).filter(Boolean))],
    managerPersonIds: managerIds,
    progressPercent,
    risk,
    currentOutcome,
    approvedOutcome,
    outcomes,
    metrics: comparisons,
    summary: {
      planned: plans.length,
      measured: observations.length,
      met: comparisons.filter((item) => item.status === 'met').length,
      below: comparisons.filter((item) => item.status === 'below').length,
      missing: comparisons.filter((item) => item.status === 'missing').length
    },
    progressRevision: selectedOutcome?.updated_at || update?.created_at || assignment.updated_at
  };
}

function periodicPlanFact(row, now) {
  const progressPercent = row.status === 'completed' ? 100 : 0;
  const risk = riskFor({ ...row, starts_at: row.starts_at, issued_at: null }, progressPercent, now);
  return {
    sourceKind: 'periodic_task',
    id: row.id,
    title: row.title,
    instructionText: row.description,
    expectedResult: row.expected_result,
    direction: row.direction,
    status: row.status,
    startsAt: row.starts_at,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    priority: row.priority,
    periodKind: row.period_kind,
    periodKey: row.period_key,
    owners: row.owner_person_id ? [{ person_id: row.owner_person_id, display_name: row.owner_name, role: 'executor' }] : [],
    controllers: row.manager_person_id ? [{ person_id: row.manager_person_id, display_name: row.manager_name, role: 'controller' }] : [],
    ownerPersonIds: [row.owner_person_id].filter(Boolean),
    managerPersonIds: [row.manager_person_id].filter(Boolean),
    progressPercent,
    risk,
    currentOutcome: null,
    approvedOutcome: null,
    outcomes: [],
    metrics: [],
    summary: { planned: 0, measured: 0, met: 0, below: 0, missing: 0 },
    progressRevision: row.updated_at
  };
}

export function listPlanFact(database, workspaceId, filters = {}, now = new Date()) {
  const assignmentClauses = ['a.workspace_id = ?'];
  const assignmentParams = [workspaceId];
  if (filters.from) { assignmentClauses.push('a.due_date >= ?'); assignmentParams.push(filters.from); }
  if (filters.to) { assignmentClauses.push('a.due_date <= ?'); assignmentParams.push(filters.to); }
  if (filters.direction) { assignmentClauses.push('a.direction = ?'); assignmentParams.push(filters.direction); }
  if (filters.status) { assignmentClauses.push('a.status = ?'); assignmentParams.push(filters.status); }
  if (filters.ownerPersonId) {
    assignmentClauses.push(`EXISTS (
      SELECT 1 FROM assignment_executors ae
      WHERE ae.assignment_id = a.id AND ae.person_id = ? AND ae.role IN ('executor','coexecutor')
    )`);
    assignmentParams.push(filters.ownerPersonId);
  }
  if (filters.managerPersonId) {
    assignmentClauses.push(`EXISTS (
      SELECT 1 FROM assignment_executors ae
      LEFT JOIN people p ON p.id = ae.person_id
      WHERE ae.assignment_id = a.id
        AND ((ae.role = 'controller' AND ae.person_id = ?)
          OR (ae.role IN ('executor','coexecutor') AND p.manager_id = ?))
    )`);
    assignmentParams.push(filters.managerPersonId, filters.managerPersonId);
  }
  const assignmentIds = filters.periodKind || filters.periodKey ? [] : database.all(`
    SELECT a.id FROM assignments a
    WHERE ${assignmentClauses.join(' AND ')}
    ORDER BY COALESCE(a.due_date, '9999-12-31'), a.title
    LIMIT 2000
  `, ...assignmentParams).map((row) => row.id);

  const periodicClauses = ['pt.workspace_id = ?'];
  const periodicParams = [workspaceId];
  if (filters.from) { periodicClauses.push('pt.due_date >= ?'); periodicParams.push(filters.from); }
  if (filters.to) { periodicClauses.push('pt.due_date <= ?'); periodicParams.push(filters.to); }
  if (filters.direction) { periodicClauses.push('pt.direction = ?'); periodicParams.push(filters.direction); }
  if (filters.status) { periodicClauses.push('pt.status = ?'); periodicParams.push(filters.status); }
  if (filters.ownerPersonId) { periodicClauses.push('pt.owner_person_id = ?'); periodicParams.push(filters.ownerPersonId); }
  if (filters.managerPersonId) { periodicClauses.push('pt.manager_person_id = ?'); periodicParams.push(filters.managerPersonId); }
  if (filters.periodKind) { periodicClauses.push('pt.period_kind = ?'); periodicParams.push(filters.periodKind); }
  if (filters.periodKey) { periodicClauses.push('pt.period_key = ?'); periodicParams.push(filters.periodKey); }
  const periodic = database.all(`
    SELECT pt.*, owner.display_name AS owner_name, manager.display_name AS manager_name
    FROM periodic_tasks pt
    LEFT JOIN people owner ON owner.id = pt.owner_person_id
    LEFT JOIN people manager ON manager.id = pt.manager_person_id
    WHERE ${periodicClauses.join(' AND ')}
    ORDER BY pt.due_date, pt.title LIMIT 2000
  `, ...periodicParams).map((row) => periodicPlanFact(row, now instanceof Date ? now : new Date(now)));

  const assignments = assignmentIds.map((id) => getAssignmentPlanFact(database, workspaceId, id, { ensure: true, now }));
  const items = [...assignments, ...periodic]
    .filter(Boolean)
    .sort((a, b) => String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31')) || a.title.localeCompare(b.title, 'ru'));
  const averageProgress = items.length
    ? Math.round(items.reduce((sum, item) => sum + Number(item.progressPercent || 0), 0) / items.length)
    : 0;
  return {
    items: items.slice(0, Math.min(2000, Math.max(1, Number(filters.limit || 500)))),
    summary: {
      total: items.length,
      completed: items.filter((item) => item.status === 'completed').length,
      submitted: items.filter((item) => item.status === 'submitted').length,
      atRisk: items.filter((item) => ['at_risk', 'overdue', 'rework'].includes(item.risk.code)).length,
      overdue: items.filter((item) => item.risk.code === 'overdue').length,
      averageProgress
    },
    facets: {
      directions: [...new Set(items.map((item) => item.direction).filter(Boolean))].sort(),
      statuses: [...new Set(items.map((item) => item.status).filter(Boolean))].sort(),
      periods: [...new Set(items.map((item) => item.periodKey).filter(Boolean))].sort()
    }
  };
}

export function rebuildPlanFact(database, workspaceId, now = new Date().toISOString()) {
  let planMetrics = 0;
  let reportExtractions = 0;
  let outcomes = 0;
  return database.transaction(() => {
    const assignments = database.all('SELECT id FROM assignments WHERE workspace_id = ?', workspaceId);
    for (const assignment of assignments) {
      planMetrics += ensureAssignmentPlanMetrics(database, workspaceId, assignment.id, now).length;
      const evidences = database.all(`
        SELECT id, document_version_id FROM assignment_evidence
        WHERE assignment_id = ? AND evidence_kind = 'report'
      `, assignment.id);
      for (const evidence of evidences) {
        const extraction = evidence.document_version_id
          ? ensureReportFactExtraction(database, workspaceId, evidence.document_version_id, now)
          : null;
        if (!extraction) continue;
        reportExtractions += 1;
        applyReportFactsToAssignment(database, workspaceId, assignment.id, evidence.id, extraction, now);
        outcomes += 1;
      }
    }
    return { assignments: assignments.length, planMetrics, reportExtractions, outcomes };
  });
}
