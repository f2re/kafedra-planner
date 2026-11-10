import { newId } from '../../../packages/core/src/ids.mjs';
import { enqueueJob } from '../../../packages/storage/src/jobs.mjs';
import { loadLlmSettings } from '../../../packages/ai/src/llm-config-store.mjs';
import {
  PLAN_TASK, chunkPlanRows, planInputHash, planTaskInput, proposePlanWithLlama
} from '../../../packages/ai/src/plan-task.mjs';
import { ensurePlanSourceRows } from '../../../packages/plans/src/source-rows.mjs';

const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };

function currentConfig(config = {}) {
  return { ...config, ...loadLlmSettings(config.dataDir, config) };
}

function settingsHash(settings) {
  return planInputHash(JSON.stringify({
    endpoint: settings.llmEndpoint, model: settings.llmModel,
    context: settings.llmContextSize, maxTokens: settings.llmMaxTokens
  }));
}

function sourceRows(database, planId) {
  return database.all(`
    SELECT psr.*, EXISTS(SELECT 1 FROM plan_source_row_items l WHERE l.source_row_id = psr.id) AS linked
    FROM plan_source_rows psr
    WHERE psr.plan_id = ? AND psr.row_role <> 'header'
    ORDER BY psr.group_kind, psr.group_name, psr.row_number, psr.source_row_key
  `, planId).map((row) => ({
    id: row.id, sourceRowKey: row.source_row_key, rawText: row.raw_text,
    locator: parse(row.locator_json), suggestion: parse(row.suggestion_json), linked: Boolean(row.linked)
  }));
}

function obviousHeading(row) {
  const text = row.rawText.replace(/\s+/gu, ' ').trim();
  return /^(?:утверждаю|согласовано)(?:\s|$)/iu.test(text)
    || /^план(?:\s+(?:работы|мероприятий|деятельности|основных))?\s*(?:$|на\s|кафедр|институт|университет|факультет|подразделен)/iu.test(text)
    || /^(?:на\s+)?20\d{2}(?:[\s/–—-]+(?:20)?\d{2})?\s+(?:(?:календарный|учебный)\s+)?год[а]?\.?$/iu.test(text);
}

function periodForPlan(plan) {
  const evidence = parse(plan.evidence_json);
  const confirmed = plan.period_kind !== 'unknown' && !evidence.period?.inferred;
  return {
    kind: confirmed ? plan.period_kind : 'unknown', key: confirmed ? plan.period_key : null,
    yearStart: confirmed ? plan.year_start : null, yearEnd: confirmed ? plan.year_end : null
  };
}

function recordRun(database, plan, result, output, now = new Date().toISOString()) {
  const id = newId('llmrun');
  database.run(`
    INSERT INTO llm_extraction_runs(
      id, workspace_id, document_version_id, purpose, endpoint, model,
      prompt_version, input_sha256, status, response_json, error_message,
      duration_ms, created_at, completed_at
    ) VALUES (?, ?, ?, 'plan_enrichment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, plan.workspace_id, plan.source_document_version_id, result.endpoint || null,
  result.model || null, PLAN_TASK.version, result.inputSha256, result.status,
  JSON.stringify({ ...output, metadata: result.metadata || null }), result.error || null,
  result.durationMs || null, now, now);
  return id;
}

export function enqueuePlanLlmJobs(database, {
  workspaceId, planId, config = {}, retryFailed = false, now = new Date().toISOString()
}) {
  const settings = currentConfig(config);
  if (!settings.llmEnabled || !settings.llmEndpoint) return { status: 'disabled', queued: 0, skipped: [] };
  const plan = ensurePlanSourceRows(database, workspaceId, planId, now);
  if (!plan.source_document_version_id || plan.status !== 'active') return { status: 'idle', queued: 0, skipped: [] };
  const rows = sourceRows(database, plan.id).filter((row) => !obviousHeading(row));
  const period = periodForPlan(plan);
  // Chunk boundaries include linked rows, so accepting one proposal does not
  // shuffle the remaining source into fresh duplicate jobs on every retry.
  const { chunks, skipped } = chunkPlanRows(rows, period, settings);
  const configurationHash = settingsHash(settings);
  const unresolved = skipped.filter((row) => !rows.find((candidate) => candidate.sourceRowKey === row.sourceRowKey)?.linked);
  let queued = 0;
  database.transaction(() => {
    if (unresolved.length) {
      const diagnosticKey = `oversized:${configurationHash}:${planInputHash(JSON.stringify(unresolved))}`;
      const recorded = database.get(`
        SELECT id FROM llm_extraction_runs
        WHERE document_version_id = ? AND purpose = 'plan_enrichment'
          AND json_extract(response_json, '$.diagnosticKey') = ?
      `, plan.source_document_version_id, diagnosticKey);
      if (!recorded) recordRun(database, plan, {
        status: 'failed', inputSha256: planInputHash(JSON.stringify(planTaskInput(rows, period))),
        model: settings.llmModel, error: 'llm_context_too_small'
      }, { diagnosticKey, configurationHash, skipped: unresolved, items: [] }, now);
    }
    chunks.forEach((chunk, chunkIndex) => {
      if (chunk.every((row) => row.linked)) return;
      const inputSha256 = planInputHash(JSON.stringify(planTaskInput(chunk, period)));
      const idempotencyKey = `plan-llm:${plan.id}:${PLAN_TASK.version}:${configurationHash}:${inputSha256}`;
      const existing = database.get('SELECT * FROM jobs WHERE idempotency_key = ?', idempotencyKey);
      // Settings can change between queueing and dispatch. A completed request
      // with the current model still counts, even if its job had an older key.
      const actualRun = database.get(`
        SELECT status FROM llm_extraction_runs
        WHERE document_version_id = ? AND purpose = 'plan_enrichment' AND prompt_version = ?
          AND json_extract(response_json, '$.chunkInputSha256') = ?
          AND json_extract(response_json, '$.configurationHash') = ?
        ORDER BY rowid DESC LIMIT 1
      `, plan.source_document_version_id, PLAN_TASK.version, inputSha256, configurationHash);
      if (actualRun && (actualRun.status === 'completed' || !retryFailed)) return;
      if (existing) {
        if (!retryFailed || ['queued', 'running', 'retry'].includes(existing.status)) return;
        const previous = database.get(`
          SELECT status FROM llm_extraction_runs WHERE purpose = 'plan_enrichment'
            AND json_extract(response_json, '$.jobId') = ? ORDER BY rowid DESC LIMIT 1
        `, existing.id);
        if (previous && !['failed', 'partial', 'disabled'].includes(previous.status)) return;
        const payload = parse(existing.payload_json);
        payload.retryNo = Number(payload.retryNo || 0) + 1;
        database.run(`
          UPDATE jobs SET status = 'queued', payload_json = ?, attempts = 0,
            available_at = ?, locked_by = NULL, lease_until = NULL, last_error = NULL, updated_at = ?
          WHERE id = ?
        `, JSON.stringify(payload), now, now, existing.id);
        queued += 1;
        return;
      }
      enqueueJob(database, {
        kind: 'enrich_plan', priority: -10, maxAttempts: 1, idempotencyKey, availableAt: now,
        payload: {
          workspaceId, planId: plan.id, documentVersionId: plan.source_document_version_id,
          rowKeys: chunk.map((row) => row.sourceRowKey), inputSha256,
          configurationHash, chunkIndex, chunkCount: chunks.length, retryNo: 0
        }
      });
      queued += 1;
    });
  });
  return { status: queued ? 'pending' : unresolved.length ? 'partial' : 'idle', queued, skipped: unresolved };
}

export async function processPlanLlmJob(database, job, logger, config, { fetchImpl = fetch } = {}) {
  const payload = parse(job.payload_json);
  const plan = database.get(`
    SELECT * FROM plans WHERE workspace_id = ? AND id = ? AND source_document_version_id = ?
  `, payload.workspaceId, payload.planId, payload.documentVersionId);
  if (!plan || plan.status !== 'active') return { status: 'skipped', reason: 'plan_unavailable' };
  const attemptKey = `${job.id}:${Number(payload.retryNo || 0)}`;
  const previous = database.get(`
    SELECT status FROM llm_extraction_runs WHERE purpose = 'plan_enrichment'
      AND json_extract(response_json, '$.attemptKey') = ? LIMIT 1
  `, attemptKey);
  if (previous) return { status: previous.status, duplicate: true };
  const keys = new Set(payload.rowKeys || []);
  const rows = sourceRows(database, plan.id).filter((row) => keys.has(row.sourceRowKey) && !row.linked);
  if (!rows.length) return { status: 'skipped', reason: 'rows_already_materialized' };
  const settings = currentConfig(config);
  if (job.status === 'running' && job.locked_by) {
    const leaseMs = Math.max((config?.workerLeaseSeconds || 120) * 1000,
      Math.max(1000, settings.llmTimeoutMs || 45_000) + 30_000);
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    const retainedLease = database.run(`
      UPDATE jobs SET lease_until = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND locked_by = ?
    `, leaseUntil, new Date().toISOString(), job.id, job.locked_by);
    if (!retainedLease.changes) return { status: 'skipped', reason: 'lease_lost' };
  }
  const result = await proposePlanWithLlama({ rows, period: periodForPlan(plan), config: settings, fetchImpl });
  let proposed = 0;
  let retained = 0;
  let leaseLost = false;
  database.transaction(() => {
    if (job.status === 'running' && job.locked_by) {
      const current = database.get('SELECT status, locked_by FROM jobs WHERE id = ?', job.id);
      if (current?.status !== 'running' || current.locked_by !== job.locked_by) {
        leaseLost = true; return;
      }
    }
    const now = new Date().toISOString();
    const runId = recordRun(database, plan, result, {
      ...(result.output || {}), jobId: job.id, attemptKey,
      chunkIndex: payload.chunkIndex, chunkCount: payload.chunkCount,
      chunkInputSha256: payload.inputSha256, configurationHash: settingsHash(settings),
      rowKeys: rows.map((row) => row.sourceRowKey)
    }, now);
    const grouped = new Map();
    for (const item of result.output?.items || []) {
      if (!grouped.has(item.sourceRowKey)) grouped.set(item.sourceRowKey, []);
      grouped.get(item.sourceRowKey).push(item);
    }
    for (const [key, tasks] of grouped) {
      const original = rows.find((row) => row.sourceRowKey === key);
      const current = database.get(`
        SELECT psr.*, EXISTS(SELECT 1 FROM plan_source_row_items l WHERE l.source_row_id = psr.id) AS linked
        FROM plan_source_rows psr WHERE psr.id = ? AND psr.plan_id = ?
      `, original.id, plan.id);
      if (!current || current.linked || current.raw_text !== original.rawText
        || database.get('SELECT status FROM plans WHERE id = ?', plan.id)?.status !== 'active') {
        retained += tasks.length; continue;
      }
      const prior = parse(current.suggestion_json);
      const suggestion = {
        ...tasks[0], tasks,
        deterministic: prior.deterministic || (prior.llm ? {} : prior),
        llm: { promptVersion: PLAN_TASK.version, model: result.model || null,
          inputSha256: result.inputSha256, runId }
      };
      database.run(`
        UPDATE plan_source_rows SET suggestion_json = ?, updated_at = ? WHERE id = ?
      `, JSON.stringify(suggestion), now, current.id);
      proposed += tasks.length;
    }
  });
  logger?.info?.('optional plan parsing completed', {
    planId: plan.id, status: result.status, proposed, retained, error: result.error || null
  });
  // Optional failures are recorded here; the saved plan and document are intact.
  // Explicit reprocessing can retry the failed chunk without reuploading the source.
  return { status: leaseLost ? 'skipped' : result.status, proposed, retained,
    error: leaseLost ? 'lease_lost' : result.error || null };
}
