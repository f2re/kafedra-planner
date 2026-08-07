import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { newId } from '../../core/src/ids.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { registerDocument } from '../../storage/src/documents.mjs';
import { analyzePlanTable } from './extractor.mjs';
import { generateDocxFromPlanTemplate } from './docx-generator.mjs';
import { planScopeLabel, setPlanIngestHint } from './service.mjs';

const SCOPES = new Set(['department', 'faculty', 'personal', 'unit', 'organization']);
const PERIOD_KINDS = new Set(['calendar_year', 'academic_year']);

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function blockRows(database, versionId) {
  return database.all(`
    SELECT block_type, text, locator_json, metadata_json
    FROM document_blocks
    WHERE document_version_id = ?
    ORDER BY sequence_no
  `, versionId).map((row) => ({
    type: row.block_type,
    text: row.text,
    locator: parseJson(row.locator_json, {}),
    metadata: parseJson(row.metadata_json, {})
  }));
}

function detectYearToken(text) {
  const source = String(text || '');
  for (const placeholder of ['{{academic_year}}', '{{учебный_год}}', '{{year}}', '{{YEAR}}', '{{год}}']) {
    if (source.includes(placeholder)) return placeholder;
  }
  const academic = source.match(/\b20\d{2}\s*[/–—-]\s*(?:20\d{2}|\d{2})\b/u);
  if (academic) return academic[0];
  const calendar = source.match(/\b(20\d{2})\b/u);
  return calendar ? calendar[1] : null;
}

function locateYear(blocks, token) {
  if (!token) return {};
  const block = blocks.find((item) => String(item.text || '').includes(token));
  return block?.locator || {};
}

function serializeTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    columnMap: parseJson(row.column_map_json, {}),
    yearLocator: parseJson(row.year_locator_json, {})
  };
}

function getTemplateSource(database, workspaceId, documentId) {
  return database.get(`
    SELECT d.id AS document_id, d.title, d.current_version_id,
      dv.original_name, dv.detected_format, dv.processing_status, dv.structure_status,
      dv.extracted_text, fb.storage_path, fb.size_bytes
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
}

export function analyzePlanTemplate(database, workspaceId, documentId) {
  const source = getTemplateSource(database, workspaceId, documentId);
  if (!source) throw new Error('plan_template_document_not_found');
  if (source.detected_format !== 'docx') throw new Error('plan_template_docx_required');
  if (!['processed', 'needs_review'].includes(source.processing_status) || source.structure_status !== 'ready') {
    throw new Error('plan_template_not_ready');
  }
  const blocks = blockRows(database, source.current_version_id);
  const table = analyzePlanTable(blocks);
  if (!table) throw new Error('plan_template_table_not_found');
  const yearToken = detectYearToken(source.extracted_text);
  return {
    documentId: source.document_id,
    documentVersionId: source.current_version_id,
    title: source.title,
    originalName: source.original_name,
    yearToken,
    yearLocator: locateYear(blocks, yearToken),
    tableIndex: table.tableIndex,
    headerRow: table.headerRow,
    sampleRow: table.sampleRow,
    columnMap: table.columnMap,
    confidence: Math.min(1, 0.55 + Math.min(0.3, table.score * 0.04) + (yearToken ? 0.15 : 0)),
    warnings: [
      !yearToken ? 'Не найден год или заполнитель года.' : null,
      !table.columnMap.date && !table.columnMap.due ? 'Не найден столбец даты или срока.' : null
    ].filter(Boolean)
  };
}

function snapshot(template) {
  return {
    name: template.name,
    planScope: template.plan_scope,
    periodKind: template.period_kind,
    yearToken: template.year_token,
    yearLocator: parseJson(template.year_locator_json, {}),
    tableIndex: template.table_index,
    headerRow: template.header_row,
    sampleRow: template.sample_row,
    columnMap: parseJson(template.column_map_json, {}),
    status: template.status
  };
}

function saveRevision(database, template, now) {
  database.run(`
    INSERT OR IGNORE INTO plan_template_revisions(id, template_id, version, config_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, newId('plantplrev'), template.id, template.version, JSON.stringify(snapshot(template)), now);
}

export function savePlanTemplate(database, workspaceId, body, now = new Date().toISOString()) {
  const documentId = String(body.documentId || '').trim();
  const analysis = analyzePlanTemplate(database, workspaceId, documentId);
  const name = String(body.name || analysis.title || 'Шаблон плана').trim();
  if (!name) throw new Error('plan_template_name_required');
  const planScope = SCOPES.has(body.planScope) ? body.planScope : 'department';
  const periodKind = PERIOD_KINDS.has(body.periodKind) ? body.periodKind : 'calendar_year';
  const yearToken = String(body.yearToken ?? analysis.yearToken ?? '').trim() || null;
  if (!yearToken) throw new Error('plan_template_year_required');
  const tableIndex = Number(body.tableIndex || analysis.tableIndex);
  const headerRow = Number(body.headerRow || analysis.headerRow);
  const sampleRow = Number(body.sampleRow || analysis.sampleRow);
  const columnMap = body.columnMap && typeof body.columnMap === 'object' ? body.columnMap : analysis.columnMap;
  if (!Number.isInteger(tableIndex) || tableIndex < 1 || !Number.isInteger(headerRow) || headerRow < 1 || !Number.isInteger(sampleRow) || sampleRow < 1) {
    throw new Error('plan_template_table_invalid');
  }
  if (!Number(columnMap?.title) || (!Number(columnMap?.date) && !Number(columnMap?.due))) {
    throw new Error('plan_template_columns_required');
  }
  const current = database.get(`
    SELECT * FROM plan_templates
    WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, analysis.documentVersionId);
  if (!current) {
    const id = newId('plantpl');
    database.run(`
      INSERT INTO plan_templates(
        id, workspace_id, name, source_document_version_id, plan_scope, period_kind,
        year_token, year_locator_json, table_index, header_row, sample_row,
        column_map_json, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
    `, id, workspaceId, name, analysis.documentVersionId, planScope, periodKind,
    yearToken, JSON.stringify(body.yearLocator || analysis.yearLocator || {}),
    tableIndex, headerRow, sampleRow, JSON.stringify(columnMap), now, now);
    const created = database.get('SELECT * FROM plan_templates WHERE id = ?', id);
    saveRevision(database, created, now);
    return serializeTemplate(created);
  }
  const nextVersion = Number(current.version) + 1;
  database.run(`
    UPDATE plan_templates
    SET name = ?, plan_scope = ?, period_kind = ?, year_token = ?, year_locator_json = ?,
      table_index = ?, header_row = ?, sample_row = ?, column_map_json = ?,
      status = 'active', version = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `, name, planScope, periodKind, yearToken,
  JSON.stringify(body.yearLocator || analysis.yearLocator || {}),
  tableIndex, headerRow, sampleRow, JSON.stringify(columnMap),
  nextVersion, now, current.id, workspaceId);
  const updated = database.get('SELECT * FROM plan_templates WHERE id = ?', current.id);
  saveRevision(database, updated, now);
  return serializeTemplate(updated);
}

export function listPlanTemplates(database, workspaceId) {
  return database.all(`
    SELECT pt.*, dv.document_id AS source_document_id, dv.original_name
    FROM plan_templates pt
    JOIN document_versions dv ON dv.id = pt.source_document_version_id
    WHERE pt.workspace_id = ? AND pt.status = 'active'
    ORDER BY pt.updated_at DESC, pt.name
  `, workspaceId).map(serializeTemplate);
}

export function getPlanTemplate(database, workspaceId, templateId) {
  const row = database.get(`
    SELECT pt.*, dv.document_id AS source_document_id, dv.original_name,
      dv.detected_format, fb.storage_path, fb.size_bytes
    FROM plan_templates pt
    JOIN document_versions dv ON dv.id = pt.source_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE pt.workspace_id = ? AND pt.id = ?
  `, workspaceId, templateId);
  if (!row) return null;
  return {
    ...serializeTemplate(row),
    revisions: database.all(`
      SELECT version, config_json, created_at
      FROM plan_template_revisions WHERE template_id = ? ORDER BY version DESC
    `, templateId).map((revision) => ({
      version: revision.version,
      config: parseJson(revision.config_json, {}),
      createdAt: revision.created_at
    }))
  };
}

function normalizePeriod(periodKind, rawValue) {
  const raw = String(rawValue || '').trim();
  if (periodKind === 'calendar_year') {
    const match = raw.match(/\b(20\d{2})\b/);
    if (!match) throw new Error('plan_generation_year_invalid');
    return match[1];
  }
  const match = raw.match(/\b(20\d{2})(?:\s*[/–—-]\s*(20\d{2}|\d{2}))?\b/);
  if (!match) throw new Error('plan_generation_year_invalid');
  const start = Number(match[1]);
  const end = match[2]
    ? (Number(match[2]) < 100 ? Math.floor(start / 100) * 100 + Number(match[2]) : Number(match[2]))
    : start + 1;
  if (end !== start + 1) throw new Error('plan_generation_academic_year_invalid');
  return `${start}/${String(end).slice(-2)}`;
}

function isoOrNull(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) throw new Error('plan_generation_date_invalid');
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('plan_generation_date_invalid');
  }
  return text;
}

function sanitizeItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('plan_generation_items_required');
  return items.map((item, index) => {
    const title = String(item?.title || '').trim();
    if (!title) throw new Error('plan_generation_item_title_required');
    return {
      number: String(item.number || item.itemNo || index + 1),
      title,
      startsAt: isoOrNull(item.startsAt),
      endsAt: isoOrNull(item.endsAt),
      dueDate: isoOrNull(item.dueDate),
      responsible: String(item.responsible || item.responsibleRaw || '').trim(),
      result: String(item.result || item.expectedResult || '').trim(),
      direction: String(item.direction || '').trim()
    };
  });
}

function safeFileBase(value) {
  const cleaned = String(value || 'План').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 120) || 'План';
}

function generationResult(database, workspaceId, row) {
  if (!row) return null;
  return database.get(`
    SELECT pg.id AS generation_id, pg.template_id, pg.period_key, pg.plan_scope,
      pg.generated_document_version_id AS version_id,
      dv.document_id, dv.processing_status AS status, dv.original_name
    FROM plan_generations pg
    JOIN document_versions dv ON dv.id = pg.generated_document_version_id
    WHERE pg.workspace_id = ? AND pg.id = ?
  `, workspaceId, row.id);
}

export async function generatePlanFromTemplate(database, workspaceId, templateId, body, config) {
  const template = getPlanTemplate(database, workspaceId, templateId);
  if (!template) throw new Error('plan_template_not_found');
  if (template.detected_format !== 'docx') throw new Error('plan_template_docx_required');
  const planScope = SCOPES.has(body.planScope) ? body.planScope : template.plan_scope;
  const periodKind = PERIOD_KINDS.has(body.periodKind) ? body.periodKind : template.period_kind;
  const periodKey = normalizePeriod(periodKind, body.periodKey || body.year);
  const items = sanitizeItems(body.items);
  const ownerPersonId = body.ownerPersonId ? String(body.ownerPersonId) : null;
  const payload = { planScope, periodKind, periodKey, ownerPersonId, items };
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const supplied = String(body.idempotencyKey || '').trim();
  const requestKey = `plan:${workspaceId}:${templateId}:${supplied || payloadHash}`;
  const existing = database.get('SELECT * FROM plan_generations WHERE request_key = ?', requestKey);
  if (existing) return { ...generationResult(database, workspaceId, existing), duplicateRequest: true };

  await mkdir(config.tempDir, { recursive: true });
  const targetPath = join(config.tempDir, `plan-${randomUUID()}.docx`);
  try {
    const templateForGenerator = {
      ...template,
      columnMap: template.columnMap
    };
    const generation = await generateDocxFromPlanTemplate({
      sourcePath: template.storage_path,
      targetPath,
      template: templateForGenerator,
      periodKey,
      items,
      maxBytes: Math.min(256 * 1024 * 1024, Math.max(config.maxUploadBytes || 32 * 1024 * 1024, 32 * 1024 * 1024) * 4)
    });
    const mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = await storeGeneratedFile(targetPath, { blobDir: config.blobDir, mediaType });
    const title = String(body.title || `${planScopeLabel(planScope)} ${periodKey}`).trim();
    const originalName = basename(`${safeFileBase(title)}.docx`);
    const now = new Date().toISOString();
    let registered;
    let generationId;
    database.transaction(() => {
      registered = registerDocument(database, {
        workspaceId,
        title,
        originalName,
        mediaType,
        detectedFormat: 'docx',
        blob,
        requestedType: `${planScope}_plan`,
        idempotencyKey: `generated:${requestKey}`
      });
      if (registered.jobId && !registered.duplicateRequest) {
        database.run("UPDATE jobs SET kind = 'process_plan_document' WHERE id = ?", registered.jobId);
      }
      setPlanIngestHint(database, {
        workspaceId,
        documentVersionId: registered.versionId,
        planScope,
        periodKind,
        periodKey,
        ownerPersonId,
        sourceTemplateId: templateId,
        now
      });
      generationId = newId('plangen');
      database.run(`
        INSERT INTO plan_generations(
          id, workspace_id, template_id, generated_document_version_id, request_key,
          plan_scope, period_kind, period_key, owner_person_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, generationId, workspaceId, templateId, registered.versionId, requestKey,
      planScope, periodKind, periodKey, ownerPersonId,
      JSON.stringify({ ...payload, title, generator: generation }), now);
    });
    return {
      generationId,
      templateId,
      documentId: registered.documentId,
      versionId: registered.versionId,
      status: registered.status,
      originalName,
      periodKey,
      planScope,
      duplicateRequest: Boolean(registered.duplicateRequest),
      generation
    };
  } finally {
    await rm(targetPath, { force: true });
  }
}
