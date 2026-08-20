import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../../core/src/ids.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { registerDocument } from '../../storage/src/documents.mjs';
import { setObjectAccess } from '../../access-control/src/service.mjs';
import { writeZipArchive, rewriteZipArchive } from '../../plan-docx/src/archive.mjs';
import { DOCUMENT_XML, readDocumentXml } from '../../plan-docx/src/ooxml-shared.mjs';
import { listScienceLifecycleItems } from '../../science-lifecycle/src/service.mjs';

const FIELDS = {
  title: 'Название',
  kind: 'Вид',
  year: 'Год',
  authors: 'Авторы',
  unit: 'Подразделение',
  status: 'Этап',
  doi: 'DOI',
  venue: 'Издание/мероприятие',
  classifications: 'Классификации',
  evidence: 'Доказательства'
};
const DEFAULT_FIELDS = ['title','kind','year','authors','unit','status','doi','venue','classifications','evidence'];
const DOCX_MEDIA = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value, max = 4000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function runRow(database, workspaceId, runId) {
  const row = database.get(`
    SELECT srr.*, d.title AS generated_document_title, dv.original_name AS generated_original_name
    FROM science_report_runs srr
    LEFT JOIN documents d ON d.id = srr.generated_document_id
    LEFT JOIN document_versions dv ON dv.id = srr.generated_document_version_id
    WHERE srr.workspace_id = ? AND srr.id = ?
  `, workspaceId, runId);
  return row ? { ...row, filters: parseJson(row.filters_json), fields: parseJson(row.fields_json, []) } : null;
}

export function listScienceReportRuns(database, workspaceId, limit = 100) {
  return database.all(`SELECT id FROM science_report_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`,
    workspaceId, Math.max(1, Math.min(500, Number(limit) || 100))).map((item) => runRow(database, workspaceId, item.id));
}

export function getScienceReportRun(database, workspaceId, runId) {
  return runRow(database, workspaceId, runId);
}

function tableColumns(database, name) {
  if (!database.get(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`, name)) return new Set();
  return new Set(database.all(`PRAGMA table_info("${name}")`).map((item) => item.name));
}

function sourceDocuments(database, scientificItemId) {
  const columns = tableColumns(database, 'scientific_item_evidence');
  if (!columns.has('scientific_item_id') || !columns.has('document_version_id')) return [];
  return database.all(`
    SELECT DISTINCT d.id AS document_id, d.title, dv.original_name
    FROM scientific_item_evidence sie
    JOIN document_versions dv ON dv.id = sie.document_version_id
    JOIN documents d ON d.id = dv.document_id
    WHERE sie.scientific_item_id = ? ORDER BY d.title
  `, scientificItemId);
}

function supportingEvidence(database, workspaceId, scientificItemId) {
  return database.all(`
    SELECT sd.document_number, sd.document_date, sd.title, sd.document_version_id,
      dv.document_id, dv.original_name, sdl.relation_kind
    FROM supporting_document_links sdl
    JOIN supporting_documents sd ON sd.id = sdl.supporting_document_id
    LEFT JOIN document_versions dv ON dv.id = sd.document_version_id
    WHERE sdl.workspace_id = ? AND sdl.target_kind = 'scientific_item'
      AND sdl.target_id = ? AND sd.status = 'active'
    ORDER BY sd.document_date, sd.document_number
  `, workspaceId, scientificItemId);
}

function classificationMatch(item, value) {
  if (!value) return true;
  const target = String(value).toLocaleLowerCase('ru-RU');
  return (item.classifications || []).some((entry) => String(entry).toLocaleLowerCase('ru-RU').includes(target));
}

function rowFromItem(database, workspaceId, item) {
  const source = sourceDocuments(database, item.id);
  const supporting = supportingEvidence(database, workspaceId, item.id);
  const units = [...new Set((item.affiliations || []).map((entry) => entry.unit_name_snapshot || entry.unit_name).filter(Boolean))];
  return {
    scientificItemId: item.id,
    title: item.title,
    kind: item.kind,
    year: item.publication_year || (item.published_at ? Number(String(item.published_at).slice(0,4)) : null),
    authors: (item.authors || []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean).join('; '),
    unit: units.join('; '),
    status: item.lifecycle_status,
    doi: item.doi || '',
    venue: item.venue || item.target_venue || '',
    classifications: (item.classifications || []).join('; '),
    evidence: [
      ...source.map((document) => document.title || document.original_name),
      ...supporting.map((document) => `№ ${document.document_number} от ${document.document_date}`)
    ].join('; '),
    evidenceObjects: { sourceDocuments: source, supportingDocuments: supporting }
  };
}

export function scienceReportData(database, workspaceId, filters = {}, fields = DEFAULT_FIELDS) {
  const selectedFields = [...new Set((fields || DEFAULT_FIELDS).filter((field) => Object.hasOwn(FIELDS, field)))];
  if (!selectedFields.length) fail('science_report_fields_required');
  const items = listScienceLifecycleItems(database, workspaceId, {
    lifecycleStatus: filters.lifecycleStatus || null,
    unitId: filters.unitId || null,
    personId: filters.personId || null,
    yearFrom: filters.yearFrom || null,
    yearTo: filters.yearTo || null,
    limit: 5000
  }).filter((item) => (!filters.kind || item.kind === filters.kind) && classificationMatch(item, filters.classification));
  const rows = items.map((item) => rowFromItem(database, workspaceId, item));
  const byKind = {};
  const byStatus = {};
  const byClassification = {};
  for (const row of rows) {
    byKind[row.kind] = (byKind[row.kind] || 0) + 1;
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    for (const classification of String(row.classifications || '').split(';').map((value) => value.trim()).filter(Boolean)) {
      byClassification[classification] = (byClassification[classification] || 0) + 1;
    }
  }
  return {
    fields: selectedFields,
    headers: selectedFields.map((field) => ({ field, label: FIELDS[field] })),
    rows,
    summary: {
      total: rows.length,
      uniqueAuthors: new Set(rows.flatMap((row) => String(row.authors || '').split(';').map((value) => value.trim()).filter(Boolean))).size,
      byKind,
      byStatus,
      byClassification
    }
  };
}

function csvCell(value) {
  const result = String(value ?? '').replaceAll('"', '""');
  return `"${result}"`;
}

function csvContent(data) {
  return `\uFEFF${[
    data.headers.map((item) => csvCell(item.label)).join(';'),
    ...data.rows.map((row) => data.fields.map((field) => csvCell(row[field])).join(';'))
  ].join('\r\n')}`;
}

function xml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
}

function paragraph(value, { bold = false, size = 22 } = {}) {
  return `<w:p><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function cell(value, bold = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr>${paragraph(value, { bold, size: 18 })}</w:tc>`;
}

function scienceTableXml(data) {
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${data.headers.map((item) => cell(item.label, true)).join('')}</w:tr>`;
  const rows = data.rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${data.fields.map((field) => cell(row[field] ?? '')).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${header}${rows}</w:tbl>`;
}

function periodLabel(filters) {
  if (filters.yearFrom && filters.yearTo) return `${filters.yearFrom}–${filters.yearTo}`;
  if (filters.yearFrom) return `с ${filters.yearFrom}`;
  if (filters.yearTo) return `по ${filters.yearTo}`;
  return 'за всё время';
}

function builtInDocumentXml(title, filters, data) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph(title, { bold: true, size: 30 })}
${paragraph(`Период: ${periodLabel(filters)}`)}
${paragraph(`Всего материалов: ${data.summary.total}`)}
${scienceTableXml(data)}
${paragraph('Каждая строка отчёта связана с научной карточкой и доступными доказательствами.', { size: 18 })}
<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
</w:body></w:document>`;
}

async function templateSource(database, workspaceId, templateDocumentId) {
  if (!templateDocumentId) return null;
  const source = database.get(`
    SELECT d.id AS document_id, dv.id AS version_id, dv.detected_format,
      dv.original_name, fb.storage_path
    FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, templateDocumentId);
  if (!source) fail('science_report_template_not_found');
  if (source.detected_format !== 'docx') fail('science_report_template_not_docx');
  return source;
}

async function createDocx(database, workspaceId, title, filters, data, templateDocumentId, path) {
  const source = await templateSource(database, workspaceId, templateDocumentId);
  if (!source) {
    await writeZipArchive(path, {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': builtInDocumentXml(title, filters, data)
    });
    return null;
  }
  const original = await readDocumentXml(source.storage_path);
  if (!original.includes('{{SCIENCE_TABLE}}')) fail('science_report_template_placeholder_missing');
  const table = scienceTableXml(data);
  let generated = original.replace(/<w:p\b[^>]*>[\s\S]*?\{\{SCIENCE_TABLE\}\}[\s\S]*?<\/w:p>/u, table);
  if (generated === original) fail('science_report_template_placeholder_invalid');
  generated = generated
    .replaceAll('{{SCIENCE_TITLE}}', xml(title))
    .replaceAll('{{SCIENCE_PERIOD}}', xml(periodLabel(filters)))
    .replaceAll('{{SCIENCE_COUNT}}', String(data.summary.total));
  await rewriteZipArchive(source.storage_path, path, new Map([[DOCUMENT_XML, Buffer.from(generated, 'utf8')]]));
  return source;
}

function safeName(value, extension) {
  const base = String(value || 'Научный отчёт').replace(/[\\/:*?"<>|]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0,120) || 'Научный отчёт';
  return `${base}.${extension}`;
}

function reserve(database, workspaceId, input, actorPersonId, now) {
  const existing = database.get(`SELECT * FROM science_report_runs WHERE workspace_id = ? AND idempotency_key = ?`, workspaceId, input.idempotencyKey);
  if (existing) {
    if (existing.request_hash !== input.requestHash) fail('science_report_idempotency_conflict', { runId: existing.id });
    if (existing.status === 'completed') return { run: runRow(database, workspaceId, existing.id), duplicate: true };
    database.run(`UPDATE science_report_runs SET status = 'running', error_message = NULL, updated_at = ?, completed_at = NULL WHERE id = ?`, now, existing.id);
    return { run: runRow(database, workspaceId, existing.id), duplicate: false };
  }
  const id = newId('scireport');
  database.run(`
    INSERT INTO science_report_runs(
      id, workspace_id, idempotency_key, request_hash, title, format, filters_json,
      fields_json, template_document_version_id, status, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
  `, id, workspaceId, input.idempotencyKey, input.requestHash, input.title, input.format,
  JSON.stringify(input.filters), JSON.stringify(input.fields), input.templateVersionId || null,
  actorPersonId, now, now);
  return { run: runRow(database, workspaceId, id), duplicate: false };
}

export async function generateScienceReport(database, workspaceId, input = {}, config, actorPersonId = null) {
  const format = input.format === 'csv' ? 'csv' : input.format === 'docx' ? 'docx' : null;
  if (!format) fail('science_report_format_invalid');
  const title = text(input.title, 1000) || 'Отчёт о научной деятельности';
  const filters = input.filters || {};
  const data = scienceReportData(database, workspaceId, filters, input.fields || DEFAULT_FIELDS);
  const template = input.templateDocumentId ? await templateSource(database, workspaceId, input.templateDocumentId) : null;
  const idempotencyKey = text(input.idempotencyKey, 200);
  if (!idempotencyKey) fail('science_report_idempotency_required');
  const normalized = { title, format, filters, fields: data.fields, templateDocumentId: template?.document_id || null };
  const now = new Date().toISOString();
  const reserved = reserve(database, workspaceId, {
    idempotencyKey, requestHash: requestHash(normalized), title, format, filters,
    fields: data.fields, templateVersionId: template?.version_id || null
  }, actorPersonId, now);
  if (reserved.duplicate) return { ...reserved.run, duplicateRequest: true };
  const extension = format;
  const tempPath = join(config.tempDir, `science-report-${reserved.run.id}.${extension}`);
  try {
    await mkdir(config.tempDir, { recursive: true });
    await rm(tempPath, { force: true });
    if (format === 'csv') await writeFile(tempPath, csvContent(data), 'utf8');
    else await createDocx(database, workspaceId, title, filters, data, template?.document_id || null, tempPath);
    const mediaType = format === 'csv' ? 'text/csv; charset=utf-8' : DOCX_MEDIA;
    const blob = await storeGeneratedFile(tempPath, { blobDir: config.blobDir, mediaType });
    const registered = registerDocument(database, {
      workspaceId,
      title,
      originalName: safeName(title, extension),
      mediaType,
      detectedFormat: format,
      blob,
      requestedType: 'report',
      idempotencyKey: `science-report:${reserved.run.id}`
    });
    const completedAt = new Date().toISOString();
    database.transaction(() => {
      setObjectAccess(database, workspaceId, 'document', registered.documentId, {
        accessScope: actorPersonId ? 'restricted' : 'workspace',
        ownerPersonId: actorPersonId || null,
        grants: actorPersonId ? [{ personId: actorPersonId, role: 'owner' }] : []
      }, actorPersonId, completedAt);
      database.run(`
        UPDATE science_report_runs SET status = 'completed', row_count = ?, generated_document_id = ?,
          generated_document_version_id = ?, output_sha256 = ?, error_message = NULL,
          updated_at = ?, completed_at = ? WHERE id = ?
      `, data.rows.length, registered.documentId, registered.versionId, blob.sha256,
      completedAt, completedAt, reserved.run.id);
      database.run(`
        INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
        VALUES (?, ?, ?, 'science.report_generated', 'document', ?, ?, ?)
      `, newId('audit'), workspaceId, actorPersonId || 'operator', registered.documentId,
      JSON.stringify({ runId: reserved.run.id, format, filters, fields: data.fields, rowCount: data.rows.length,
        templateDocumentId: template?.document_id || null }), completedAt);
    });
    return { ...runRow(database, workspaceId, reserved.run.id), duplicateRequest: false, data };
  } catch (error) {
    const failedAt = new Date().toISOString();
    database.run(`UPDATE science_report_runs SET status = 'failed', error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      String(error?.code || error?.message || error), failedAt, failedAt, reserved.run.id);
    throw error;
  } finally {
    await rm(tempPath, { force: true });
  }
}
