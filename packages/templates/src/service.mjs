import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { applyTemplate, matchesTemplate, normalizeTemplateInput, textLines } from './extractor.mjs';
import { deleteTemplateDraft } from './drafts.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function createReview(database, workspaceId, versionId, templateId, missing, now) {
  if (!missing.length) return;
  const issueCode = `template_fields_missing:${templateId}`;
  const exists = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_id = ? AND issue_code = ? AND status = 'open'
  `, workspaceId, versionId, issueCode);
  if (exists) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, newId('review'), workspaceId, versionId, issueCode,
  'Шаблон не нашёл обязательные поля',
  `Не найдено полей: ${missing.map((item) => item.label).join(', ')}. Остальные значения сохранены.`,
  'Откройте документ, уточните подпись поля или подтвердите, что поле отсутствует.',
  JSON.stringify({ templateId, missing }), now);
}

function persistExtraction(database, {
  workspaceId,
  template,
  version,
  result,
  now = new Date().toISOString()
}) {
  const extractionId = newId('template_extract');
  const insert = database.run(`
    INSERT OR IGNORE INTO template_extractions(
      id, workspace_id, template_id, document_version_id, values_json,
      missing_json, confidence, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, extractionId, workspaceId, template.id, version.id,
  JSON.stringify({ values: result.values, evidence: result.evidence }),
  JSON.stringify(result.missing), result.confidence,
  result.missing.length ? 'needs_review' : 'completed', now);
  if (Number(insert.changes || 0) === 0) {
    return database.get('SELECT * FROM template_extractions WHERE template_id = ? AND document_version_id = ?', template.id, version.id);
  }

  database.run('UPDATE document_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?', now, template.id);
  const fields = parseJson(template.fields_json, []);
  const content = Object.entries(result.values)
    .map(([key, value]) => {
      const field = fields.find((item) => item.key === key);
      return `${field?.label || key}: ${String(value)}`;
    })
    .join('\n');
  if (content) {
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'template_extraction',
      sourceId: extractionId,
      documentVersionId: version.id,
      title: `${template.name} · ${version.original_name}`,
      content,
      locator: { kind: 'template', templateId: template.id, evidence: result.evidence }
    });
  }
  createReview(database, workspaceId, version.id, template.id, result.missing, now);
  return database.get('SELECT * FROM template_extractions WHERE id = ?', extractionId);
}

export function listTemplates(database, workspaceId) {
  return database.all(`
    SELECT t.*, d.title AS source_document_title,
      (SELECT COUNT(*) FROM json_each(t.fields_json)) AS field_count
    FROM document_templates t
    LEFT JOIN document_versions dv ON dv.id = t.source_document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE t.workspace_id = ?
    ORDER BY t.status = 'active' DESC, t.updated_at DESC
  `, workspaceId).map((row) => ({
    ...row,
    matcher: parseJson(row.matcher_json, {}),
    fields: parseJson(row.fields_json, [])
  }));
}

export function getTemplateSource(database, workspaceId, documentId) {
  const version = database.get(`
    SELECT dv.id AS version_id, dv.document_id, dv.original_name, dv.detected_format,
      dv.processing_status, dv.extracted_text, d.title
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
  if (!version) return null;
  return {
    ...version,
    lines: textLines(version.extracted_text || '').slice(0, 5000)
  };
}

export function previewTemplate(database, workspaceId, input) {
  const normalized = normalizeTemplateInput(input);
  const version = database.get(`
    SELECT dv.*, d.workspace_id, d.title
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE dv.id = ? AND d.workspace_id = ?
  `, input.documentVersionId, workspaceId);
  if (!version) return null;
  return {
    template: normalized,
    document: { id: version.document_id, versionId: version.id, title: version.title, originalName: version.original_name },
    result: applyTemplate({ matcher: normalized.matcher, fields: normalized.fields }, {
      text: version.extracted_text || '',
      originalName: version.original_name
    })
  };
}

export function createTemplate(database, workspaceId, input, now = new Date().toISOString()) {
  const normalized = normalizeTemplateInput(input);
  if (!normalized.name) throw new Error('template_name_required');
  if (!normalized.fields.length) throw new Error('template_fields_required');
  const source = database.get(`
    SELECT dv.*, d.workspace_id, d.title
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE dv.id = ? AND d.workspace_id = ?
  `, input.documentVersionId, workspaceId);
  if (!source) throw new Error('template_source_not_found');

  const id = newId('template');
  const code = normalized.code || `custom_${id.replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase()}`;
  database.run(`
    INSERT INTO document_templates(
      id, workspace_id, name, code, document_type, status, matcher_json,
      fields_json, source_document_version_id, version, usage_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, 0, ?, ?)
  `, id, workspaceId, normalized.name, code, normalized.documentType,
  JSON.stringify(normalized.matcher), JSON.stringify(normalized.fields), source.id, now, now);
  const template = database.get('SELECT * FROM document_templates WHERE id = ?', id);
  const result = applyTemplate(template, { text: source.extracted_text || '', originalName: source.original_name });
  persistExtraction(database, { workspaceId, template, version: source, result, now });
  database.run(`
    UPDATE documents SET document_type = ?, status = ?, updated_at = ? WHERE id = ?
  `, normalized.documentType, result.missing.length ? 'needs_review' : 'processed', now, source.document_id);
  database.run(`
    UPDATE document_versions SET processing_status = ? WHERE id = ?
  `, result.missing.length ? 'needs_review' : 'processed', source.id);
  deleteTemplateDraft(database, workspaceId, source.id);
  return {
    ...template,
    matcher: normalized.matcher,
    fields: normalized.fields,
    preview: result
  };
}

export function applyMatchingTemplates(database, {
  workspaceId,
  version,
  text,
  now = new Date().toISOString()
}) {
  const templates = database.all(`
    SELECT * FROM document_templates
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY version DESC, updated_at DESC
  `, workspaceId);
  const applied = [];
  for (const template of templates) {
    if (!matchesTemplate(template, { text, originalName: version.original_name })) continue;
    const result = applyTemplate(template, { text, originalName: version.original_name });
    const extraction = persistExtraction(database, { workspaceId, template, version, result, now });
    applied.push({ template, result, extraction });
  }
  return applied.sort((a, b) => b.result.confidence - a.result.confidence);
}
