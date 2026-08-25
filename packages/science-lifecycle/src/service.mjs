import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { createManualPlanItem } from '../../plans/src/manual.mjs';
import { listScientificAuthorAffiliations } from '../../organization/src/service.mjs';

const LIFECYCLE = new Set(['idea','drafting','submitted','revision','accepted','published','rejected','archived']);
const KINDS = new Set(['article','conference','grant','patent','project','research_report','other']);
const TRANSITIONS = {
  idea: new Set(['drafting','archived']),
  drafting: new Set(['idea','submitted','archived']),
  submitted: new Set(['revision','accepted','rejected','archived']),
  revision: new Set(['submitted','rejected','archived']),
  accepted: new Set(['published','rejected','archived']),
  published: new Set(['revision','archived']),
  rejected: new Set(['drafting','archived']),
  archived: new Set(['idea','drafting'])
};

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

function date(value, field, { required = false } = {}) {
  const raw = String(value || '').slice(0, 10);
  if (!raw && !required) return null;
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(raw)) fail('science_lifecycle_date_invalid', { field });
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    fail('science_lifecycle_date_invalid', { field });
  }
  return raw;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function audit(database, workspaceId, actorPersonId, action, subjectId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, 'scientific_item', ?, ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', action, subjectId, JSON.stringify(details || {}), now);
}

function baseItem(database, workspaceId, scientificItemId) {
  return database.get('SELECT * FROM scientific_items WHERE workspace_id = ? AND id = ?', workspaceId, scientificItemId) || null;
}

function authorRows(database, scientificItemId) {
  return database.all(`SELECT * FROM scientific_item_authors WHERE scientific_item_id = ? ORDER BY author_order, author_raw`, scientificItemId);
}

function classificationRows(database, scientificItemId) {
  return database.all(`
    SELECT * FROM scientific_item_classifications
    WHERE scientific_item_id = ?
    ORDER BY classification_kind, classification_value
  `, scientificItemId);
}

function classificationValue(row) {
  return row.classification_value || row.classification || row.code || row.value || row.label || null;
}

function overrideRow(database, workspaceId, scientificItemId) {
  return database.get(`SELECT * FROM scientific_item_manual_overrides WHERE workspace_id = ? AND scientific_item_id = ?`, workspaceId, scientificItemId) || null;
}

function effectiveObject(database, workspaceId, base) {
  const override = overrideRow(database, workspaceId, base.id);
  const authors = override?.authors_json
    ? parseJson(override.authors_json, [])
    : authorRows(database, base.id).map((item) => ({
      name: item.author_raw,
      personId: item.person_id || null,
      affiliation: item.affiliation || null
    }));
  const classifications = override?.classifications_json
    ? parseJson(override.classifications_json, [])
    : classificationRows(database, base.id).map(classificationValue).filter(Boolean);
  const planLink = database.get(`
    SELECT spl.*, p.id AS plan_id, p.title AS plan_title, pi.title AS plan_item_title,
      pi.due_date AS plan_due_date, a.status AS assignment_status
    FROM scientific_item_plan_links spl
    JOIN plan_items pi ON pi.id = spl.plan_item_id
    JOIN plans p ON p.id = pi.plan_id
    LEFT JOIN assignments a ON a.id = spl.assignment_id
    WHERE spl.workspace_id = ? AND spl.scientific_item_id = ?
  `, workspaceId, base.id) || null;
  return {
    ...base,
    title: override?.title || base.title,
    kind: override?.kind || base.item_kind,
    doi: override?.doi || base.doi,
    publication_year: override?.publication_year ?? base.publication_year,
    published_at: override?.published_at || base.published_at,
    venue: override?.venue || base.venue,
    authors,
    classifications,
    manual_override: override ? {
      reason: override.reason,
      updated_by_person_id: override.updated_by_person_id,
      updated_at: override.updated_at
    } : null,
    affiliations: listScientificAuthorAffiliations(database, workspaceId, base.id),
    lifecycle_events: database.all(`
      SELECT sle.*, p.display_name AS actor_name, dv.document_id AS evidence_document_id,
        dv.original_name AS evidence_document_name
      FROM scientific_lifecycle_events sle
      LEFT JOIN people p ON p.id = sle.created_by_person_id
      LEFT JOIN document_versions dv ON dv.id = sle.evidence_document_version_id
      WHERE sle.workspace_id = ? AND sle.scientific_item_id = ?
      ORDER BY sle.event_date DESC, sle.created_at DESC
    `, workspaceId, base.id),
    revisions: database.all(`
      SELECT sir.id, sir.reason, sir.created_at, p.display_name AS actor_name
      FROM scientific_item_revisions sir LEFT JOIN people p ON p.id = sir.created_by_person_id
      WHERE sir.workspace_id = ? AND sir.scientific_item_id = ? ORDER BY sir.created_at DESC
    `, workspaceId, base.id),
    plan_link: planLink
  };
}

export function getScienceLifecycleItem(database, workspaceId, scientificItemId) {
  const base = baseItem(database, workspaceId, scientificItemId);
  return base ? effectiveObject(database, workspaceId, base) : null;
}

export function listScienceLifecycleItems(database, workspaceId, {
  lifecycleStatus = null, unitId = null, personId = null, yearFrom = null, yearTo = null, limit = 1000
} = {}) {
  const clauses = ['si.workspace_id = ?'];
  const params = [workspaceId];
  let join = '';
  if (lifecycleStatus) { clauses.push('si.lifecycle_status = ?'); params.push(lifecycleStatus); }
  if (yearFrom) { clauses.push('COALESCE(simo.publication_year, si.publication_year) >= ?'); params.push(Number(yearFrom)); }
  if (yearTo) { clauses.push('COALESCE(simo.publication_year, si.publication_year) <= ?'); params.push(Number(yearTo)); }
  if (unitId || personId) {
    join = `JOIN scientific_author_affiliations saa ON saa.scientific_item_id = si.id`;
    if (unitId) { clauses.push('saa.unit_id = ?'); params.push(unitId); }
    if (personId) { clauses.push('saa.person_id = ?'); params.push(personId); }
  }
  params.push(Math.max(1, Math.min(5000, Number(limit) || 1000)));
  return database.all(`
    SELECT DISTINCT si.id FROM scientific_items si
    LEFT JOIN scientific_item_manual_overrides simo ON simo.scientific_item_id = si.id
    ${join}
    WHERE ${clauses.join(' AND ')}
    ORDER BY COALESCE(si.next_action_due,'9999-12-31'), si.updated_at DESC LIMIT ?
  `, ...params).map((item) => getScienceLifecycleItem(database, workspaceId, item.id));
}

function validateAuthors(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail('science_editor_authors_invalid');
  const authors = value.map((item) => typeof item === 'string'
    ? { name: text(item, 500), personId: null, affiliation: null }
    : { name: text(item?.name, 500), personId: item?.personId || null, affiliation: text(item?.affiliation, 500) }
  ).filter((item) => item.name);
  if (!authors.length) fail('science_editor_authors_required');
  return authors;
}

function validateClassifications(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail('science_editor_classifications_invalid');
  return [...new Set(value.map((item) => text(item, 200)).filter(Boolean))];
}

function effectiveSnapshot(item) {
  return stable({
    title: item.title, kind: item.kind, doi: item.doi, publicationYear: item.publication_year,
    publishedAt: item.published_at, venue: item.venue, authors: item.authors,
    classifications: item.classifications, targetVenue: item.target_venue,
    nextAction: item.next_action, nextActionDue: item.next_action_due
  });
}

function reindex(database, workspaceId, item) {
  const fragments = database.all(`SELECT id FROM search_fragments WHERE source_kind = 'scientific_item' AND source_id = ?`, item.id);
  for (const fragment of fragments) database.run('DELETE FROM search_fts WHERE fragment_id = ?', fragment.id);
  database.run(`DELETE FROM search_fragments WHERE source_kind = 'scientific_item' AND source_id = ?`, item.id);
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'scientific_item',
    sourceId: item.id,
    documentVersionId: null,
    title: item.title,
    content: [item.title, item.doi, item.venue, item.target_venue,
      item.authors.map((author) => author.name || author).join(' '), item.classifications.join(' '),
      item.next_action].filter(Boolean).join('\n'),
    locator: { kind: 'scientific_item', scientificItemId: item.id, provenance: item.manual_override ? 'manual_override' : 'extracted' }
  });
}

export function updateScienceEditorial(database, workspaceId, scientificItemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = getScienceLifecycleItem(database, workspaceId, scientificItemId);
  if (!current) fail('scientific_item_not_found');
  const reason = text(input.reason, 4000);
  if (!reason) fail('science_editor_reason_required');
  const authors = validateAuthors(input.authors);
  const classifications = validateClassifications(input.classifications);
  const kind = input.kind === undefined ? current.kind : input.kind;
  if (kind && !KINDS.has(kind)) fail('science_editor_kind_invalid');
  const publicationYear = input.publicationYear === undefined ? current.publication_year
    : (input.publicationYear === null || input.publicationYear === '' ? null : Number(input.publicationYear));
  if (publicationYear !== null && (!Number.isInteger(publicationYear) || publicationYear < 1900 || publicationYear > 2200)) {
    fail('science_editor_year_invalid');
  }
  const publishedAt = input.publishedAt === undefined ? current.published_at : date(input.publishedAt, 'publishedAt');
  const nextActionDue = input.nextActionDue === undefined ? current.next_action_due : date(input.nextActionDue, 'nextActionDue');
  const next = {
    title: text(input.title === undefined ? current.title : input.title, 1000),
    kind,
    doi: text(input.doi === undefined ? current.doi : input.doi, 500),
    publicationYear,
    publishedAt,
    venue: text(input.venue === undefined ? current.venue : input.venue, 1000),
    authors: authors === undefined ? current.authors : authors,
    classifications: classifications === undefined ? current.classifications : classifications,
    targetVenue: text(input.targetVenue === undefined ? current.target_venue : input.targetVenue, 1000),
    nextAction: text(input.nextAction === undefined ? current.next_action : input.nextAction, 2000),
    nextActionDue
  };
  if (!next.title) fail('science_editor_title_required');
  const previous = effectiveSnapshot(current);
  database.transaction(() => {
    database.run(`
      INSERT INTO scientific_item_manual_overrides(
        scientific_item_id, workspace_id, title, kind, doi, publication_year, published_at,
        venue, authors_json, classifications_json, reason, updated_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scientific_item_id) DO UPDATE SET
        title = excluded.title, kind = excluded.kind, doi = excluded.doi,
        publication_year = excluded.publication_year, published_at = excluded.published_at,
        venue = excluded.venue, authors_json = excluded.authors_json,
        classifications_json = excluded.classifications_json, reason = excluded.reason,
        updated_by_person_id = excluded.updated_by_person_id, updated_at = excluded.updated_at
    `, scientificItemId, workspaceId, next.title, next.kind, next.doi, next.publicationYear,
    next.publishedAt, next.venue, JSON.stringify(next.authors), JSON.stringify(next.classifications),
    reason, actorPersonId, now, now);
    database.run(`
      UPDATE scientific_items SET target_venue = ?, next_action = ?, next_action_due = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, next.targetVenue, next.nextAction, next.nextActionDue, now, workspaceId, scientificItemId);
    database.run(`
      INSERT INTO scientific_item_revisions(
        id, workspace_id, scientific_item_id, previous_json, next_json, reason, created_by_person_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, newId('scirev'), workspaceId, scientificItemId, JSON.stringify(previous), JSON.stringify(stable(next)),
    reason, actorPersonId, now);
    audit(database, workspaceId, actorPersonId, 'science.editor_updated', scientificItemId, { reason }, now);
    reindex(database, workspaceId, getScienceLifecycleItem(database, workspaceId, scientificItemId));
  });
  return getScienceLifecycleItem(database, workspaceId, scientificItemId);
}

function validateEvidenceDocument(database, workspaceId, documentVersionId) {
  if (!documentVersionId) return null;
  return database.get(`
    SELECT dv.id FROM document_versions dv JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, documentVersionId) || fail('science_lifecycle_evidence_not_found');
}

export function transitionScienceLifecycle(database, workspaceId, scientificItemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const current = baseItem(database, workspaceId, scientificItemId);
  if (!current) fail('scientific_item_not_found');
  const nextStatus = String(input.status || input.toStatus || '');
  if (!LIFECYCLE.has(nextStatus)) fail('science_lifecycle_status_invalid');
  if (current.lifecycle_status !== nextStatus && !TRANSITIONS[current.lifecycle_status]?.has(nextStatus)) {
    fail('science_lifecycle_transition_invalid', { from: current.lifecycle_status, to: nextStatus });
  }
  const eventDate = date(input.eventDate, 'eventDate', { required: true });
  const note = text(input.note, 4000);
  const evidence = validateEvidenceDocument(database, workspaceId, input.evidenceDocumentVersionId || null);
  const targetVenue = text(input.targetVenue === undefined ? current.target_venue : input.targetVenue, 1000);
  const nextAction = text(input.nextAction, 2000);
  const nextActionDue = date(input.nextActionDue, 'nextActionDue');
  database.transaction(() => {
    database.run(`
      UPDATE scientific_items SET lifecycle_status = ?, target_venue = ?, next_action = ?, next_action_due = ?,
        submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
        accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END,
        rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_at END,
        published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END,
        publication_year = CASE WHEN ? = 'published' THEN COALESCE(publication_year, CAST(substr(?,1,4) AS INTEGER)) ELSE publication_year END,
        updated_at = ? WHERE workspace_id = ? AND id = ?
    `, nextStatus, targetVenue, nextAction, nextActionDue,
    nextStatus, eventDate, nextStatus, eventDate, nextStatus, eventDate,
    nextStatus, eventDate, nextStatus, eventDate, now, workspaceId, scientificItemId);
    database.run(`
      INSERT INTO scientific_lifecycle_events(
        id, workspace_id, scientific_item_id, from_status, to_status, event_date, note,
        evidence_document_version_id, created_by_person_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, newId('scievent'), workspaceId, scientificItemId, current.lifecycle_status, nextStatus,
    eventDate, note, evidence?.id || null, actorPersonId, now);
    audit(database, workspaceId, actorPersonId, 'science.lifecycle_transitioned', scientificItemId,
      { from: current.lifecycle_status, to: nextStatus, eventDate, evidenceDocumentVersionId: evidence?.id || null }, now);
  });
  return getScienceLifecycleItem(database, workspaceId, scientificItemId);
}

export function linkScienceToPlan(database, workspaceId, scientificItemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const science = getScienceLifecycleItem(database, workspaceId, scientificItemId);
  if (!science) fail('scientific_item_not_found');
  const existing = science.plan_link;
  if (existing) {
    if (input.planItemId && existing.plan_item_id === input.planItemId) return science;
    fail('science_plan_link_exists', { planItemId: existing.plan_item_id });
  }
  let planItemId = input.planItemId || null;
  let assignmentId = null;
  if (!planItemId) {
    if (!input.planId) fail('science_plan_required');
    const created = createManualPlanItem(database, workspaceId, input.planId, {
      title: text(input.title, 1000) || science.next_action || `Подготовить: ${science.title}`,
      description: text(input.description, 12000) || `Научный материал: ${science.title}`,
      startsAt: date(input.startsAt, 'startsAt'),
      dueDate: date(input.dueDate || science.next_action_due, 'dueDate'),
      direction: 'science',
      expectedResult: text(input.expectedResult, 4000) || (science.lifecycle_status === 'published' ? 'Публикация' : 'Научный материал'),
      executionMode: input.executionMode || 'track',
      responsiblePersonId: input.responsiblePersonId || null,
      executorPersonIds: input.executorPersonIds || [],
      controllerPersonId: input.controllerPersonId || null
    }, actorPersonId, now);
    planItemId = created.id;
    assignmentId = created.assignment?.id || null;
  } else {
    const item = database.get(`
      SELECT pi.id FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
      WHERE p.workspace_id = ? AND pi.id = ?
    `, workspaceId, planItemId);
    if (!item) fail('science_plan_item_not_found');
    assignmentId = database.get('SELECT assignment_id FROM plan_item_assignments WHERE plan_item_id = ?', planItemId)?.assignment_id || null;
  }
  database.run(`
    INSERT INTO scientific_item_plan_links(
      scientific_item_id, workspace_id, plan_item_id, assignment_id,
      created_by_person_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, scientificItemId, workspaceId, planItemId, assignmentId, actorPersonId, now, now);
  audit(database, workspaceId, actorPersonId, 'science.plan_linked', scientificItemId,
    { planItemId, assignmentId }, now);
  return getScienceLifecycleItem(database, workspaceId, scientificItemId);
}

export function unlinkScienceFromPlan(database, workspaceId, scientificItemId, input = {}, actorPersonId = null, now = new Date().toISOString()) {
  const reason = text(input.reason, 4000);
  if (!reason) fail('science_editor_reason_required');
  const existing = database.get(`SELECT * FROM scientific_item_plan_links WHERE workspace_id = ? AND scientific_item_id = ?`, workspaceId, scientificItemId);
  if (!existing) fail('science_plan_link_not_found');
  database.run('DELETE FROM scientific_item_plan_links WHERE workspace_id = ? AND scientific_item_id = ?', workspaceId, scientificItemId);
  audit(database, workspaceId, actorPersonId, 'science.plan_unlinked', scientificItemId,
    { reason, preservedPlanItemId: existing.plan_item_id, preservedAssignmentId: existing.assignment_id }, now);
  return getScienceLifecycleItem(database, workspaceId, scientificItemId);
}
