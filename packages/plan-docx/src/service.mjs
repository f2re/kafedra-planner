import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../../core/src/ids.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { registerDocument } from '../../storage/src/documents.mjs';
import { explainObjectAccess, setObjectAccess } from '../../access-control/src/service.mjs';
import { analyzePlanDocumentXml, validatePlanTemplateConfig } from './analyzer.mjs';
import { DOCUMENT_XML, readDocumentXml } from './ooxml-shared.mjs';
import { generatePlanDocumentXml, normalizeTargetPeriod } from './generator.mjs';
import { rewriteZipArchive } from './archive.mjs';

const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const RUN_STALE_MS = 5 * 60 * 1000;

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function error(code, details = null) {
  const result = new Error(code);
  result.code = code;
  result.details = details;
  return result;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function templateRow(row) {
  if (!row) return null;
  return {
    ...row,
    config: parseJson(row.config_json, {}),
    analysis: parseJson(row.analysis_json, {})
  };
}

function generationRow(row) {
  if (!row) return null;
  return { ...row, input: parseJson(row.input_json, {}) };
}

function sourceByDocument(database, workspaceId, documentId) {
  return database.get(`
    SELECT d.id AS document_id, d.title, d.document_type,
      dv.id AS version_id, dv.original_name, dv.detected_format, dv.processing_status,
      dv.blob_sha256, fb.storage_path, fb.size_bytes
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId) || null;
}

function templateSource(database, workspaceId, templateId) {
  const row = database.get(`
    SELECT t.*, d.id AS source_document_id, d.title AS source_document_title,
      dv.original_name, dv.detected_format, dv.processing_status,
      dv.blob_sha256, fb.storage_path, fb.size_bytes
    FROM plan_document_templates t
    JOIN document_versions dv ON dv.id = t.source_document_version_id
    JOIN documents d ON d.id = dv.document_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE t.workspace_id = ? AND t.id = ?
  `, workspaceId, templateId);
  return templateRow(row);
}

function assertDocx(source) {
  if (!source) throw error('plan_template_source_not_found');
  if (source.detected_format !== 'docx') throw error('plan_template_source_not_docx');
}

export async function analyzePlanTemplate(database, workspaceId, documentId, input = {}) {
  const source = sourceByDocument(database, workspaceId, documentId);
  assertDocx(source);
  const xml = await readDocumentXml(source.storage_path);
  const analysis = analyzePlanDocumentXml(xml, { planKind: input.planKind || 'organization' });
  return {
    source: {
      documentId: source.document_id,
      versionId: source.version_id,
      title: source.title,
      originalName: source.original_name,
      sha256: source.blob_sha256
    },
    ...analysis
  };
}

export async function createPlanTemplate(database, workspaceId, input, actorPersonId = null, now = new Date().toISOString()) {
  if (!String(input?.name || '').trim()) throw error('plan_template_name_required');
  const source = sourceByDocument(database, workspaceId, input.documentId);
  assertDocx(source);
  const xml = await readDocumentXml(source.storage_path);
  const analysis = analyzePlanDocumentXml(xml, { planKind: input.planKind || 'organization' });
  let config = input.config || analysis.suggestedConfig;
  if (!config) throw error('plan_template_review_required', analysis);
  config = {
    ...config,
    planKind: input.planKind || config.planKind || analysis.planKind,
    periodKind: config.periodKind || analysis.detectedPeriod?.kind
  };
  try { config = validatePlanTemplateConfig(xml, config); }
  catch (cause) { throw error(String(cause?.message || cause), analysis); }
  if (!input.config && !analysis.ready) throw error('plan_template_review_required', analysis);

  const id = newId('plantpl');
  try {
    database.run(`
      INSERT INTO plan_document_templates(
        id, workspace_id, source_document_version_id, name, plan_kind, period_kind,
        status, config_json, analysis_json, created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `, id, workspaceId, source.version_id, String(input.name).trim(), config.planKind, config.periodKind,
    JSON.stringify(config), JSON.stringify(analysis), actorPersonId, now, now);
  } catch (cause) {
    if (String(cause?.message || cause).includes('UNIQUE')) throw error('plan_template_already_exists');
    throw cause;
  }
  return getPlanDocumentTemplate(database, workspaceId, id);
}

export function listPlanDocumentTemplates(database, workspaceId, { status = 'active', limit = 300 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 300));
  const params = [workspaceId];
  const where = ['t.workspace_id = ?'];
  if (status) { where.push('t.status = ?'); params.push(status); }
  params.push(safeLimit);
  return database.all(`
    SELECT t.*, d.id AS source_document_id, d.title AS source_document_title,
      dv.original_name, dv.blob_sha256,
      COUNT(r.id) AS generation_count,
      MAX(r.started_at) AS last_generated_at
    FROM plan_document_templates t
    JOIN document_versions dv ON dv.id = t.source_document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN plan_generation_runs r ON r.template_id = t.id AND r.status = 'completed'
    WHERE ${where.join(' AND ')}
    GROUP BY t.id
    ORDER BY t.updated_at DESC
    LIMIT ?
  `, ...params).map(templateRow);
}

export function getPlanDocumentTemplate(database, workspaceId, templateId) {
  const row = database.get(`
    SELECT t.*, d.id AS source_document_id, d.title AS source_document_title,
      dv.original_name, dv.blob_sha256,
      COUNT(r.id) AS generation_count,
      MAX(r.started_at) AS last_generated_at
    FROM plan_document_templates t
    JOIN document_versions dv ON dv.id = t.source_document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN plan_generation_runs r ON r.template_id = t.id AND r.status = 'completed'
    WHERE t.workspace_id = ? AND t.id = ?
    GROUP BY t.id
  `, workspaceId, templateId);
  return templateRow(row);
}

export function listPlanGenerationRuns(database, workspaceId, templateId, limit = 50) {
  return database.all(`
    SELECT r.*, d.title AS generated_document_title, dv.processing_status
    FROM plan_generation_runs r
    LEFT JOIN documents d ON d.id = r.generated_document_id
    LEFT JOIN document_versions dv ON dv.id = r.generated_document_version_id
    WHERE r.workspace_id = ? AND r.template_id = ?
    ORDER BY r.started_at DESC LIMIT ?
  `, workspaceId, templateId, Math.max(1, Math.min(200, Number(limit) || 50))).map(generationRow);
}

function reserveGeneration(database, {
  workspaceId, templateId, idempotencyKey, hash, targetPeriod, input, actorPersonId, now
}) {
  return database.transaction(() => {
    const existing = database.get(`
      SELECT * FROM plan_generation_runs WHERE workspace_id = ? AND idempotency_key = ?
    `, workspaceId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== hash || existing.template_id !== templateId) {
        throw error('plan_generation_idempotency_conflict', { runId: existing.id });
      }
      if (existing.status === 'completed' && existing.generated_document_id) {
        return { run: generationRow(existing), duplicate: true };
      }
      const age = Date.now() - new Date(existing.updated_at).getTime();
      if (existing.status === 'running' && Number.isFinite(age) && age < RUN_STALE_MS) {
        throw error('plan_generation_in_progress', { runId: existing.id });
      }
      database.run(`
        UPDATE plan_generation_runs
        SET status = 'running', error_message = NULL, started_at = ?, updated_at = ?, completed_at = NULL
        WHERE id = ?
      `, now, now, existing.id);
      return { run: generationRow({ ...existing, status: 'running', started_at: now, updated_at: now }), duplicate: false };
    }
    const runId = newId('plangen');
    database.run(`
      INSERT INTO plan_generation_runs(
        id, workspace_id, template_id, idempotency_key, request_hash,
        target_period_kind, target_period_key, input_json, status,
        created_by_person_id, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `, runId, workspaceId, templateId, idempotencyKey, hash,
    targetPeriod.periodKind, targetPeriod.periodKey, JSON.stringify(input), actorPersonId, now, now);
    return { run: generationRow(database.get('SELECT * FROM plan_generation_runs WHERE id = ?', runId)), duplicate: false };
  });
}

function completedGeneration(database, workspaceId, runId, duplicateRequest = false) {
  const row = database.get(`
    SELECT r.*, d.title AS generated_document_title, dv.processing_status
    FROM plan_generation_runs r
    LEFT JOIN documents d ON d.id = r.generated_document_id
    LEFT JOIN document_versions dv ON dv.id = r.generated_document_version_id
    WHERE r.workspace_id = ? AND r.id = ?
  `, workspaceId, runId);
  return row ? { ...generationRow(row), duplicateRequest } : null;
}

function copyDocumentAccess(database, workspaceId, sourceDocumentId, generatedDocumentId, actorPersonId, now) {
  const source = explainObjectAccess(database, workspaceId, 'document', sourceDocumentId);
  const grants = source.grants.map((grant) => ({ personId: grant.person_id, role: grant.access_role }));
  if (actorPersonId && source.policy?.owner_person_id !== actorPersonId && !grants.some((grant) => grant.personId === actorPersonId)) {
    grants.push({ personId: actorPersonId, role: 'editor' });
  }
  setObjectAccess(database, workspaceId, 'document', generatedDocumentId, {
    accessScope: source.policy?.access_scope || 'restricted',
    ownerPersonId: source.policy?.owner_person_id || actorPersonId || null,
    grants
  }, actorPersonId, now);
}

function fileName(value) {
  const base = String(value || 'План').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'План';
  return `${base}.docx`;
}

export async function generatePlanDocument(database, workspaceId, templateId, input, config, actorPersonId = null) {
  const template = templateSource(database, workspaceId, templateId);
  if (!template) throw error('plan_template_not_found');
  if (template.status !== 'active') throw error('plan_template_inactive');
  assertDocx(template);
  const idempotencyKey = String(input?.idempotencyKey || '').trim();
  if (!idempotencyKey) throw error('plan_generation_idempotency_key_required');
  if (idempotencyKey.length > 200) throw error('plan_generation_idempotency_key_invalid');
  const xml = await readDocumentXml(template.storage_path);
  const targetPeriod = normalizeTargetPeriod(input.targetPeriod || {}, template.config.periodKind);
  const normalizedInput = {
    templateId,
    targetPeriod,
    title: String(input.title || '').trim() || null,
    items: input.items
  };
  const hash = requestHash(normalizedInput);
  let generated;
  try {
    generated = generatePlanDocumentXml(xml, {
      config: template.config,
      targetPeriod,
      items: input.items
    });
  } catch (cause) {
    throw error(String(cause?.message || cause));
  }
  const now = new Date().toISOString();
  const reserved = reserveGeneration(database, {
    workspaceId, templateId, idempotencyKey, hash, targetPeriod,
    input: normalizedInput, actorPersonId, now
  });
  if (reserved.duplicate) return completedGeneration(database, workspaceId, reserved.run.id, true);

  const tempPath = join(config.tempDir, `generated-plan-${reserved.run.id}.docx`);
  try {
    await mkdir(config.tempDir, { recursive: true });
    await rm(tempPath, { force: true });
    await rewriteZipArchive(template.storage_path, tempPath, new Map([
      [DOCUMENT_XML, Buffer.from(generated.xml, 'utf8')]
    ]));
    const blob = await storeGeneratedFile(tempPath, { blobDir: config.blobDir, mediaType: DOCX_MEDIA_TYPE });
    const title = normalizedInput.title || `${template.name} · ${targetPeriod.periodKey}`;
    const originalName = fileName(title);
    const registered = registerDocument(database, {
      workspaceId,
      title,
      originalName,
      mediaType: DOCX_MEDIA_TYPE,
      detectedFormat: 'docx',
      blob,
      requestedType: `${template.plan_kind}_plan`,
      idempotencyKey: `plan-generation:${reserved.run.id}`
    });
    const completedAt = new Date().toISOString();
    database.transaction(() => {
      copyDocumentAccess(database, workspaceId, template.source_document_id, registered.documentId, actorPersonId, completedAt);
      database.run(`
        UPDATE plan_generation_runs
        SET status = 'completed', generated_document_id = ?, generated_document_version_id = ?,
          output_sha256 = ?, error_message = NULL, updated_at = ?, completed_at = ?
        WHERE id = ?
      `, registered.documentId, registered.versionId, blob.sha256, completedAt, completedAt, reserved.run.id);
      database.run(`
        INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
        VALUES (?, ?, ?, 'plan.generated', 'document', ?, ?, ?)
      `, newId('audit'), workspaceId, actorPersonId || 'operator', registered.documentId,
      JSON.stringify({
        templateId, sourceDocumentId: template.source_document_id, generationRunId: reserved.run.id,
        targetPeriod, itemCount: generated.itemCount, outputSha256: blob.sha256
      }), completedAt);
    });
    return completedGeneration(database, workspaceId, reserved.run.id, false);
  } catch (cause) {
    const failedAt = new Date().toISOString();
    database.run(`
      UPDATE plan_generation_runs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?
    `, String(cause?.message || cause), failedAt, reserved.run.id);
    throw cause;
  } finally {
    await rm(tempPath, { force: true });
  }
}
