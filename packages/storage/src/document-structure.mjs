import { newId } from '../../core/src/ids.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

export function replaceDocumentBlocks(database, {
  documentVersionId,
  blocks,
  extractor,
  version,
  now = new Date().toISOString()
}) {
  const source = Array.isArray(blocks) ? blocks.filter((item) => String(item?.text || '').trim()) : [];
  database.run('DELETE FROM document_blocks WHERE document_version_id = ?', documentVersionId);
  let line = 1;
  source.forEach((item, index) => {
    const text = String(item.text || '').trim();
    const lineCount = Math.max(1, text.split('\n').length);
    const metadata = {
      ...(item.metadata || {}),
      textLineStart: line,
      textLineEnd: line + lineCount - 1
    };
    database.run(`
      INSERT INTO document_blocks(
        id, document_version_id, sequence_no, block_type, text,
        locator_json, geometry_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, newId('block'), documentVersionId, index + 1, item.type || 'paragraph', text,
    JSON.stringify(item.locator || {}), item.geometry ? JSON.stringify(item.geometry) : null,
    JSON.stringify(metadata), now);
    line += lineCount;
  });
  database.run(`
    UPDATE document_versions
    SET structure_status = ?, structure_extractor = ?, structure_version = ?
    WHERE id = ?
  `, source.length ? 'ready' : 'empty', extractor || null, version || null, documentVersionId);
  return source.length;
}

function rowsToBlocks(rows) {
  return rows.map((row) => ({
    id: row.id,
    sequence: row.sequence_no,
    type: row.block_type,
    text: row.text,
    locator: parseJson(row.locator_json, {}),
    geometry: parseJson(row.geometry_json, null),
    metadata: parseJson(row.metadata_json, {})
  }));
}

function resolveEvidenceBlocks(evidence, blocks) {
  const locator = evidence?.locator || {};
  if (locator.blockId && blocks.some((item) => item.id === locator.blockId)) return [locator.blockId];

  if (locator.sheet && locator.cell) {
    const match = blocks.find((item) => item.locator?.sheet === locator.sheet && item.locator?.cell === locator.cell);
    if (match) return [match.id];
  }
  if (locator.page && locator.line) {
    const match = blocks.find((item) => item.locator?.page === locator.page && item.locator?.line === locator.line);
    if (match) return [match.id];
  }

  const startLine = Number(locator.startLine || locator.line || 0);
  const endLine = Number(locator.endLine || startLine || 0);
  if (startLine) {
    const matches = blocks.filter((item) => {
      const start = Number(item.metadata?.textLineStart || 0);
      const end = Number(item.metadata?.textLineEnd || start);
      return start <= endLine && end >= startLine;
    });
    if (matches.length) return matches.map((item) => item.id);
  }

  const raw = normalized(evidence?.raw);
  if (raw) {
    const exact = blocks.find((item) => normalized(item.text).includes(raw) || raw.includes(normalized(item.text)));
    if (exact) return [exact.id];
  }
  return [];
}

function extractionRows(database, versionId, blocks) {
  const rows = database.all(`
    SELECT te.*, t.name AS template_name, t.document_type AS template_document_type, t.fields_json
    FROM template_extractions te
    JOIN document_templates t ON t.id = te.template_id
    WHERE te.document_version_id = ?
    ORDER BY te.created_at DESC
  `, versionId);
  return rows.map((row) => {
    const payload = parseJson(row.values_json, {});
    const machineValues = payload.values || {};
    const machineEvidence = payload.evidence || {};
    const overrides = database.all(`
      SELECT * FROM extraction_value_overrides
      WHERE template_extraction_id = ? AND superseded_at IS NULL
      ORDER BY created_at
    `, row.id);
    const values = { ...machineValues };
    const evidence = { ...machineEvidence };
    const overrideMap = {};
    for (const override of overrides) {
      values[override.field_key] = parseJson(override.value_json, null);
      evidence[override.field_key] = {
        ...(machineEvidence[override.field_key] || {}),
        locator: parseJson(override.locator_json, {}),
        manual: true,
        reason: override.reason,
        actor: override.actor,
        createdAt: override.created_at
      };
      overrideMap[override.field_key] = {
        id: override.id,
        reason: override.reason,
        actor: override.actor,
        createdAt: override.created_at
      };
    }
    const resolvedEvidence = Object.fromEntries(Object.entries(evidence).map(([key, item]) => [key, {
      ...item,
      blockIds: resolveEvidenceBlocks(item, blocks)
    }]));
    return {
      id: row.id,
      templateId: row.template_id,
      templateName: row.template_name,
      documentType: row.template_document_type,
      confidence: row.confidence,
      status: row.status,
      fields: parseJson(row.fields_json, []),
      machineValues,
      values,
      evidence: resolvedEvidence,
      overrides: overrideMap,
      missing: parseJson(row.missing_json, []).filter((item) => !overrideMap[item.key])
    };
  });
}

export function getDocumentStructure(database, workspaceId, documentId, {
  limit = 2000,
  offset = 0,
  page = null,
  sheet = null
} = {}) {
  const document = database.get(`
    SELECT d.id, d.title, d.document_type, d.status, d.current_version_id,
      dv.original_name, dv.detected_format, dv.processing_status, dv.structure_status,
      dv.structure_extractor, dv.structure_version, dv.uploaded_at
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
  if (!document) return null;

  const allBlocks = rowsToBlocks(database.all(`
    SELECT * FROM document_blocks
    WHERE document_version_id = ?
    ORDER BY sequence_no
  `, document.current_version_id));
  const pages = [...new Set(allBlocks.map((item) => item.locator?.page).filter(Boolean))].sort((a, b) => a - b);
  const sheets = [...new Set(allBlocks.map((item) => item.locator?.sheet).filter(Boolean))];
  const filtered = allBlocks.filter((item) => {
    if (page && Number(item.locator?.page) !== Number(page)) return false;
    if (sheet && item.locator?.sheet !== sheet) return false;
    return true;
  });
  const start = Math.max(0, Number(offset) || 0);
  const end = start + Math.min(5000, Math.max(1, Number(limit) || 2000));
  return {
    document,
    summary: {
      blockCount: allBlocks.length,
      pages,
      sheets,
      types: Object.fromEntries([...new Set(allBlocks.map((item) => item.type))]
        .map((type) => [type, allBlocks.filter((item) => item.type === type).length]))
    },
    blocks: filtered.slice(start, end),
    hasMore: filtered.length > end,
    extractions: extractionRows(database, document.current_version_id, allBlocks)
  };
}

export function setExtractionValueOverride(database, workspaceId, extractionId, fieldKey, {
  value,
  locator = {},
  reason = null,
  actor = 'operator'
}, now = new Date().toISOString()) {
  const extraction = database.get(`
    SELECT te.id, te.document_version_id, d.id AS document_id, t.fields_json
    FROM template_extractions te
    JOIN document_templates t ON t.id = te.template_id
    JOIN document_versions dv ON dv.id = te.document_version_id
    JOIN documents d ON d.id = dv.document_id
    WHERE te.id = ? AND d.workspace_id = ?
  `, extractionId, workspaceId);
  if (!extraction) return null;
  const knownField = parseJson(extraction.fields_json, []).some((field) => field.key === fieldKey);
  if (!knownField) return null;

  return database.transaction(() => {
    database.run(`
      UPDATE extraction_value_overrides
      SET superseded_at = ?
      WHERE template_extraction_id = ? AND field_key = ? AND superseded_at IS NULL
    `, now, extractionId, fieldKey);
    const id = newId('override');
    database.run(`
      INSERT INTO extraction_value_overrides(
        id, workspace_id, template_extraction_id, field_key, value_json,
        locator_json, reason, actor, created_at, superseded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `, id, workspaceId, extractionId, fieldKey, JSON.stringify(value), JSON.stringify(locator || {}),
    reason ? String(reason) : null, actor || 'operator', now);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, ?, 'template.value_overridden', 'template_extraction', ?, ?, ?)
    `, newId('audit'), workspaceId, actor || 'operator', extractionId,
    JSON.stringify({ fieldKey, value, locator, reason, documentId: extraction.document_id }), now);
    return {
      id,
      extractionId,
      fieldKey,
      value,
      locator,
      reason,
      actor: actor || 'operator',
      createdAt: now,
      documentId: extraction.document_id
    };
  });
}
