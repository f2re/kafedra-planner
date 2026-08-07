import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { normalizePersonName } from '../../work-management/src/service.mjs';

const SCOPE_LABELS = {
  department: 'План кафедры',
  faculty: 'План факультета',
  personal: 'Личный план',
  unit: 'План подразделения',
  organization: 'План организации'
};

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function categoryFor(direction) {
  if (direction === 'science') return 'science';
  if (direction === 'education') return 'education';
  return 'organizational';
}

function addFacet(database, workspaceId, sourceKind, sourceId, name, value, now) {
  if (value === null || value === undefined || value === '') return;
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  database.run(`
    INSERT INTO entity_facets(
      id, workspace_id, source_kind, source_id, facet_name,
      text_value, normalized_value, date_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('facet'), workspaceId, sourceKind, sourceId, name,
  isDate ? null : String(value), isDate ? null : normalizePersonName(value), isDate ? String(value) : null, now);
}

function review(database, workspaceId, sourceKind, sourceId, issueCode, title, explanation, action, context, now) {
  const exists = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
      AND issue_code = ? AND status = 'open'
  `, workspaceId, sourceKind, sourceId, issueCode);
  if (exists) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, newId('review'), workspaceId, sourceKind, sourceId, issueCode, title,
  explanation, action, JSON.stringify(context || {}), now);
}

function findPerson(database, workspaceId, raw) {
  const normalized = normalizePersonName(raw);
  if (!normalized) return null;
  return database.get(`
    SELECT * FROM people
    WHERE workspace_id = ? AND normalized_name = ? AND status = 'active'
  `, workspaceId, normalized);
}

function validPerson(database, workspaceId, personId) {
  if (!personId) return null;
  return database.get(`
    SELECT * FROM people WHERE workspace_id = ? AND id = ? AND status = 'active'
  `, workspaceId, personId);
}

export function planScopeLabel(value) {
  return SCOPE_LABELS[value] || 'План';
}

export function setPlanIngestHint(database, {
  workspaceId,
  documentVersionId,
  planScope = null,
  periodKind = null,
  periodKey = null,
  ownerPersonId = null,
  sourceTemplateId = null,
  now = new Date().toISOString()
}) {
  database.run(`
    INSERT INTO plan_ingest_hints(
      document_version_id, workspace_id, plan_scope, period_kind, period_key,
      owner_person_id, source_template_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_version_id) DO UPDATE SET
      plan_scope = excluded.plan_scope,
      period_kind = excluded.period_kind,
      period_key = excluded.period_key,
      owner_person_id = excluded.owner_person_id,
      source_template_id = excluded.source_template_id
  `, documentVersionId, workspaceId, planScope, periodKind, periodKey,
  ownerPersonId, sourceTemplateId, now);
}

export function getPlanIngestHint(database, workspaceId, documentVersionId) {
  return database.get(`
    SELECT * FROM plan_ingest_hints
    WHERE workspace_id = ? AND document_version_id = ?
  `, workspaceId, documentVersionId);
}

function planRow(database, workspaceId, planId) {
  const row = database.get(`
    SELECT p.*, dv.document_id AS source_document_id, dv.original_name,
      pt.name AS source_template_name, owner.display_name AS owner_name
    FROM plans p
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    LEFT JOIN plan_templates pt ON pt.id = p.source_template_id
    LEFT JOIN people owner ON owner.id = p.owner_person_id
    WHERE p.workspace_id = ? AND p.id = ?
  `, workspaceId, planId);
  if (!row) return null;
  const items = database.all(`
    SELECT pi.*, person.display_name AS responsible_name
    FROM plan_items pi
    LEFT JOIN people person ON person.id = pi.responsible_person_id
    WHERE pi.plan_id = ?
    ORDER BY
      CASE WHEN pi.starts_at IS NULL THEN 1 ELSE 0 END,
      pi.starts_at, pi.due_date, pi.created_at
  `, planId).map((item) => ({
    ...item,
    evidence: parseJson(item.evidence_json, {}),
    calendarItems: database.all(`
      SELECT * FROM calendar_items
      WHERE source_kind = 'plan_item' AND source_id = ?
      ORDER BY starts_at, item_kind
    `, item.id)
  }));
  return { ...row, evidence: parseJson(row.evidence_json, {}), items };
}

function calendarDescription(plan, item) {
  const source = `${planScopeLabel(plan.planScope)}${plan.periodKey ? ` · ${plan.periodKey}` : ''}`;
  const details = [source, item.responsibleRaw ? `Ответственный: ${item.responsibleRaw}` : null, item.expectedResult]
    .filter(Boolean).join('. ');
  return details || null;
}

function createCalendarProjection(database, workspaceId, plan, item, now) {
  const category = categoryFor(item.direction);
  const description = calendarDescription(plan, item);
  let hasProjection = false;
  const startAsTask = item.itemKind === 'task' && !item.dueDate;
  if (item.startsAt) {
    const kind = startAsTask ? 'task' : 'event';
    database.run(`
      INSERT OR IGNORE INTO calendar_items(
        id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
        all_day, category, importance, status, description, item_kind,
        reminder_minutes, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, 'plan_item', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
    `, newId('cal'), workspaceId, item.id,
    kind === 'task' ? `Срок: ${item.title}` : item.title,
    item.startsAt, kind === 'event' ? item.endsAt : null,
    category, item.importance || 'normal', kind === 'task' ? 'open' : 'confirmed',
    description, kind, kind === 'task' ? 10080 : null, now, now);
    hasProjection = true;
  }
  if (item.dueDate && (!startAsTask || item.dueDate !== item.startsAt)) {
    database.run(`
      INSERT OR IGNORE INTO calendar_items(
        id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
        all_day, category, importance, status, description, item_kind,
        reminder_minutes, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, 'plan_item', ?, ?, ?, NULL, 1, ?, ?, 'open', ?, 'task', 10080, NULL, 1, ?, ?)
    `, newId('cal'), workspaceId, item.id, `Срок: ${item.title}`, item.dueDate,
    category, item.importance || 'normal', description, now, now);
    hasProjection = true;
  }
  return hasProjection;
}

export function persistPlan(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result,
  now = new Date().toISOString()
}) {
  const existing = database.get(`
    SELECT id FROM plans WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (existing) return planRow(database, workspaceId, existing.id);

  let owner = validPerson(database, workspaceId, result.ownerPersonId);
  if (!owner && result.ownerRaw) owner = findPerson(database, workspaceId, result.ownerRaw);
  const planId = newId('plan');
  database.run(`
    INSERT INTO plans(
      id, workspace_id, source_document_version_id, source_template_id,
      plan_scope, title, period_kind, period_key, owner_person_id, owner_raw,
      status, confidence, evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `, planId, workspaceId, documentVersionId, result.sourceTemplateId || null,
  result.planScope || 'unit', result.title || documentTitle || 'План',
  result.periodKind || 'unknown', result.periodKey || null,
  owner?.id || null, result.ownerRaw || null, result.confidence || 0,
  JSON.stringify(result.evidence || {}), now, now);

  addFacet(database, workspaceId, 'plan', planId, 'plan_scope', result.planScope || 'unit', now);
  addFacet(database, workspaceId, 'plan', planId, 'period', result.periodKey, now);
  addFacet(database, workspaceId, 'plan', planId, 'status', 'active', now);
  if (owner?.display_name) addFacet(database, workspaceId, 'plan', planId, 'owner', owner.display_name, now);
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'plan',
    sourceId: planId,
    documentVersionId,
    title: `${planScopeLabel(result.planScope)} · ${result.periodKey || result.title || documentTitle}`,
    content: [result.title, result.periodKey, result.ownerRaw, ...(result.items || []).map((item) => item.title)].filter(Boolean).join('\n'),
    locator: { kind: 'plan', planId }
  });

  if (result.planScope === 'personal' && !owner) {
    review(database, workspaceId, 'plan', planId, 'plan_owner_unresolved',
      'Не определён владелец личного плана',
      result.ownerRaw
        ? `В плане указан сотрудник «${result.ownerRaw}», но точного совпадения в справочнике нет.`
        : 'В личном плане не удалось определить сотрудника.',
      'Выберите сотрудника для этого плана.', { ownerRaw: result.ownerRaw || null }, now);
  }
  if (!result.periodKey) {
    review(database, workspaceId, 'plan', planId, 'plan_period_missing',
      'Не определён год плана',
      'План сохранён, но календарный или учебный год не найден надёжно.',
      'Укажите год или учебный год; уже найденные пункты не потеряются.', {}, now);
  }

  for (const source of result.items || []) {
    const person = source.responsibleRaw ? findPerson(database, workspaceId, source.responsibleRaw) : null;
    const itemId = newId('planitem');
    database.run(`
      INSERT INTO plan_items(
        id, plan_id, source_row_key, source_item_no, title, description,
        starts_at, ends_at, due_date, item_kind, direction,
        responsible_raw, responsible_person_id, expected_result,
        importance, status, confidence, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?)
    `, itemId, planId, source.sourceRowKey, source.itemNo || null, source.title,
    source.description || null, source.startsAt || null, source.endsAt || null,
    source.dueDate || null, source.itemKind || 'event', source.direction || 'organizational',
    source.responsibleRaw || null, person?.id || null, source.expectedResult || null,
    source.importance || 'normal', source.confidence || 0,
    JSON.stringify(source.evidence || {}), now, now);

    addFacet(database, workspaceId, 'plan_item', itemId, 'plan_scope', result.planScope || 'unit', now);
    addFacet(database, workspaceId, 'plan_item', itemId, 'period', result.periodKey, now);
    addFacet(database, workspaceId, 'plan_item', itemId, 'direction', source.direction || 'organizational', now);
    addFacet(database, workspaceId, 'plan_item', itemId, 'responsible', source.responsibleRaw, now);
    addFacet(database, workspaceId, 'plan_item', itemId, 'date', source.startsAt || source.dueDate, now);
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'plan_item',
      sourceId: itemId,
      documentVersionId,
      title: source.title,
      content: [source.description, source.responsibleRaw, source.expectedResult, result.title, result.periodKey].filter(Boolean).join('\n'),
      locator: source.evidence?.locator || source.evidence?.locators?.[0] || { kind: 'plan_item', planId, itemId }
    });

    if (source.responsibleRaw && !person) {
      review(database, workspaceId, 'plan_item', itemId, 'plan_responsible_unresolved',
        'Не определён ответственный по пункту плана',
        `В плане указан «${source.responsibleRaw}», но точного сотрудника в справочнике нет.`,
        'Выберите сотрудника или добавьте его в справочник.',
        { raw: source.responsibleRaw, planId }, now);
    }
    if (!createCalendarProjection(database, workspaceId, {
      planScope: result.planScope,
      periodKey: result.periodKey,
      title: result.title
    }, {
      id: itemId,
      title: source.title,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      dueDate: source.dueDate,
      itemKind: source.itemKind,
      direction: source.direction,
      responsibleRaw: source.responsibleRaw,
      expectedResult: source.expectedResult,
      importance: source.importance
    }, now)) {
      review(database, workspaceId, 'plan_item', itemId, 'plan_item_date_missing',
        'У пункта плана нет календарного срока', source.title,
        'Укажите дату, период или контрольный срок. Пункт уже сохранён и доступен в плане.',
        { planId, sourceRowKey: source.sourceRowKey }, now);
    }
  }

  if (!(result.items || []).length) {
    review(database, workspaceId, 'plan', planId, 'plan_items_missing',
      'В плане не найдены мероприятия',
      'Документ сохранён и доступен для поиска, но строки плана не удалось разобрать надёжно.',
      'Проверьте таблицу плана или настройте DOCX-шаблон.', {}, now);
  }
  return planRow(database, workspaceId, planId);
}

function planClauses(workspaceId, filters, params) {
  const clauses = ['p.workspace_id = ?'];
  params.push(workspaceId);
  if (filters.scope) { clauses.push('p.plan_scope = ?'); params.push(filters.scope); }
  if (filters.period) { clauses.push('p.period_key = ?'); params.push(filters.period); }
  if (filters.periodKind) { clauses.push('p.period_kind = ?'); params.push(filters.periodKind); }
  if (filters.ownerPersonId) { clauses.push('p.owner_person_id = ?'); params.push(filters.ownerPersonId); }
  if (filters.status) { clauses.push('p.status = ?'); params.push(filters.status); }
  if (filters.direction) {
    clauses.push('EXISTS (SELECT 1 FROM plan_items pi WHERE pi.plan_id = p.id AND pi.direction = ?)');
    params.push(filters.direction);
  }
  if (filters.responsible) {
    clauses.push('EXISTS (SELECT 1 FROM plan_items pi WHERE pi.plan_id = p.id AND pi.responsible_raw LIKE ?)');
    params.push(`%${filters.responsible}%`);
  }
  if (filters.q) {
    const value = `%${filters.q}%`;
    clauses.push(`(p.title LIKE ? OR p.owner_raw LIKE ? OR EXISTS (
      SELECT 1 FROM plan_items pi
      WHERE pi.plan_id = p.id AND (pi.title LIKE ? OR pi.description LIKE ? OR pi.expected_result LIKE ?)
    ))`);
    params.push(value, value, value, value, value);
  }
  return clauses;
}

export function listPlans(database, workspaceId, filters = {}) {
  const params = [];
  const clauses = planClauses(workspaceId, filters, params);
  params.push(Math.min(1000, Math.max(1, Number(filters.limit || 300))));
  return database.all(`
    SELECT p.*, dv.document_id AS source_document_id, dv.original_name,
      owner.display_name AS owner_name,
      (SELECT COUNT(*) FROM plan_items pi WHERE pi.plan_id = p.id) AS item_count,
      (SELECT COUNT(*) FROM plan_items pi WHERE pi.plan_id = p.id AND pi.starts_at IS NULL AND pi.due_date IS NULL) AS undated_count
    FROM plans p
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    LEFT JOIN people owner ON owner.id = p.owner_person_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY COALESCE(p.period_key, '') DESC, p.updated_at DESC
    LIMIT ?
  `, ...params);
}

export function getPlan(database, workspaceId, planId) {
  return planRow(database, workspaceId, planId);
}

export function listPlanCalendarSources(database, workspaceId, limit = 3000) {
  return database.all(`
    SELECT ci.id AS calendar_item_id, ci.source_id AS plan_item_id,
      p.id AS plan_id, p.title AS plan_title, p.plan_scope, p.period_kind, p.period_key,
      dv.document_id AS source_document_id, pi.source_item_no, pi.responsible_raw,
      pi.evidence_json
    FROM calendar_items ci
    JOIN plan_items pi ON pi.id = ci.source_id
    JOIN plans p ON p.id = pi.plan_id
    JOIN document_versions dv ON dv.id = p.source_document_version_id
    WHERE ci.workspace_id = ? AND ci.source_kind = 'plan_item'
    ORDER BY ci.starts_at DESC
    LIMIT ?
  `, workspaceId, Math.min(10000, Math.max(1, Number(limit || 3000)))).map((row) => ({
    ...row,
    scopeLabel: planScopeLabel(row.plan_scope),
    evidence: parseJson(row.evidence_json, {})
  }));
}
