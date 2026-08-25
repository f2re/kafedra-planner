import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { normalizePersonName } from '../../work-management/src/service.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function addFacet(database, workspaceId, sourceId, name, value, now) {
  if (value === null || value === undefined || value === '') return;
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  database.run(`
    INSERT INTO entity_facets(
      id, workspace_id, source_kind, source_id, facet_name,
      text_value, normalized_value, date_value, created_at
    ) VALUES (?, ?, 'scientific_item', ?, ?, ?, ?, ?, ?)
  `, newId('facet'), workspaceId, sourceId, name,
  isDate ? null : String(value), isDate ? null : normalizePersonName(value), isDate ? String(value) : null, now);
}

function personByName(database, workspaceId, raw) {
  const normalized = normalizePersonName(raw);
  if (!normalized) return null;
  return database.get(`
    SELECT * FROM people WHERE workspace_id = ? AND normalized_name = ? AND status = 'active'
  `, workspaceId, normalized);
}

function row(database, workspaceId, itemId) {
  const item = database.get(`
    SELECT si.*, dv.document_id AS source_document_id, dv.original_name
    FROM scientific_items si
    LEFT JOIN document_versions dv ON dv.id = si.source_document_version_id
    WHERE si.workspace_id = ? AND si.id = ?
  `, workspaceId, itemId);
  if (!item) return null;
  return {
    ...item,
    identifiers: parseJson(item.identifiers_json, {}),
    evidence: parseJson(item.evidence_json, {}),
    authors: database.all(`
      SELECT sia.*, p.display_name, p.email
      FROM scientific_item_authors sia
      LEFT JOIN people p ON p.id = sia.person_id
      WHERE sia.scientific_item_id = ? ORDER BY sia.author_order
    `, itemId),
    classifications: database.all(`
      SELECT * FROM scientific_item_classifications
      WHERE scientific_item_id = ? ORDER BY classification_kind, classification_value
    `, itemId).map((entry) => ({ ...entry, evidence: parseJson(entry.evidence_json, {}) })),
    documents: database.all(`
      SELECT sie.*, dv.document_id, d.title AS document_title, dv.original_name
      FROM scientific_item_evidence sie
      LEFT JOIN document_versions dv ON dv.id = sie.document_version_id
      LEFT JOIN documents d ON d.id = dv.document_id
      WHERE sie.scientific_item_id = ? ORDER BY sie.created_at DESC
    `, itemId).map((entry) => ({ ...entry, locator: parseJson(entry.locator_json, {}) }))
  };
}

function normalizedClassification(entry) {
  if (typeof entry === 'string') {
    const value = entry.trim();
    return value ? { kind: 'manual', value } : null;
  }
  const value = String(entry?.value ?? entry?.classification_value ?? '').trim();
  if (!value) return null;
  const kind = String(entry?.kind ?? entry?.classification_kind ?? 'manual').trim() || 'manual';
  return { kind, value };
}

function normalizedClassifications(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizedClassification).filter(Boolean);
}

function hasLifecycleColumn(database) {
  return database.all('PRAGMA table_info(scientific_items)').some((column) => column.name === 'lifecycle_status');
}

function initialLifecycleStatus(result) {
  if (result.lifecycleStatus) return result.lifecycleStatus;
  return result.publishedAt || result.publicationYear || result.doi ? 'published' : 'idea';
}

export function persistScientificItem(database, {
  workspaceId,
  documentVersionId = null,
  documentTitle = '',
  result,
  now = new Date().toISOString()
}) {
  if (documentVersionId) {
    const existing = database.get(`
      SELECT id FROM scientific_items WHERE workspace_id = ? AND source_document_version_id = ?
    `, workspaceId, documentVersionId);
    if (existing) return row(database, workspaceId, existing.id);
  }
  if (result.doi) {
    const existing = database.get('SELECT id FROM scientific_items WHERE workspace_id = ? AND doi = ?', workspaceId, result.doi);
    if (existing) {
      if (documentVersionId) database.run(`
        INSERT OR IGNORE INTO scientific_item_evidence(
          id, scientific_item_id, document_version_id, evidence_kind, locator_json, created_at
        ) VALUES (?, ?, ?, 'additional_source', '{}', ?)
      `, newId('scienceev'), existing.id, documentVersionId, now);
      return row(database, workspaceId, existing.id);
    }
  }

  const classifications = normalizedClassifications(result.classifications);
  const id = newId('science');
  database.transaction(() => {
    const values = [
      id, workspaceId, documentVersionId, result.kind || 'article',
      result.title || documentTitle || 'Научный материал', result.abstractText || null,
      result.publishedAt || null, result.publicationYear || null, result.venue || null,
      result.doi || null, JSON.stringify(result.identifiers || {}),
      result.confidence >= 0.72 ? 'confirmed' : 'proposed', result.confidence || 0,
      JSON.stringify(result.evidence || {})
    ];
    if (hasLifecycleColumn(database)) {
      database.run(`
        INSERT INTO scientific_items(
          id, workspace_id, source_document_version_id, item_kind, title,
          abstract_text, published_at, publication_year, venue, doi,
          identifiers_json, status, direction, confidence, evidence_json,
          lifecycle_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'science', ?, ?, ?, ?, ?)
      `, ...values, initialLifecycleStatus(result), now, now);
    } else {
      database.run(`
        INSERT INTO scientific_items(
          id, workspace_id, source_document_version_id, item_kind, title,
          abstract_text, published_at, publication_year, venue, doi,
          identifiers_json, status, direction, confidence, evidence_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'science', ?, ?, ?, ?)
      `, ...values, now, now);
    }

    (result.authors || []).forEach((author, index) => {
      const person = personByName(database, workspaceId, author);
      database.run(`
        INSERT OR IGNORE INTO scientific_item_authors(
          scientific_item_id, person_id, author_raw, author_order, affiliation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, id, person?.id || null, author, index + 1, null, now);
      addFacet(database, workspaceId, id, 'author', author, now);
    });
    classifications.forEach((classification) => {
      database.run(`
        INSERT OR IGNORE INTO scientific_item_classifications(
          id, scientific_item_id, classification_kind, classification_value,
          status, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, 'proposed', '{}', ?)
      `, newId('scienceclass'), id, classification.kind, classification.value, now);
      addFacet(database, workspaceId, id, classification.kind, classification.value, now);
    });
    if (documentVersionId) database.run(`
      INSERT INTO scientific_item_evidence(
        id, scientific_item_id, document_version_id, evidence_kind, locator_json, created_at
      ) VALUES (?, ?, ?, 'source', '{}', ?)
    `, newId('scienceev'), id, documentVersionId, now);

    addFacet(database, workspaceId, id, 'kind', result.kind || 'article', now);
    addFacet(database, workspaceId, id, 'date', result.publishedAt, now);
    addFacet(database, workspaceId, id, 'year', result.publicationYear, now);
    addFacet(database, workspaceId, id, 'doi', result.doi, now);
    addFacet(database, workspaceId, id, 'venue', result.venue, now);
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'scientific_item',
      sourceId: id,
      documentVersionId,
      title: result.title || documentTitle || 'Научный материал',
      content: [result.title, result.abstractText, result.venue, result.doi,
        ...(result.authors || []), ...classifications.map((entry) => entry.value)]
        .filter(Boolean).join('\n'),
      locator: { kind: 'scientific_item', itemId: id }
    });
  });
  return row(database, workspaceId, id);
}

export function createScientificItem(database, workspaceId, body, now = new Date().toISOString()) {
  if (!String(body.title || '').trim()) throw new Error('scientific_title_required');
  return persistScientificItem(database, {
    workspaceId,
    documentVersionId: body.documentVersionId || null,
    documentTitle: body.title,
    result: {
      kind: body.kind || 'article', title: String(body.title).trim(),
      abstractText: body.abstractText || null, publishedAt: body.publishedAt || null,
      publicationYear: body.publicationYear || (body.publishedAt ? Number(String(body.publishedAt).slice(0, 4)) : null),
      venue: body.venue || null, doi: body.doi || null,
      authors: Array.isArray(body.authors) ? body.authors : [],
      classifications: normalizedClassifications(body.classifications),
      identifiers: body.identifiers || {}, confidence: 1, evidence: { manual: true }
    },
    now
  });
}

export function listScientificItems(database, workspaceId, filters = {}) {
  const clauses = ['si.workspace_id = ?'];
  const params = [workspaceId];
  if (filters.kind) { clauses.push('si.item_kind = ?'); params.push(filters.kind); }
  if (filters.status) { clauses.push('si.status = ?'); params.push(filters.status); }
  if (filters.from) { clauses.push('COALESCE(si.published_at, printf(\'%04d-01-01\', si.publication_year)) >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('COALESCE(si.published_at, printf(\'%04d-12-31\', si.publication_year)) <= ?'); params.push(filters.to); }
  if (filters.year) { clauses.push('si.publication_year = ?'); params.push(Number(filters.year)); }
  if (filters.author) {
    clauses.push(`EXISTS (
      SELECT 1 FROM scientific_item_authors sia
      LEFT JOIN people p ON p.id = sia.person_id
      WHERE sia.scientific_item_id = si.id
        AND (sia.author_raw LIKE ? OR p.display_name LIKE ?)
    )`);
    params.push(`%${filters.author}%`, `%${filters.author}%`);
  }
  if (filters.classification) {
    clauses.push(`EXISTS (
      SELECT 1 FROM scientific_item_classifications sic
      WHERE sic.scientific_item_id = si.id AND sic.classification_value LIKE ?
    )`);
    params.push(`%${filters.classification}%`);
  }
  if (filters.q) {
    const value = `%${filters.q}%`;
    clauses.push('(si.title LIKE ? OR si.abstract_text LIKE ? OR si.venue LIKE ? OR si.doi LIKE ?)');
    params.push(value, value, value, value);
  }
  params.push(Math.min(1000, Math.max(1, Number(filters.limit || 300))));
  return database.all(`
    SELECT si.id FROM scientific_items si
    WHERE ${clauses.join(' AND ')}
    ORDER BY COALESCE(si.published_at, printf('%04d-01-01', si.publication_year), '0000-01-01') DESC,
      si.created_at DESC LIMIT ?
  `, ...params).map((entry) => row(database, workspaceId, entry.id));
}

export function getScientificItem(database, workspaceId, itemId) {
  return row(database, workspaceId, itemId);
}
