import { search } from './search.mjs';

const COMPLETE_STATUSES = new Set(['completed', 'cancelled', 'approved', 'confirmed']);

function normalized(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/\s+/gu, ' ')
    .trim();
}

function dateOnly(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(String(value || ''));
  return match?.[1] || null;
}

function facetMap(database, workspaceId, sourceKind, sourceId) {
  const map = {};
  for (const row of database.all(`
    SELECT facet_name, text_value, normalized_value, date_value
    FROM entity_facets
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
    ORDER BY created_at, id
  `, workspaceId, sourceKind, sourceId)) {
    const value = row.text_value ?? row.date_value ?? row.normalized_value;
    if (value === null || value === undefined || value === '') continue;
    (map[row.facet_name] ||= []).push(String(value));
  }
  return map;
}

function peopleByRole(database, assignmentId) {
  const rows = database.all(`
    SELECT ae.role, ae.executor_raw, p.display_name
    FROM assignment_executors ae
    LEFT JOIN people p ON p.id = ae.person_id
    WHERE ae.assignment_id = ?
    ORDER BY CASE ae.role WHEN 'executor' THEN 1 WHEN 'coexecutor' THEN 2 WHEN 'controller' THEN 3 WHEN 'observer' THEN 4 ELSE 5 END,
      COALESCE(p.display_name, ae.executor_raw)
  `, assignmentId);
  const values = (role) => rows.filter((row) => role.includes(row.role)).map((row) => row.display_name || row.executor_raw).filter(Boolean);
  return {
    executors: values(['executor', 'coexecutor']),
    controllers: values(['controller']),
    observers: values(['observer']),
    people: rows.map((row) => row.display_name || row.executor_raw).filter(Boolean)
  };
}

function assignmentMeta(database, workspaceId, sourceId, facets) {
  const row = database.get(`
    SELECT a.*, d.document_number, d.directive_kind, dv.document_id AS source_document_id,
      (SELECT COUNT(*) FROM assignment_evidence ae WHERE ae.assignment_id = a.id) AS report_count,
      (SELECT COUNT(*) FROM assignment_outcomes ao WHERE ao.assignment_id = a.id) AS outcome_count
    FROM assignments a
    LEFT JOIN directives d ON d.id = a.directive_id
    LEFT JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, sourceId);
  if (!row) return null;
  const people = peopleByRole(database, sourceId);
  const reportCount = Number(row.report_count || 0);
  const reportState = reportCount === 0 ? 'none'
    : row.status === 'completed' || Number(row.outcome_count || 0) > 0 && row.status === 'completed' ? 'confirmed'
      : row.status === 'submitted' ? 'submitted'
        : row.status === 'rework' ? 'rework' : 'attached';
  return {
    kind: 'assignment', number: row.document_number, date: row.due_date,
    direction: row.direction, status: row.status, period: facets.period?.[0] || null,
    ...people, reportCount, reportState, sourceDocumentId: row.source_document_id
  };
}

function sourceMeta(database, workspaceId, sourceKind, sourceId) {
  const facets = facetMap(database, workspaceId, sourceKind, sourceId);
  if (sourceKind === 'document') {
    const row = database.get(`SELECT document_type, status, updated_at FROM documents WHERE workspace_id = ? AND id = ?`, workspaceId, sourceId);
    return row ? {
      kind: row.document_type, number: null, date: dateOnly(row.updated_at), direction: null,
      status: row.status, period: null, people: [], executors: [], controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: sourceId
    } : null;
  }
  if (sourceKind === 'meeting') {
    const row = database.get(`
      SELECT m.*, dv.document_id AS source_document_id
      FROM meetings m JOIN document_versions dv ON dv.id = m.source_document_version_id
      WHERE m.workspace_id = ? AND m.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: 'protocol', number: row.protocol_number, date: row.meeting_date,
      direction: 'organizational', status: row.status, period: null,
      people: [row.chairperson_raw, row.secretary_raw].filter(Boolean), executors: [], controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: row.source_document_id
    } : null;
  }
  if (sourceKind === 'decision') {
    const row = database.get(`
      SELECT d.*, m.protocol_number, m.workspace_id, dv.document_id AS source_document_id
      FROM decisions d
      JOIN agenda_items ai ON ai.id = d.agenda_item_id
      JOIN meetings m ON m.id = ai.meeting_id
      JOIN document_versions dv ON dv.id = m.source_document_version_id
      WHERE m.workspace_id = ? AND d.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: 'decision', number: row.protocol_number, date: row.due_date,
      direction: 'organizational', status: row.status, period: null,
      people: [row.responsible_raw].filter(Boolean), executors: [row.responsible_raw].filter(Boolean), controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: row.source_document_id
    } : null;
  }
  if (sourceKind === 'directive') {
    const row = database.get(`
      SELECT d.*, dv.document_id AS source_document_id,
        (SELECT COUNT(*) FROM assignment_evidence ae JOIN assignments a ON a.id = ae.assignment_id WHERE a.directive_id = d.id) AS report_count
      FROM directives d JOIN document_versions dv ON dv.id = d.source_document_version_id
      WHERE d.workspace_id = ? AND d.id = ?
    `, workspaceId, sourceId);
    if (!row) return null;
    const roles = database.all(`
      SELECT ae.role, ae.executor_raw, p.display_name
      FROM assignments a JOIN assignment_executors ae ON ae.assignment_id = a.id
      LEFT JOIN people p ON p.id = ae.person_id
      WHERE a.directive_id = ? ORDER BY ae.role, ae.executor_raw
    `, sourceId);
    const names = (roleSet) => [...new Set(roles.filter((entry) => roleSet.includes(entry.role)).map((entry) => entry.display_name || entry.executor_raw).filter(Boolean))];
    return {
      kind: row.directive_kind, number: row.document_number, date: row.issued_at,
      direction: row.direction, status: row.status, period: facets.period?.[0] || null,
      people: names(['executor','coexecutor','controller','observer']),
      executors: names(['executor','coexecutor']), controllers: names(['controller']), observers: names(['observer']),
      reportCount: Number(row.report_count || 0), reportState: Number(row.report_count || 0) ? 'attached' : 'none',
      sourceDocumentId: row.source_document_id
    };
  }
  if (sourceKind === 'assignment') return assignmentMeta(database, workspaceId, sourceId, facets);
  if (sourceKind === 'scientific_item') {
    const row = database.get(`
      SELECT si.*, dv.document_id AS source_document_id
      FROM scientific_items si LEFT JOIN document_versions dv ON dv.id = si.source_document_version_id
      WHERE si.workspace_id = ? AND si.id = ?
    `, workspaceId, sourceId);
    if (!row) return null;
    const authors = database.all(`
      SELECT COALESCE(p.display_name, sia.author_raw) AS name
      FROM scientific_item_authors sia LEFT JOIN people p ON p.id = sia.person_id
      WHERE sia.scientific_item_id = ? ORDER BY sia.author_order
    `, sourceId).map((entry) => entry.name).filter(Boolean);
    return {
      kind: row.item_kind, number: row.doi, date: row.published_at || (row.publication_year ? `${row.publication_year}-01-01` : null),
      direction: row.direction || 'science', status: row.status, period: row.publication_year ? String(row.publication_year) : null,
      people: authors, executors: [], controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: row.source_document_id
    };
  }
  if (sourceKind === 'plan') {
    const row = database.get(`
      SELECT p.*, dv.document_id AS source_document_id
      FROM plans p JOIN document_versions dv ON dv.id = p.source_document_version_id
      WHERE p.workspace_id = ? AND p.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: row.plan_kind, number: null, date: row.year_start ? `${row.year_start}-01-01` : null,
      direction: null, status: row.status, period: row.period_key,
      people: [row.owner_raw].filter(Boolean), executors: [row.owner_raw].filter(Boolean), controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: row.source_document_id
    } : null;
  }
  if (sourceKind === 'plan_item') {
    const row = database.get(`
      SELECT pi.*, p.plan_kind, p.period_key, dv.document_id AS source_document_id
      FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
      JOIN document_versions dv ON dv.id = p.source_document_version_id
      WHERE p.workspace_id = ? AND pi.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: row.plan_kind, number: null, date: row.due_date || row.starts_at,
      direction: row.direction, status: row.status, period: row.period_key,
      people: [row.responsible_raw].filter(Boolean), executors: [row.responsible_raw].filter(Boolean), controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: row.source_document_id
    } : null;
  }
  if (sourceKind === 'template_extraction') {
    const row = database.get(`
      SELECT te.*, t.document_type, dv.document_id AS source_document_id
      FROM template_extractions te JOIN document_templates t ON t.id = te.template_id
      JOIN document_versions dv ON dv.id = te.document_version_id
      WHERE te.workspace_id = ? AND te.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: row.document_type, number: null, date: dateOnly(row.created_at), direction: null,
      status: row.status, period: null, people: [], executors: [], controllers: [], observers: [],
      reportCount: null, reportState: null, sourceDocumentId: row.source_document_id
    } : null;
  }
  return {
    kind: facets.kind?.[0] || facets.plan_kind?.[0] || null,
    number: facets.document_number?.[0] || null,
    date: facets.date?.[0] || null,
    direction: facets.direction?.[0] || null,
    status: facets.status?.[0] || null,
    period: facets.period?.[0] || null,
    people: [...(facets.executor || []), ...(facets.coexecutor || []), ...(facets.controller || []), ...(facets.responsible || []), ...(facets.author || []), ...(facets.owner || [])],
    executors: [...(facets.executor || []), ...(facets.coexecutor || []), ...(facets.responsible || []), ...(facets.owner || [])],
    controllers: facets.controller || [], observers: facets.observer || [],
    reportCount: null, reportState: null, sourceDocumentId: null
  };
}

function periodicCandidates(database, workspaceId, query) {
  const rows = database.all(`
    SELECT pt.*, owner.display_name AS owner_name, manager.display_name AS manager_name
    FROM periodic_tasks pt
    LEFT JOIN people owner ON owner.id = pt.owner_person_id
    LEFT JOIN people manager ON manager.id = pt.manager_person_id
    WHERE pt.workspace_id = ? ORDER BY pt.updated_at DESC
  `, workspaceId);
  const tokens = normalized(query).split(' ').filter(Boolean);
  return rows.filter((row) => {
    if (!tokens.length) return true;
    const haystack = normalized([row.title, row.description, row.expected_result, row.period_key, row.owner_name, row.manager_name].filter(Boolean).join(' '));
    return tokens.every((token) => haystack.includes(token));
  }).map((row) => ({
    id: `periodic:${row.id}`, source_kind: 'periodic_task', source_id: row.id,
    document_version_id: null, title: row.title,
    snippet: row.description || row.expected_result || `${row.period_kind}: ${row.period_key}`,
    locator_json: '{}', rank: 0,
    _meta: {
      kind: row.period_kind, number: null, date: row.due_date, direction: row.direction,
      status: row.status, period: row.period_key,
      people: [row.owner_name, row.manager_name].filter(Boolean), executors: [row.owner_name].filter(Boolean),
      controllers: [row.manager_name].filter(Boolean), observers: [], reportCount: null,
      reportState: row.report_required ? 'required' : 'not_required', sourceDocumentId: null
    }
  }));
}

function candidateFragments(database, workspaceId, query, limit) {
  if (normalized(query)) return search(database, workspaceId, query, limit);
  return database.all(`
    SELECT id, source_kind, source_id, document_version_id, title,
      substr(content, 1, 360) AS snippet, locator_json, 0 AS rank
    FROM search_fragments WHERE workspace_id = ?
    ORDER BY created_at DESC LIMIT ?
  `, workspaceId, limit);
}

function typeMatches(sourceKind, requested) {
  if (!requested) return true;
  if (requested === 'plans') return ['plan', 'plan_item'].includes(sourceKind);
  if (requested === 'science') return sourceKind === 'scientific_item';
  if (requested === 'protocol') return ['meeting', 'decision'].includes(sourceKind);
  return sourceKind === requested;
}

function contains(values, needle) {
  const expected = normalized(needle);
  return !expected || (values || []).some((value) => normalized(value).includes(expected));
}

function matches(item, filters, today) {
  const meta = item.meta;
  if (!typeMatches(item.source_kind, filters.sourceKind)) return false;
  if (filters.kind && normalized(meta.kind) !== normalized(filters.kind)) return false;
  if (filters.number && !normalized(meta.number).includes(normalized(filters.number))) return false;
  if (filters.from && (!meta.date || String(meta.date) < filters.from)) return false;
  if (filters.to && (!meta.date || String(meta.date) > filters.to)) return false;
  if (filters.direction && normalized(meta.direction) !== normalized(filters.direction)) return false;
  if (filters.period && !normalized(meta.period).includes(normalized(filters.period))) return false;
  if (filters.person) {
    const roleValues = filters.role === 'controller' ? meta.controllers
      : filters.role === 'executor' ? meta.executors
        : filters.role === 'observer' ? meta.observers : meta.people;
    if (!contains(roleValues, filters.person)) return false;
  }
  const overdue = Boolean(meta.date && String(meta.date) < today && !COMPLETE_STATUSES.has(String(meta.status || ''))
    && ['assignment', 'periodic_task', 'decision', 'plan_item'].includes(item.source_kind));
  if (filters.status === 'overdue' && !overdue) return false;
  if (filters.status && filters.status !== 'overdue' && normalized(meta.status) !== normalized(filters.status)) return false;
  if (filters.report === 'with' && !(Number(meta.reportCount || 0) > 0)) return false;
  if (filters.report === 'without' && !(meta.reportCount === 0 || meta.reportState === 'none')) return false;
  if (filters.report === 'confirmed' && meta.reportState !== 'confirmed') return false;
  if (filters.report === 'submitted' && meta.reportState !== 'submitted') return false;
  item.overdue = overdue;
  return true;
}

export function buildSearchFacets(items) {
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ru'));
  return {
    sourceKinds: unique(items.map((item) => item.source_kind)),
    kinds: unique(items.map((item) => item.meta.kind)),
    directions: unique(items.map((item) => item.meta.direction)),
    statuses: unique(items.map((item) => item.meta.status)),
    periods: unique(items.map((item) => item.meta.period))
  };
}

export function searchFaceted(database, workspaceId, filters = {}, limit = 50) {
  const query = String(filters.q || '').trim();
  const candidateLimit = Math.min(10000, Math.max(500, Number(limit || 50) * 30));
  const candidates = [
    ...candidateFragments(database, workspaceId, query, candidateLimit),
    ...periodicCandidates(database, workspaceId, query)
  ];
  const deduped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.source_kind}:${candidate.source_id}`;
    const existing = deduped.get(key);
    if (!existing || Number(candidate.rank || 0) < Number(existing.rank || 0)) deduped.set(key, candidate);
  }
  const today = filters.today || new Date().toISOString().slice(0, 10);
  const items = [];
  for (const candidate of deduped.values()) {
    const meta = candidate._meta || sourceMeta(database, workspaceId, candidate.source_kind, candidate.source_id);
    if (!meta) continue;
    const item = {
      ...candidate,
      meta,
      source_document_id: meta.sourceDocumentId || null,
      kind: meta.kind || null,
      number: meta.number || null,
      event_date: meta.date || null,
      direction: meta.direction || null,
      status: meta.status || null,
      period: meta.period || null,
      executor: (meta.executors || []).join(', ') || null,
      controller: (meta.controllers || []).join(', ') || null,
      report_state: meta.reportState || null
    };
    if (matches(item, filters, today)) items.push(item);
  }
  items.sort((a, b) => {
    if (query) return Number(a.rank || 0) - Number(b.rank || 0) || String(b.event_date || '').localeCompare(String(a.event_date || ''));
    return String(b.event_date || '').localeCompare(String(a.event_date || '')) || String(a.title).localeCompare(String(b.title), 'ru');
  });
  return { query, items: items.slice(0, limit), facets: buildSearchFacets(items) };
}
