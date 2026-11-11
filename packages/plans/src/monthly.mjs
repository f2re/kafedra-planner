import { createHash } from 'node:crypto';
import { newId } from '../../core/src/ids.mjs';
import { AppError } from '../../core/src/errors.mjs';
import { requireAuthenticated } from '../../auth/src/policy.mjs';
import { resolveObjectAccess } from '../../access-control/src/service.mjs';
import { resolvePlanItemAccess } from './access.mjs';
import { parseJson, normalizeName } from './shared.mjs';
import { classifyPlanActivity, PLAN_ACTIVITY_KINDS } from './activity.mjs';
import { addEventDetailsToSource } from './event-details.mjs';
import { getEventTemplateVersion, normalizeEventCustomValues } from './event-templates.mjs';

const MAX_ITEMS = 5000;
const SOURCE_SELECT = `
  SELECT pi.*, p.workspace_id, p.title AS plan_title, p.plan_kind, p.period_key,
    p.year_start, p.year_end, p.owner_raw, p.status AS plan_status,
    p.source_document_version_id, dv.document_id AS source_document_id,
    person.display_name AS responsible_name
  FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
  LEFT JOIN document_versions dv ON dv.id = p.source_document_version_id
  LEFT JOIN people person ON person.id = pi.responsible_person_id`;

function fail(code, message, status = 400, details) {
  throw new AppError(code, message, status, details);
}

function requireInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('monthly_plan_input_invalid', 'Передайте поля месячного плана.', 400);
}

function boundedText(value, max, field, { nullable = false, empty = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') fail('monthly_plan_field_invalid', 'Проверьте текстовое поле.', 400, { field });
  const text = value.trim();
  if ((!empty && !text) || text.length > max) {
    fail('monthly_plan_field_invalid', 'Поле пустое или превышает допустимую длину.', 400, { field, max });
  }
  return text;
}

export function normalizeMonthlyPlanMonth(value) {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/u.test(value)) {
    fail('monthly_plan_month_invalid', 'Выберите месяц плана.');
  }
  return value;
}

function monthBounds(month) {
  const value = normalizeMonthlyPlanMonth(month);
  const [year, number] = value.split('-').map(Number);
  return {
    from: `${value}-01`,
    to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10),
    year
  };
}

function sourceRow(row) {
  if (!row) return null;
  const { evidence_json, ...rest } = row;
  return { ...rest, evidence: parseJson(evidence_json, {}), activity_kind: classifyPlanActivity(row) };
}

function sourceItem(database, workspaceId, id, context) {
  const row = sourceRow(database.get(`${SOURCE_SELECT} WHERE p.workspace_id = ? AND pi.id = ?`, workspaceId, id));
  return row ? addEventDetailsToSource(database, workspaceId, row, context) : null;
}

function readableSource(database, workspaceId, context, id) {
  return resolvePlanItemAccess(database, workspaceId, context, id, 'read').allowed;
}

function requireActor(database, workspaceId, context) {
  requireAuthenticated(context);
  const actorId = context.personId || null;
  if (context.enabled && !actorId) fail('monthly_plan_profile_required', 'Нужен профиль сотрудника.', 403);
  if (actorId && !database.get('SELECT id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, actorId)) {
    fail('monthly_plan_profile_required', 'Профиль сотрудника не найден.', 403);
  }
  return actorId;
}

function canUseDraft(context, row) {
  return Boolean(context?.authenticated && (
    !context.enabled || context.role === 'admin'
    || (context.personId && row.created_by_person_id === context.personId)
  ));
}

function draftRow(database, workspaceId, id, context) {
  requireAuthenticated(context);
  const row = database.get('SELECT * FROM monthly_plans WHERE workspace_id = ? AND id = ?', workspaceId, id);
  if (!row) fail('monthly_plan_not_found', 'Месячный план не найден.', 404);
  if (!canUseDraft(context, row)) fail('monthly_plan_access_forbidden', 'Нет доступа к месячному плану.', 403);
  return row;
}

export function assertMonthlyPlanRevision(row, expectedRevision) {
  if (!['number', 'string'].includes(typeof expectedRevision) || !Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 1) {
    fail('monthly_plan_revision_required', 'Обновите месячный план перед сохранением.', 400);
  }
  if (Number(expectedRevision) !== row.revision) {
    fail('monthly_plan_revision_conflict', 'План уже изменён. Обновите его и повторите правку.', 409, { revision: row.revision });
  }
}

function assertTemplate(database, workspaceId, templateId, context) {
  if (templateId === null || templateId === undefined || templateId === '') return null;
  const id = boundedText(templateId, 200, 'templateId');
  const template = database.get(`
    SELECT t.*, dv.document_id FROM plan_document_templates t
    JOIN document_versions dv ON dv.id = t.source_document_version_id
    WHERE t.workspace_id = ? AND t.id = ?
  `, workspaceId, id);
  if (!template || !resolveObjectAccess(database, workspaceId, context, 'document', template.document_id, 'read').allowed) {
    fail('monthly_plan_template_unavailable', 'Шаблон не найден или недоступен.', 404);
  }
  if (template.status !== 'active') fail('monthly_plan_template_inactive', 'Шаблон находится в архиве.', 409);
  if (template.period_kind !== 'monthly') fail('monthly_plan_template_period_invalid', 'Выберите образец с месяцем в заголовке.', 400);
  return id;
}

function assertEventTemplate(database, workspaceId, versionId, context) {
  if (versionId === null || versionId === undefined || versionId === '') return null;
  const id = boundedText(versionId, 200, 'eventTemplateVersionId');
  getEventTemplateVersion(database, workspaceId, id, context);
  return id;
}

function audit(database, workspaceId, context, action, id, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, ?, 'monthly_plan', ?, ?, ?)
  `, newId('audit'), workspaceId, context.personId || 'operator', action, id, JSON.stringify(details), now);
}

function bumpRevision(database, id, now) {
  database.run('UPDATE monthly_plans SET revision = revision + 1, updated_at = ? WHERE id = ?', now, id);
}

function effectiveItem(row, source) {
  return {
    title: row.title_override ?? source.title,
    description: source.description || '',
    startsAt: source.starts_at,
    endsAt: source.ends_at,
    dueDate: source.due_date,
    dateText: row.date_text_override,
    responsibleRaw: row.responsible_override ?? source.responsible_raw ?? '',
    direction: source.direction,
    activityKind: source.activity_kind,
    expectedResult: row.expected_result_override ?? source.expected_result ?? '',
    note: row.note || '',
    location: row.location_override ?? source.location ?? '',
    customValues: { ...(source.customValues || {}), ...parseJson(row.custom_values_json, {}) }
  };
}

export function getMonthlyPlan(database, workspaceId, id, context) {
  const row = draftRow(database, workspaceId, id, context);
  let templateUnavailable = false;
  if (row.template_id) {
    try { assertTemplate(database, workspaceId, row.template_id, context); }
    catch (error) { if (!(error instanceof AppError)) throw error; templateUnavailable = true; }
  }
  let eventTemplate = null;
  let eventTemplateUnavailable = false;
  if (row.event_template_version_id) {
    try { eventTemplate = getEventTemplateVersion(database, workspaceId, row.event_template_version_id, context); }
    catch (error) { if (!(error instanceof AppError)) throw error; eventTemplateUnavailable = true; }
  }
  const items = database.all(
    'SELECT * FROM monthly_plan_items WHERE monthly_plan_id = ? ORDER BY position, id', id
  ).map((item) => {
    if (!readableSource(database, workspaceId, context, item.plan_item_id)) {
      return { id: item.id, position: item.position, unavailable: true };
    }
    const source = sourceItem(database, workspaceId, item.plan_item_id, context);
    if (!source) return { id: item.id, position: item.position, unavailable: true };
    return { ...item, customValues: parseJson(item.custom_values_json, {}), selectionEvidence: parseJson(item.selection_evidence_json, null), source, effective: effectiveItem(item, source) };
  });
  const { idempotency_key, request_hash, ...header } = row;
  return { ...header, canEdit: true, items, templateUnavailable, eventTemplate, eventTemplateUnavailable, unavailableCount: items.filter((item) => item.unavailable).length };
}

export function listMonthlyPlans(database, workspaceId, context, { month = '', limit = 100 } = {}) {
  requireAuthenticated(context);
  const where = ['workspace_id = ?'];
  const params = [workspaceId];
  if (month) { where.push('month_key = ?'); params.push(normalizeMonthlyPlanMonth(month)); }
  if (context.enabled && context.role !== 'admin') {
    where.push('created_by_person_id = ?'); params.push(context.personId || '');
  }
  params.push(Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100)));
  return database.all(`
    SELECT id, workspace_id, month_key, title, template_id, event_template_version_id, department_text, revision, created_by_person_id,
      created_at, updated_at,
      (SELECT COUNT(*) FROM monthly_plan_items mi WHERE mi.monthly_plan_id = monthly_plans.id) AS item_count
    FROM monthly_plans WHERE ${where.join(' AND ')} ORDER BY month_key DESC, updated_at DESC, id LIMIT ?
  `, ...params).map((row) => ({ ...row, canEdit: true }));
}

export function listPlanEvents(database, workspaceId, context, filters = {}) {
  requireAuthenticated(context);
  const where = ["p.workspace_id = ?", "p.status = 'active'", "pi.status <> 'cancelled'"];
  const params = [workspaceId];
  for (const [filter, column] of [['planId', 'p.id'], ['planKind', 'p.plan_kind'], ['direction', 'pi.direction']]) {
    if (filters[filter]) { where.push(`${column} = ?`); params.push(String(filters[filter])); }
  }
  if (filters.month) {
    const { from, to, year } = monthBounds(filters.month);
    let dates = `(pi.due_date BETWEEN ? AND ? OR (pi.starts_at <= ? AND COALESCE(pi.ends_at, pi.starts_at) >= ?))`;
    params.push(from, to, to, from);
    if (filters.includeUndated === true || filters.includeUndated === '1') {
      dates = `(${dates} OR (pi.starts_at IS NULL AND pi.due_date IS NULL
        AND (p.year_start IS NULL OR p.year_start <= ?) AND (p.year_end IS NULL OR p.year_end >= ?)))`;
      params.push(year, year);
    }
    where.push(dates);
  }
  if (filters.activityKind && !PLAN_ACTIVITY_KINDS.includes(filters.activityKind)) {
    fail('monthly_plan_activity_invalid', 'Выберите вид мероприятия.');
  }
  const offset = Math.min(50_000, Math.max(0, Number.parseInt(filters.offset, 10) || 0));
  const limit = Math.min(500, Math.max(1, Number.parseInt(filters.limit, 10) || 100));
  const query = normalizeName(filters.q);
  const department = normalizeName(filters.department);
  const responsible = normalizeName(filters.responsible);
  const rows = [];
  let scanned = 0;
  let matching = 0;
  let exhausted = false;
  while (!exhausted && rows.length <= limit) {
    const batch = database.all(`${SOURCE_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(pi.due_date, pi.starts_at, '9999-12-31'), p.id, pi.source_item_key, pi.id
      LIMIT 500 OFFSET ?`, ...params, scanned);
    scanned += batch.length;
    exhausted = batch.length < 500;
    for (const row of batch) {
      if (!readableSource(database, workspaceId, context, row.id)) continue;
      const item = sourceRow(row);
      if (filters.activityKind && item.activity_kind !== filters.activityKind) continue;
      const searchable = normalizeName([item.title, item.description, item.expected_result, item.plan_title, item.responsible_raw].join(' '));
      if (query && !searchable.includes(query)) continue;
      if (department && !normalizeName([item.plan_title, item.owner_raw, item.responsible_raw, item.title, item.description].join(' ')).includes(department)) continue;
      if (responsible && !normalizeName([item.responsible_raw, item.responsible_name].join(' ')).includes(responsible)) continue;
      if (matching++ < offset) continue;
      rows.push(addEventDetailsToSource(database, workspaceId, item, context));
      if (rows.length > limit) break;
    }
  }
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), hasMore, nextOffset: hasMore ? offset + limit : null };
}

function itemIds(input, { optional = false } = {}) {
  if (optional && input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_ITEMS || input.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)) {
    fail('monthly_plan_items_invalid', 'Выберите мероприятия из общего списка.');
  }
  return [...new Set(input.map((id) => id.trim()))];
}

function addItems(database, workspaceId, draft, ids, context, now) {
  let position = Number(database.get('SELECT COALESCE(MAX(position), -1) AS value FROM monthly_plan_items WHERE monthly_plan_id = ?', draft.id).value) + 1;
  let count = Number(database.get('SELECT COUNT(*) AS n FROM monthly_plan_items WHERE monthly_plan_id = ?', draft.id).n);
  const results = [];
  for (const planItemId of ids) {
    try {
      const result = database.transaction(() => {
        if (!readableSource(database, workspaceId, context, planItemId)) {
          fail('monthly_plan_source_unavailable', 'Мероприятие не найдено или недоступно.', 404);
        }
        const existing = database.get('SELECT id FROM monthly_plan_items WHERE monthly_plan_id = ? AND plan_item_id = ?', draft.id, planItemId);
        if (existing) return { planItemId, id: existing.id, status: 'existing' };
        const source = sourceItem(database, workspaceId, planItemId, context);
        if (source.plan_status !== 'active' || source.status === 'cancelled') {
          fail('monthly_plan_source_inactive', 'Мероприятие отменено или его план находится в архиве.', 409);
        }
        if (count >= MAX_ITEMS) fail('monthly_plan_items_too_many', 'В месячном плане допускается не более 5000 мероприятий.');
        const id = newId('monthitem');
        database.run(`
          INSERT INTO monthly_plan_items(id, monthly_plan_id, plan_item_id, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, id, draft.id, planItemId, position, now, now);
        return { planItemId, id, status: 'added' };
      });
      if (result.status === 'added') { position += 1; count += 1; }
      results.push(result);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      results.push({ planItemId, status: 'error', code: error.code, message: error.message });
    }
  }
  return results;
}

export function createMonthlyPlan(database, workspaceId, input, context, now = new Date().toISOString()) {
  requireInput(input);
  const actorId = requireActor(database, workspaceId, context);
  const month = normalizeMonthlyPlanMonth(input.month);
  const title = input.title === undefined ? `План кафедры · ${month}` : boundedText(input.title, 500, 'title');
  const templateId = assertTemplate(database, workspaceId, input.templateId, context);
  const eventTemplateVersionId = assertEventTemplate(database, workspaceId, input.eventTemplateVersionId, context);
  const departmentText = input.departmentText === undefined ? '' : boundedText(input.departmentText, 500, 'departmentText', { empty: true });
  const ids = itemIds(input.planItemIds, { optional: true });
  const key = boundedText(input.idempotencyKey, 200, 'idempotencyKey');
  // Preserve old idempotency keys across schema upgrades when no new fields are supplied.
  const requestSnapshot = { month, title, templateId, planItemIds: [...ids].sort() };
  if (eventTemplateVersionId || departmentText) Object.assign(requestSnapshot, { eventTemplateVersionId, departmentText });
  const hash = createHash('sha256').update(JSON.stringify(requestSnapshot)).digest('hex');
  return database.transaction(() => {
    const existing = database.get('SELECT * FROM monthly_plans WHERE workspace_id = ? AND idempotency_key = ?', workspaceId, key);
    if (existing) {
      draftRow(database, workspaceId, existing.id, context);
      if (existing.request_hash !== hash) fail('monthly_plan_idempotency_conflict', 'Этот запрос уже использован для другого месячного плана.', 409);
      return { ...getMonthlyPlan(database, workspaceId, existing.id, context), duplicateRequest: true, results: [] };
    }
    const id = newId('monthly');
    database.run(`
      INSERT INTO monthly_plans(id, workspace_id, month_key, title, template_id, event_template_version_id, department_text, revision,
        idempotency_key, request_hash, created_by_person_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `, id, workspaceId, month, title, templateId, eventTemplateVersionId, departmentText, key, hash, actorId, now, now);
    const results = addItems(database, workspaceId, { id }, ids, context, now);
    audit(database, workspaceId, context, 'monthly_plan.created', id, { month, itemIds: results.filter((row) => row.status === 'added').map((row) => row.id) }, now);
    return { ...getMonthlyPlan(database, workspaceId, id, context), duplicateRequest: false, results };
  });
}

export function addMonthlyPlanItems(database, workspaceId, id, input, context, now = new Date().toISOString()) {
  requireInput(input);
  const ids = itemIds(input.planItemIds);
  return database.transaction(() => {
    const draft = draftRow(database, workspaceId, id, context);
    if (input.expectedRevision !== undefined) assertMonthlyPlanRevision(draft, input.expectedRevision);
    const results = addItems(database, workspaceId, draft, ids, context, now);
    const added = results.filter((row) => row.status === 'added').map((row) => row.id);
    if (added.length) {
      bumpRevision(database, id, now);
      audit(database, workspaceId, context, 'monthly_plan.items_added', id, { itemIds: added }, now);
    }
    return { draft: getMonthlyPlan(database, workspaceId, id, context), results };
  });
}

export function updateMonthlyPlan(database, workspaceId, id, input, context, now = new Date().toISOString()) {
  requireInput(input);
  return database.transaction(() => {
    const current = draftRow(database, workspaceId, id, context);
    assertMonthlyPlanRevision(current, input.expectedRevision);
    const title = input.title === undefined ? current.title : boundedText(input.title, 500, 'title');
    const month = input.month === undefined ? current.month_key : normalizeMonthlyPlanMonth(input.month);
    const templateId = input.templateId === undefined ? current.template_id : assertTemplate(database, workspaceId, input.templateId, context);
    const eventTemplateVersionId = input.eventTemplateVersionId === undefined ? current.event_template_version_id : assertEventTemplate(database, workspaceId, input.eventTemplateVersionId, context);
    const departmentText = input.departmentText === undefined ? current.department_text : boundedText(input.departmentText, 500, 'departmentText', { empty: true });
    let reordered = false;
    if (input.orderedItemIds !== undefined) {
      const ids = itemIds(input.orderedItemIds);
      const currentIds = database.all('SELECT id FROM monthly_plan_items WHERE monthly_plan_id = ? ORDER BY position, id', id).map((row) => row.id);
      if (ids.length !== currentIds.length || new Set(input.orderedItemIds).size !== ids.length || ids.some((value) => !currentIds.includes(value))) {
        fail('monthly_plan_order_invalid', 'Состав плана изменился. Обновите список перед перемещением строк.', 409);
      }
      reordered = ids.some((value, index) => currentIds[index] !== value);
      if (reordered) ids.forEach((value, position) => database.run(
        'UPDATE monthly_plan_items SET position = ?, updated_at = ? WHERE monthly_plan_id = ? AND id = ?', position, now, id, value
      ));
    }
    const changed = title !== current.title || month !== current.month_key || templateId !== current.template_id
      || eventTemplateVersionId !== current.event_template_version_id || departmentText !== current.department_text || reordered;
    if (changed) {
      database.run('UPDATE monthly_plans SET title = ?, month_key = ?, template_id = ?, event_template_version_id = ?, department_text = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
        title, month, templateId, eventTemplateVersionId, departmentText, now, id);
      audit(database, workspaceId, context, 'monthly_plan.updated', id, {
        previous: { title: current.title, month: current.month_key, templateId: current.template_id, eventTemplateVersionId: current.event_template_version_id, departmentText: current.department_text },
        next: { title, month, templateId, eventTemplateVersionId, departmentText }, reordered
      }, now);
    }
    return getMonthlyPlan(database, workspaceId, id, context);
  });
}

export function updateMonthlyPlanItem(database, workspaceId, id, itemId, input, context, now = new Date().toISOString()) {
  requireInput(input);
  return database.transaction(() => {
    const draft = draftRow(database, workspaceId, id, context);
    assertMonthlyPlanRevision(draft, input.expectedRevision);
    const item = database.get('SELECT * FROM monthly_plan_items WHERE monthly_plan_id = ? AND id = ?', id, itemId);
    if (!item) fail('monthly_plan_item_not_found', 'Строка месячного плана не найдена.', 404);
    if (!readableSource(database, workspaceId, context, item.plan_item_id)) {
      fail('monthly_plan_source_unavailable', 'Источник строки недоступен. Можно убрать её из месячного плана.', 403);
    }
    const fields = [
      ['titleOverride', 'title_override', 1000, false], ['dateTextOverride', 'date_text_override', 500, true],
      ['responsibleOverride', 'responsible_override', 1000, true],
      ['locationOverride', 'location_override', 1000, true],
      ['expectedResultOverride', 'expected_result_override', 4000, true], ['note', 'note', 4000, true]
    ];
    const changes = fields.filter(([field]) => input[field] !== undefined).map(([field, column, max, empty]) => ({
      column, value: boundedText(input[field], max, field, { nullable: true, empty })
    })).filter(({ column, value }) => item[column] !== value);
    if (input.customValues !== undefined) {
      let values = {};
      if (input.customValues !== null) {
        values = parseJson(item.custom_values_json, {});
        if (!input.customValues || typeof input.customValues !== 'object' || Array.isArray(input.customValues)) fail('event_custom_values_invalid', 'Передайте значения дополнительных полей.');
        if (Object.keys(input.customValues).length) {
          if (!draft.event_template_version_id) fail('event_template_version_required', 'Выберите настраиваемый шаблон для дополнительных полей.');
          const template = getEventTemplateVersion(database, workspaceId, draft.event_template_version_id, context);
          const source = sourceItem(database, workspaceId, item.plan_item_id, context);
          const patch = normalizeEventCustomValues(input.customValues, template.definition, {
            existingValues: { ...(source?.customValues || {}), ...values }
          });
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete values[key];
            else values[key] = value;
          }
        }
      }
      const serialized = JSON.stringify(values);
      if (serialized !== item.custom_values_json) changes.push({ column: 'custom_values_json', value: serialized });
    }
    if (changes.length) {
      database.run(`UPDATE monthly_plan_items SET ${changes.map(({ column }) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...changes.map(({ value }) => value), now, itemId);
      bumpRevision(database, id, now);
      audit(database, workspaceId, context, 'monthly_plan.item_updated', id, {
        itemId, previous: Object.fromEntries(changes.map(({ column }) => [column, item[column]])),
        next: Object.fromEntries(changes.map(({ column, value }) => [column, value]))
      }, now);
    }
    return getMonthlyPlan(database, workspaceId, id, context);
  });
}

export function removeMonthlyPlanItem(database, workspaceId, id, itemId, input, context, now = new Date().toISOString()) {
  requireInput(input);
  return database.transaction(() => {
    const draft = draftRow(database, workspaceId, id, context);
    const item = database.get('SELECT * FROM monthly_plan_items WHERE monthly_plan_id = ? AND id = ?', id, itemId);
    if (!item) return getMonthlyPlan(database, workspaceId, id, context);
    assertMonthlyPlanRevision(draft, input.expectedRevision);
    database.run('DELETE FROM monthly_plan_items WHERE monthly_plan_id = ? AND id = ?', id, itemId);
    bumpRevision(database, id, now);
    audit(database, workspaceId, context, 'monthly_plan.item_removed', id, { itemId, previous: item }, now);
    return getMonthlyPlan(database, workspaceId, id, context);
  });
}
