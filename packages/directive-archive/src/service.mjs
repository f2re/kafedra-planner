import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';

function text(value) {
  const clean = String(value ?? '').trim();
  return clean || null;
}

function isoDate(value) {
  const clean = text(value);
  if (!clean) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(clean)) throw new Error('directive_date_invalid');
  return clean;
}

function limitOf(value, fallback = 300, max = 1000) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

function directiveSource(database, workspaceId, documentVersionId) {
  return database.get(`
    SELECT dv.id AS version_id, dv.document_id, dv.original_name, dv.media_type,
      dv.processing_status, d.title AS document_title
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, documentVersionId);
}

function documentCurrentVersion(database, workspaceId, documentId) {
  return database.get(`
    SELECT dv.id AS version_id, dv.document_id, dv.original_name, dv.media_type,
      dv.processing_status, d.title AS document_title, fb.size_bytes
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId);
}

function addFacet(database, workspaceId, sourceId, facetName, value, now) {
  const clean = text(value);
  if (!clean) return;
  const isDate = /^\d{4}-\d{2}-\d{2}$/u.test(clean);
  database.run(`
    INSERT INTO entity_facets(
      id, workspace_id, source_kind, source_id, facet_name,
      text_value, normalized_value, date_value, created_at
    ) VALUES (?, ?, 'directive', ?, ?, ?, ?, ?, ?)
  `,
  newId('facet'), workspaceId, sourceId, facetName,
  isDate ? null : clean,
  isDate ? null : clean.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е'),
  isDate ? clean : null,
  now);
}

function clearDirectiveIndex(database, workspaceId, directiveId) {
  const fragments = database.all(`
    SELECT id FROM search_fragments
    WHERE workspace_id = ? AND source_kind = 'directive' AND source_id = ?
  `, workspaceId, directiveId);
  for (const fragment of fragments) database.run('DELETE FROM search_fts WHERE fragment_id = ?', fragment.id);
  database.run(`
    DELETE FROM search_fragments
    WHERE workspace_id = ? AND source_kind = 'directive' AND source_id = ?
  `, workspaceId, directiveId);
}

function reindexDirective(database, workspaceId, directiveId) {
  const directive = database.get(`
    SELECT d.*, dv.document_id AS source_document_id, dv.id AS source_version_id,
      dv.original_name
    FROM directives d
    JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, directiveId);
  if (!directive) return;

  clearDirectiveIndex(database, workspaceId, directiveId);
  const assignments = database.all(`
    SELECT title, instruction_text, expected_result
    FROM assignments WHERE directive_id = ? ORDER BY created_at
  `, directiveId);
  const mainContent = [
    directive.title,
    directive.summary,
    directive.document_number,
    directive.issuer_raw,
    directive.directive_kind,
    directive.original_name,
    ...assignments.flatMap((item) => [item.title, item.instruction_text, item.expected_result])
  ].filter(Boolean).join('\n');
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'directive',
    sourceId: directiveId,
    documentVersionId: directive.source_document_version_id,
    title: `${directive.directive_kind || 'Распоряжение'}${directive.document_number ? ` № ${directive.document_number}` : ''} · ${directive.title}`,
    content: mainContent,
    locator: { kind: 'directive', directiveId }
  });

  for (const material of database.all(`
    SELECT drm.*, dv.original_name, d.title AS document_title
    FROM directive_report_materials drm
    JOIN document_versions dv ON dv.id = drm.document_version_id
    JOIN documents d ON d.id = dv.document_id
    WHERE drm.workspace_id = ? AND drm.directive_id = ?
    ORDER BY drm.created_at
  `, workspaceId, directiveId)) {
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'directive',
      sourceId: directiveId,
      documentVersionId: material.document_version_id,
      title: `${directive.document_number ? `№ ${directive.document_number} · ` : ''}${material.title}`,
      content: [material.title, material.note, material.material_kind, material.material_date,
        material.original_name, material.document_title].filter(Boolean).join('\n'),
      locator: { kind: 'directive_material', directiveId, materialId: material.id }
    });
  }
}

function refreshFacets(database, workspaceId, directive) {
  database.run(`DELETE FROM entity_facets WHERE workspace_id = ? AND source_kind = 'directive' AND source_id = ?`, workspaceId, directive.id);
  const now = directive.updated_at || new Date().toISOString();
  addFacet(database, workspaceId, directive.id, 'document_number', directive.document_number, now);
  addFacet(database, workspaceId, directive.id, 'date', directive.issued_at, now);
  addFacet(database, workspaceId, directive.id, 'direction', directive.direction, now);
  addFacet(database, workspaceId, directive.id, 'kind', directive.directive_kind, now);
  addFacet(database, workspaceId, directive.id, 'issuer', directive.issuer_raw, now);
}

export function createDirectiveArchiveEntry(database, {
  workspaceId,
  documentVersionId,
  documentNumber,
  issuedAt,
  title,
  directiveKind = 'Распоряжение',
  direction = 'organizational',
  summary = null,
  issuerRaw = null,
  now = new Date().toISOString()
}) {
  const source = directiveSource(database, workspaceId, documentVersionId);
  if (!source) throw new Error('directive_source_not_found');
  const cleanTitle = text(title) || source.document_title || source.original_name;
  if (!cleanTitle) throw new Error('directive_title_required');
  const cleanDate = isoDate(issuedAt);

  const existing = database.get(`
    SELECT id FROM directives WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (existing) {
    return updateDirectiveArchiveEntry(database, workspaceId, existing.id, {
      documentNumber, issuedAt: cleanDate, title: cleanTitle, directiveKind, direction, summary, issuerRaw
    }, now);
  }

  const id = newId('directive');
  database.transaction(() => {
    database.run(`
      INSERT INTO directives(
        id, workspace_id, source_document_version_id, directive_kind,
        document_number, issued_at, issuer_raw, title, summary, direction,
        status, confidence, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)
    `,
    id, workspaceId, documentVersionId, text(directiveKind) || 'Распоряжение',
    text(documentNumber), cleanDate, text(issuerRaw), cleanTitle, text(summary),
    text(direction) || 'organizational',
    JSON.stringify({ source: 'operator', fields: ['documentNumber', 'issuedAt', 'title'] }), now, now);

    const directive = database.get('SELECT * FROM directives WHERE id = ?', id);
    refreshFacets(database, workspaceId, directive);
    reindexDirective(database, workspaceId, id);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, 'operator', 'directive.archive_created', 'directive', ?, ?, ?)
    `, newId('audit'), workspaceId, id, JSON.stringify({ documentVersionId, documentNumber: text(documentNumber), issuedAt: cleanDate }), now);
  });
  return getDirectiveArchiveEntry(database, workspaceId, id);
}

export function updateDirectiveArchiveEntry(database, workspaceId, directiveId, body, now = new Date().toISOString()) {
  const current = database.get(`SELECT * FROM directives WHERE workspace_id = ? AND id = ?`, workspaceId, directiveId);
  if (!current) return null;
  const next = {
    documentNumber: Object.hasOwn(body, 'documentNumber') ? text(body.documentNumber) : current.document_number,
    issuedAt: Object.hasOwn(body, 'issuedAt') ? isoDate(body.issuedAt) : current.issued_at,
    title: Object.hasOwn(body, 'title') ? text(body.title) : current.title,
    directiveKind: Object.hasOwn(body, 'directiveKind') ? text(body.directiveKind) : current.directive_kind,
    direction: Object.hasOwn(body, 'direction') ? text(body.direction) : current.direction,
    summary: Object.hasOwn(body, 'summary') ? text(body.summary) : current.summary,
    issuerRaw: Object.hasOwn(body, 'issuerRaw') ? text(body.issuerRaw) : current.issuer_raw,
    status: Object.hasOwn(body, 'status') ? text(body.status) : current.status
  };
  if (!next.title) throw new Error('directive_title_required');

  database.transaction(() => {
    database.run(`
      UPDATE directives SET
        document_number = ?, issued_at = ?, title = ?, directive_kind = ?, direction = ?,
        summary = ?, issuer_raw = ?, status = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `,
    next.documentNumber, next.issuedAt, next.title, next.directiveKind || 'Распоряжение',
    next.direction || 'organizational', next.summary, next.issuerRaw, next.status || 'active',
    now, workspaceId, directiveId);
    const directive = database.get('SELECT * FROM directives WHERE id = ?', directiveId);
    refreshFacets(database, workspaceId, directive);
    reindexDirective(database, workspaceId, directiveId);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, 'operator', 'directive.archive_updated', 'directive', ?, ?, ?)
    `, newId('audit'), workspaceId, directiveId, JSON.stringify(next), now);
  });
  return getDirectiveArchiveEntry(database, workspaceId, directiveId);
}

function archiveWhere(filters, params) {
  const clauses = ['d.workspace_id = ?'];
  params.push(filters.workspaceId);
  if (filters.from) { clauses.push('d.issued_at >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('d.issued_at <= ?'); params.push(filters.to); }
  if (filters.kind) { clauses.push('d.directive_kind = ?'); params.push(filters.kind); }
  if (filters.direction) { clauses.push('d.direction = ?'); params.push(filters.direction); }
  if (filters.status) { clauses.push('d.status = ?'); params.push(filters.status); }
  if (filters.report === 'with') {
    clauses.push(`(
      EXISTS (SELECT 1 FROM directive_report_materials drm WHERE drm.directive_id = d.id)
      OR EXISTS (SELECT 1 FROM assignments a JOIN assignment_evidence ae ON ae.assignment_id = a.id WHERE a.directive_id = d.id)
    )`);
  }
  if (filters.report === 'without') {
    clauses.push(`NOT EXISTS (SELECT 1 FROM directive_report_materials drm WHERE drm.directive_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM assignments a JOIN assignment_evidence ae ON ae.assignment_id = a.id WHERE a.directive_id = d.id)`);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push(`(
      d.title LIKE ? OR d.summary LIKE ? OR d.document_number LIKE ? OR d.issuer_raw LIKE ? OR d.directive_kind LIKE ?
      OR EXISTS (
        SELECT 1 FROM directive_report_materials drm
        JOIN document_versions mdv ON mdv.id = drm.document_version_id
        JOIN documents md ON md.id = mdv.document_id
        WHERE drm.directive_id = d.id
          AND (drm.title LIKE ? OR drm.note LIKE ? OR md.title LIKE ? OR mdv.original_name LIKE ?
            OR EXISTS (SELECT 1 FROM search_fragments sf WHERE sf.document_version_id = drm.document_version_id AND (sf.title LIKE ? OR sf.content LIKE ?)))
      )
      OR EXISTS (
        SELECT 1 FROM assignments a
        JOIN assignment_evidence ae ON ae.assignment_id = a.id
        LEFT JOIN document_versions adv ON adv.id = ae.document_version_id
        LEFT JOIN documents ad ON ad.id = adv.document_id
        WHERE a.directive_id = d.id AND (a.title LIKE ? OR a.instruction_text LIKE ? OR ae.note LIKE ? OR ad.title LIKE ? OR adv.original_name LIKE ?)
      )
    )`);
    params.push(like, like, like, like, like,
      like, like, like, like, like, like,
      like, like, like, like, like);
  }
  return clauses;
}

export function listDirectiveArchive(database, workspaceId, filters = {}) {
  const params = [];
  const clauses = archiveWhere({ ...filters, workspaceId }, params);
  params.push(limitOf(filters.limit));
  const rows = database.all(`
    SELECT d.*, dv.document_id AS source_document_id, dv.original_name,
      dv.processing_status AS source_processing_status,
      (SELECT COUNT(*) FROM assignments a WHERE a.directive_id = d.id) AS assignment_count,
      (SELECT COUNT(*) FROM directive_report_materials drm WHERE drm.directive_id = d.id) AS direct_material_count,
      (SELECT COUNT(*) FROM assignments a JOIN assignment_evidence ae ON ae.assignment_id = a.id WHERE a.directive_id = d.id) AS assignment_material_count,
      (SELECT MAX(COALESCE(drm.material_date, substr(drm.created_at, 1, 10))) FROM directive_report_materials drm WHERE drm.directive_id = d.id) AS last_material_date
    FROM directives d
    JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY COALESCE(d.issued_at, '0000-00-00') DESC, d.updated_at DESC
    LIMIT ?
  `, ...params).map((row) => ({
    ...row,
    material_count: Number(row.direct_material_count || 0) + Number(row.assignment_material_count || 0),
    report_state: Number(row.direct_material_count || 0) + Number(row.assignment_material_count || 0) > 0 ? 'with' : 'without'
  }));

  return {
    items: rows,
    total: rows.length,
    stats: {
      withMaterials: rows.filter((row) => row.material_count > 0).length,
      withoutMaterials: rows.filter((row) => row.material_count === 0).length,
      dated: rows.filter((row) => row.issued_at).length
    },
    facets: {
      kinds: [...new Set(rows.map((row) => row.directive_kind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
      directions: [...new Set(rows.map((row) => row.direction).filter(Boolean))].sort(),
      years: [...new Set(rows.map((row) => String(row.issued_at || '').slice(0, 4)).filter((value) => /^\d{4}$/u.test(value)))].sort().reverse()
    }
  };
}

function directMaterials(database, workspaceId, directiveId) {
  return database.all(`
    SELECT drm.*, dv.document_id, dv.original_name, dv.media_type, dv.processing_status,
      d.title AS document_title, fb.size_bytes
    FROM directive_report_materials drm
    JOIN document_versions dv ON dv.id = drm.document_version_id
    JOIN documents d ON d.id = dv.document_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE drm.workspace_id = ? AND drm.directive_id = ?
    ORDER BY COALESCE(drm.material_date, substr(drm.created_at, 1, 10)) DESC, drm.created_at DESC
  `, workspaceId, directiveId).map((row) => ({
    ...row,
    origin: 'directive',
    content_url: `/api/directive-archive/${encodeURIComponent(directiveId)}/materials/${encodeURIComponent(row.id)}/content`
  }));
}

function assignmentMaterials(database, workspaceId, directiveId) {
  return database.all(`
    SELECT ae.id, ae.assignment_id, ae.document_version_id, ae.evidence_kind AS material_kind,
      ae.note, ae.created_at, a.title AS assignment_title,
      dv.document_id, dv.original_name, dv.media_type, dv.processing_status,
      d.title AS document_title, fb.size_bytes
    FROM assignments a
    JOIN assignment_evidence ae ON ae.assignment_id = a.id
    LEFT JOIN document_versions dv ON dv.id = ae.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    LEFT JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE a.workspace_id = ? AND a.directive_id = ?
    ORDER BY ae.created_at DESC
  `, workspaceId, directiveId).map((row) => ({
    ...row,
    origin: 'assignment',
    title: row.document_title || row.original_name || `Материал по поручению «${row.assignment_title}»`,
    material_date: String(row.created_at || '').slice(0, 10) || null,
    status: 'attached',
    content_url: row.document_id ? `/api/documents/${encodeURIComponent(row.document_id)}/content?variant=original` : null
  }));
}

export function getDirectiveArchiveEntry(database, workspaceId, directiveId) {
  const directive = database.get(`
    SELECT d.*, dv.document_id AS source_document_id, dv.original_name, dv.media_type,
      dv.processing_status AS source_processing_status, fb.size_bytes AS source_size_bytes
    FROM directives d
    JOIN document_versions dv ON dv.id = d.source_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, directiveId);
  if (!directive) return null;
  const assignments = database.all(`
    SELECT a.id, a.source_item_no, a.title, a.instruction_text, a.due_date, a.status,
      a.report_required,
      (SELECT COUNT(*) FROM assignment_evidence ae WHERE ae.assignment_id = a.id) AS report_count
    FROM assignments a
    WHERE a.workspace_id = ? AND a.directive_id = ?
    ORDER BY CASE WHEN a.source_item_no GLOB '[0-9]*' THEN CAST(a.source_item_no AS INTEGER) ELSE 999999 END, a.created_at
  `, workspaceId, directiveId);
  const materials = [...directMaterials(database, workspaceId, directiveId), ...assignmentMaterials(database, workspaceId, directiveId)]
    .sort((a, b) => String(b.material_date || b.created_at || '').localeCompare(String(a.material_date || a.created_at || '')));
  return {
    ...directive,
    evidence: (() => { try { return JSON.parse(directive.evidence_json || '{}'); } catch { return {}; } })(),
    source_content_url: `/api/documents/${encodeURIComponent(directive.source_document_id)}/content?variant=original`,
    assignments,
    materials,
    material_count: materials.length
  };
}

export function attachDirectiveMaterial(database, workspaceId, directiveId, body, now = new Date().toISOString()) {
  const directive = database.get(`SELECT id FROM directives WHERE workspace_id = ? AND id = ?`, workspaceId, directiveId);
  if (!directive) return null;
  const version = documentCurrentVersion(database, workspaceId, body.documentId);
  if (!version) throw new Error('directive_material_document_not_found');
  const assignmentId = text(body.assignmentId);
  if (assignmentId) {
    const assignment = database.get(`
      SELECT id FROM assignments WHERE workspace_id = ? AND directive_id = ? AND id = ?
    `, workspaceId, directiveId, assignmentId);
    if (!assignment) throw new Error('directive_material_assignment_invalid');
  }
  const title = text(body.title) || version.document_title || version.original_name;
  if (!title) throw new Error('directive_material_title_required');
  const materialDate = isoDate(body.materialDate);
  const existing = database.get(`
    SELECT id FROM directive_report_materials WHERE directive_id = ? AND document_version_id = ?
  `, directiveId, version.version_id);
  if (existing) return getDirectiveArchiveEntry(database, workspaceId, directiveId);

  database.transaction(() => {
    database.run(`
      INSERT INTO directive_report_materials(
        id, workspace_id, directive_id, assignment_id, document_version_id,
        material_kind, title, material_date, note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'attached', ?, ?)
    `,
    newId('drm'), workspaceId, directiveId, assignmentId, version.version_id,
    text(body.kind) || 'report', title, materialDate, text(body.note), now, now);
    reindexDirective(database, workspaceId, directiveId);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, 'operator', 'directive.material_attached', 'directive', ?, ?, ?)
    `, newId('audit'), workspaceId, directiveId,
    JSON.stringify({ documentId: body.documentId, assignmentId, kind: text(body.kind) || 'report', title }), now);
  });
  return getDirectiveArchiveEntry(database, workspaceId, directiveId);
}

export function detachDirectiveMaterial(database, workspaceId, directiveId, materialId, now = new Date().toISOString()) {
  const material = database.get(`
    SELECT * FROM directive_report_materials
    WHERE workspace_id = ? AND directive_id = ? AND id = ?
  `, workspaceId, directiveId, materialId);
  if (!material) return null;
  database.transaction(() => {
    database.run(`DELETE FROM directive_report_materials WHERE id = ?`, materialId);
    reindexDirective(database, workspaceId, directiveId);
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, 'operator', 'directive.material_detached', 'directive', ?, ?, ?)
    `, newId('audit'), workspaceId, directiveId, JSON.stringify({ materialId, documentVersionId: material.document_version_id }), now);
  });
  return getDirectiveArchiveEntry(database, workspaceId, directiveId);
}

export function getDirectiveMaterialFile(database, workspaceId, directiveId, materialId) {
  return database.get(`
    SELECT drm.id, drm.directive_id, dv.document_id, dv.original_name AS file_name,
      dv.media_type, fb.storage_path AS path, fb.size_bytes, fb.sha256
    FROM directive_report_materials drm
    JOIN document_versions dv ON dv.id = drm.document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE drm.workspace_id = ? AND drm.directive_id = ? AND drm.id = ?
  `, workspaceId, directiveId, materialId);
}
