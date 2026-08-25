import { createHash } from 'node:crypto';
import { newId } from '../../core/src/ids.mjs';
import { createScientificItem } from '../../science/src/service.mjs';
import { updateScienceEditorial } from '../../science-lifecycle/src/service.mjs';
import { analyzeRows, cellFrom, sourceRows } from './parser.mjs';

const KINDS = new Set(['article','conference','grant','patent','project','research_report','other']);
const STATUSES = new Set(['idea','drafting','submitted','revision','accepted','published','rejected','archived']);

function fail(code, details = null) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

function text(value, max = 4000) {
  const result = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return result ? result.slice(0, max) : null;
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeDoi(value) {
  return text(value, 500)?.toLocaleLowerCase('ru-RU')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '')
    .replace(/^doi\s*:\s*/u, '') || null;
}

function normalizeTitle(value) {
  return text(value, 1000)?.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || '';
}

function date(value, field) {
  const raw = String(value || '').slice(0, 10);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('science_import_date_invalid', { field, value });
  }
  return raw;
}

function year(value) {
  if (!value) return null;
  const match = String(value).match(/(?:19|20|21)\d{2}/u);
  const result = Number(match?.[0]);
  if (!Number.isInteger(result) || result < 1900 || result > 2200) fail('science_import_year_invalid', { value });
  return result;
}

function splitAuthors(value) {
  return String(value || '').split(/\r?\n|\s*;\s*|\s+\|\s+/u).map((item) => text(item, 500)).filter(Boolean);
}

function splitClassifications(value) {
  return [...new Set(String(value || '').split(/[,;|]/u).map((item) => text(item, 200)).filter(Boolean))];
}

function kind(value) {
  const raw = text(value, 200)?.toLocaleLowerCase('ru-RU') || '';
  const mapped = {
    'статья': 'article', 'article': 'article',
    'конференция': 'conference', 'доклад': 'conference', 'conference': 'conference',
    'грант': 'grant', 'grant': 'grant',
    'патент': 'patent', 'patent': 'patent',
    'проект': 'project', 'project': 'project',
    'отчёт нир': 'research_report', 'отчет нир': 'research_report', 'research report': 'research_report'
  }[raw] || raw;
  return KINDS.has(mapped) ? mapped : (raw ? 'other' : 'article');
}

function lifecycle(value, publicationYear, doi) {
  const raw = text(value, 200)?.toLocaleLowerCase('ru-RU') || '';
  const mapped = {
    'замысел': 'idea', 'идея': 'idea', 'idea': 'idea',
    'готовится': 'drafting', 'подготовка': 'drafting', 'drafting': 'drafting',
    'подано': 'submitted', 'отправлено': 'submitted', 'submitted': 'submitted',
    'доработка': 'revision', 'revision': 'revision',
    'принято': 'accepted', 'accepted': 'accepted',
    'опубликовано': 'published', 'published': 'published',
    'отклонено': 'rejected', 'rejected': 'rejected',
    'архив': 'archived', 'archived': 'archived'
  }[raw] || raw;
  if (STATUSES.has(mapped)) return mapped;
  return publicationYear || doi ? 'published' : 'idea';
}

function source(database, workspaceId, documentId) {
  return database.get(`
    SELECT d.id AS document_id, d.title, dv.id AS version_id, dv.original_name,
      dv.detected_format, dv.processing_status, fb.storage_path, fb.sha256
    FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId) || null;
}

export async function analyzeScienceImport(database, workspaceId, documentId) {
  const item = source(database, workspaceId, documentId);
  if (!item) fail('science_import_document_not_found');
  if (!['processed','needs_review'].includes(item.processing_status)) fail('science_import_document_not_ready');
  const rows = await sourceRows(database, item);
  const analysis = analyzeRows(rows);
  return {
    source: {
      documentId: item.document_id,
      versionId: item.version_id,
      originalName: item.original_name,
      format: item.detected_format,
      sha256: item.sha256
    },
    headers: analysis.headers,
    rowCount: analysis.rows.length,
    suggestedMapping: analysis.suggestedMapping,
    ready: analysis.ready,
    preview: analysis.preview
  };
}

function runRow(database, workspaceId, runId) {
  const row = database.get(`
    SELECT sir.*, d.id AS source_document_id, dv.original_name
    FROM science_import_runs sir
    LEFT JOIN document_versions dv ON dv.id = sir.source_document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE sir.workspace_id = ? AND sir.id = ?
  `, workspaceId, runId);
  if (!row) return null;
  return {
    ...row,
    mapping: parseJson(row.mapping_json),
    options: parseJson(row.options_json),
    rows: database.all(`SELECT * FROM science_import_rows WHERE run_id = ? ORDER BY row_no`, runId)
      .map((item) => ({ ...item, source: parseJson(item.source_json), normalized: parseJson(item.normalized_json, null) }))
  };
}

export function getScienceImportRun(database, workspaceId, runId) {
  return runRow(database, workspaceId, runId);
}

export function listScienceImportRuns(database, workspaceId, limit = 100) {
  return database.all(`SELECT id FROM science_import_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`,
    workspaceId, Math.max(1, Math.min(500, Number(limit) || 100))).map((item) => runRow(database, workspaceId, item.id));
}

function normalizeRow(row, mapping) {
  const publicationYear = year(cellFrom(row, mapping, 'publicationYear'));
  const doi = normalizeDoi(cellFrom(row, mapping, 'doi'));
  const normalized = {
    title: text(cellFrom(row, mapping, 'title'), 1000),
    kind: kind(cellFrom(row, mapping, 'kind')),
    authors: splitAuthors(cellFrom(row, mapping, 'authors')),
    doi,
    publicationYear,
    publishedAt: date(cellFrom(row, mapping, 'publishedAt'), 'publishedAt'),
    venue: text(cellFrom(row, mapping, 'venue'), 1000),
    classifications: splitClassifications(cellFrom(row, mapping, 'classifications')),
    lifecycleStatus: lifecycle(cellFrom(row, mapping, 'lifecycleStatus'), publicationYear, doi),
    targetVenue: text(cellFrom(row, mapping, 'targetVenue'), 1000),
    nextAction: text(cellFrom(row, mapping, 'nextAction'), 2000),
    nextActionDue: date(cellFrom(row, mapping, 'nextActionDue'), 'nextActionDue')
  };
  if (!normalized.title) fail('science_import_title_required');
  normalized.dedupeKey = normalized.doi
    ? `doi:${normalized.doi}`
    : `title:${normalizeTitle(normalized.title)}|year:${normalized.publicationYear || ''}|author:${normalizeTitle(normalized.authors[0] || '')}`;
  normalized.needsReview = !normalized.authors.length || normalized.kind === 'other';
  return normalized;
}

function existingItem(database, workspaceId, normalized) {
  if (normalized.doi) {
    const row = database.get(`
      SELECT si.id FROM scientific_items si
      LEFT JOIN scientific_item_manual_overrides simo ON simo.scientific_item_id = si.id
      WHERE si.workspace_id = ? AND lower(COALESCE(simo.doi,si.doi,'')) = ? LIMIT 1
    `, workspaceId, normalized.doi);
    if (row) return row.id;
  }
  const candidates = database.all(`
    SELECT si.id, COALESCE(simo.title,si.title) AS effective_title,
      COALESCE(simo.publication_year,si.publication_year) AS effective_year
    FROM scientific_items si LEFT JOIN scientific_item_manual_overrides simo ON simo.scientific_item_id = si.id
    WHERE si.workspace_id = ?
  `, workspaceId);
  return candidates.find((item) => normalizeTitle(item.effective_title) === normalizeTitle(normalized.title)
    && Number(item.effective_year || 0) === Number(normalized.publicationYear || 0))?.id || null;
}

function insertImportRow(database, runId, rowNo, sourceRow, normalized, status, scientificItemId, message, now) {
  database.run(`
    INSERT INTO science_import_rows(
      id, run_id, row_no, source_json, normalized_json, status,
      scientific_item_id, dedupe_key, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('scirow'), runId, rowNo, JSON.stringify(sourceRow), normalized ? JSON.stringify(normalized) : null,
  status, scientificItemId || null, normalized?.dedupeKey || null, message || null, now);
}

function applyLifecycle(database, workspaceId, scientificItemId, normalized, actorPersonId, now) {
  const current = database.get('SELECT lifecycle_status FROM scientific_items WHERE workspace_id = ? AND id = ?', workspaceId, scientificItemId);
  if (!current) return;
  database.run(`
    UPDATE scientific_items SET lifecycle_status = ?, target_venue = ?, next_action = ?, next_action_due = ?,
      submitted_at = CASE WHEN ? = 'submitted' THEN COALESCE(submitted_at,?) ELSE submitted_at END,
      accepted_at = CASE WHEN ? = 'accepted' THEN COALESCE(accepted_at,?) ELSE accepted_at END,
      rejected_at = CASE WHEN ? = 'rejected' THEN COALESCE(rejected_at,?) ELSE rejected_at END,
      updated_at = ? WHERE workspace_id = ? AND id = ?
  `, normalized.lifecycleStatus, normalized.targetVenue, normalized.nextAction, normalized.nextActionDue,
  normalized.lifecycleStatus, normalized.publishedAt || now.slice(0,10),
  normalized.lifecycleStatus, normalized.publishedAt || now.slice(0,10),
  normalized.lifecycleStatus, normalized.publishedAt || now.slice(0,10),
  now, workspaceId, scientificItemId);
  if (current.lifecycle_status !== normalized.lifecycleStatus) {
    database.run(`
      INSERT INTO scientific_lifecycle_events(
        id, workspace_id, scientific_item_id, from_status, to_status, event_date,
        note, created_by_person_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Импортировано из табличного источника', ?, ?)
    `, newId('scievent'), workspaceId, scientificItemId, current.lifecycle_status, normalized.lifecycleStatus,
    normalized.publishedAt || now.slice(0,10), actorPersonId, now);
  }
}

function updateCounts(database, runId, now) {
  const counts = database.get(`
    SELECT COUNT(*) AS total_rows,
      SUM(status = 'imported') AS imported_rows,
      SUM(status = 'updated') AS updated_rows,
      SUM(status = 'skipped') AS skipped_rows,
      SUM(status = 'needs_review') AS review_rows,
      SUM(status = 'error') AS error_rows
    FROM science_import_rows WHERE run_id = ?
  `, runId);
  const errorRows = Number(counts.error_rows || 0);
  const reviewRows = Number(counts.review_rows || 0);
  const status = errorRows || reviewRows ? 'completed_with_errors' : 'completed';
  database.run(`
    UPDATE science_import_runs SET status = ?, total_rows = ?, imported_rows = ?, updated_rows = ?,
      skipped_rows = ?, review_rows = ?, error_rows = ?, updated_at = ?, completed_at = ? WHERE id = ?
  `, status, Number(counts.total_rows || 0), Number(counts.imported_rows || 0), Number(counts.updated_rows || 0),
  Number(counts.skipped_rows || 0), reviewRows, errorRows, now, now, runId);
}

export async function importScienceRows(database, workspaceId, input = {}, actorPersonId = null) {
  const item = source(database, workspaceId, input.documentId);
  if (!item) fail('science_import_document_not_found');
  if (!['processed','needs_review'].includes(item.processing_status)) fail('science_import_document_not_ready');
  const mapping = input.mapping || {};
  if (!Number.isInteger(Number(mapping.title))) fail('science_import_mapping_title_required');
  const options = {
    updateExisting: input.options?.updateExisting === true,
    skipDuplicates: input.options?.skipDuplicates !== false
  };
  const idempotencyKey = text(input.idempotencyKey, 200);
  if (!idempotencyKey) fail('science_import_idempotency_required');
  const requestHash = hash({ documentVersionId: item.version_id, mapping, options });
  const existingRun = database.get(`SELECT * FROM science_import_runs WHERE workspace_id = ? AND idempotency_key = ?`, workspaceId, idempotencyKey);
  if (existingRun) {
    if (existingRun.request_hash !== requestHash) fail('science_import_idempotency_conflict', { runId: existingRun.id });
    return runRow(database, workspaceId, existingRun.id);
  }
  const now = new Date().toISOString();
  const runId = newId('sciimport');
  database.run(`
    INSERT INTO science_import_runs(
      id, workspace_id, source_document_version_id, source_name, idempotency_key,
      request_hash, status, mapping_json, options_json, created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
  `, runId, workspaceId, item.version_id, item.original_name, idempotencyKey, requestHash,
  JSON.stringify(mapping), JSON.stringify(options), actorPersonId, now, now);
  let rows;
  try {
    const parsed = analyzeRows(await sourceRows(database, item));
    rows = parsed.rows;
  } catch (error) {
    database.run(`UPDATE science_import_runs SET status = 'failed', error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      String(error?.message || error), now, now, runId);
    throw error;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const sourceRow = rows[index];
    const rowNo = index + 2;
    try {
      database.transaction(() => {
        const normalized = normalizeRow(sourceRow, mapping);
        const duplicateId = existingItem(database, workspaceId, normalized);
        if (duplicateId && !options.updateExisting) {
          insertImportRow(database, runId, rowNo, sourceRow, normalized, 'skipped', duplicateId,
            'Дубликат найден; существующая карточка не изменена.', now);
          return;
        }
        let scientificItemId = duplicateId;
        let status = 'imported';
        if (duplicateId) {
          updateScienceEditorial(database, workspaceId, duplicateId, {
            title: normalized.title, kind: normalized.kind, doi: normalized.doi,
            publicationYear: normalized.publicationYear, publishedAt: normalized.publishedAt,
            venue: normalized.venue, authors: normalized.authors,
            classifications: normalized.classifications, targetVenue: normalized.targetVenue,
            nextAction: normalized.nextAction, nextActionDue: normalized.nextActionDue,
            reason: `Массовый импорт ${item.original_name}, строка ${rowNo}`
          }, actorPersonId, now);
          status = 'updated';
        } else {
          const created = createScientificItem(database, workspaceId, {
            title: normalized.title, kind: normalized.kind, authors: normalized.authors,
            publicationYear: normalized.publicationYear, publishedAt: normalized.publishedAt,
            venue: normalized.venue, doi: normalized.doi,
            classifications: normalized.classifications
          });
          scientificItemId = created.id;
        }
        applyLifecycle(database, workspaceId, scientificItemId, normalized, actorPersonId, now);
        insertImportRow(database, runId, rowNo, sourceRow, normalized,
          normalized.needsReview ? 'needs_review' : status, scientificItemId,
          normalized.needsReview ? 'Проверьте автора или вид научного материала.' : null, now);
      });
    } catch (error) {
      insertImportRow(database, runId, rowNo, sourceRow, null, 'error', null,
        String(error?.code || error?.message || error), now);
    }
  }
  updateCounts(database, runId, new Date().toISOString());
  return runRow(database, workspaceId, runId);
}
