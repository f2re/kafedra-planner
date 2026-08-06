import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';

const FILTER_KEYS = new Set([
  'scope',
  'personId',
  'from',
  'to',
  'direction',
  'status',
  'periodKind',
  'periodKey',
  'ownerPersonId',
  'managerPersonId'
]);

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeFilters(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!FILTER_KEYS.has(key)) continue;
    const text = String(value ?? '').trim();
    if (text) result[key] = text;
  }
  return result;
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    ownerPersonId: row.owner_person_id,
    ownerName: row.owner_name,
    createdByPersonId: row.created_by_person_id,
    createdByName: row.created_by_name,
    isShared: Boolean(row.is_shared),
    filters: parseJson(row.filters_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at
  };
}

function requirePerson(database, workspaceId, personId, label) {
  if (!personId) return null;
  const person = database.get(
    'SELECT id FROM people WHERE workspace_id = ? AND id = ?',
    workspaceId,
    personId
  );
  if (!person) throw new AppError('person_not_found', `${label} не найден.`, 404);
  return person.id;
}

export function listPlanFactViews(database, workspaceId, personId = null) {
  const rows = personId
    ? database.all(`
        SELECT v.*, owner.display_name AS owner_name, creator.display_name AS created_by_name
        FROM plan_fact_saved_views v
        LEFT JOIN people owner ON owner.id = v.owner_person_id
        LEFT JOIN people creator ON creator.id = v.created_by_person_id
        WHERE v.workspace_id = ?
          AND (v.is_shared = 1 OR v.owner_person_id IS NULL OR v.owner_person_id = ?)
        ORDER BY v.is_shared DESC, v.updated_at DESC, v.name
      `, workspaceId, personId)
    : database.all(`
        SELECT v.*, owner.display_name AS owner_name, creator.display_name AS created_by_name
        FROM plan_fact_saved_views v
        LEFT JOIN people owner ON owner.id = v.owner_person_id
        LEFT JOIN people creator ON creator.id = v.created_by_person_id
        WHERE v.workspace_id = ? AND (v.is_shared = 1 OR v.owner_person_id IS NULL)
        ORDER BY v.is_shared DESC, v.updated_at DESC, v.name
      `, workspaceId);
  return { items: rows.map(serialize) };
}

export function savePlanFactView(database, workspaceId, input, now = new Date().toISOString()) {
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 100) {
    throw new AppError('view_name_invalid', 'Название представления должно содержать от 2 до 100 символов.', 400);
  }
  const ownerPersonId = requirePerson(
    database,
    workspaceId,
    input.ownerPersonId || null,
    'Владелец представления'
  );
  const createdByPersonId = requirePerson(
    database,
    workspaceId,
    input.createdByPersonId || ownerPersonId || null,
    'Автор представления'
  );
  const isShared = input.isShared ? 1 : 0;
  const filters = normalizeFilters(input.filters);
  const existing = database.get(`
    SELECT id FROM plan_fact_saved_views
    WHERE workspace_id = ? AND name = ?
      AND COALESCE(owner_person_id, '') = COALESCE(?, '')
  `, workspaceId, name, ownerPersonId);

  const id = existing?.id || newId('planview');
  if (existing) {
    database.run(`
      UPDATE plan_fact_saved_views
      SET created_by_person_id = ?, is_shared = ?, filters_json = ?, updated_at = ?
      WHERE id = ?
    `, createdByPersonId, isShared, JSON.stringify(filters), now, id);
  } else {
    database.run(`
      INSERT INTO plan_fact_saved_views(
        id, workspace_id, name, owner_person_id, created_by_person_id,
        is_shared, filters_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, workspaceId, name, ownerPersonId, createdByPersonId,
    isShared, JSON.stringify(filters), now, now);
  }
  return listPlanFactViews(database, workspaceId, ownerPersonId)
    .items.find((item) => item.id === id);
}

export function touchPlanFactView(database, workspaceId, viewId, now = new Date().toISOString()) {
  const row = database.get(
    'SELECT id FROM plan_fact_saved_views WHERE workspace_id = ? AND id = ?',
    workspaceId,
    viewId
  );
  if (!row) throw new AppError('view_not_found', 'Сохранённое представление не найдено.', 404);
  database.run(
    'UPDATE plan_fact_saved_views SET last_used_at = ? WHERE id = ?',
    now,
    viewId
  );
  return true;
}

export function deletePlanFactView(database, workspaceId, viewId, personId = null) {
  const row = database.get(`
    SELECT * FROM plan_fact_saved_views
    WHERE workspace_id = ? AND id = ?
  `, workspaceId, viewId);
  if (!row) throw new AppError('view_not_found', 'Сохранённое представление не найдено.', 404);
  if (personId && row.owner_person_id && row.owner_person_id !== personId) {
    throw new AppError('view_forbidden', 'Удалить это представление может только его владелец.', 403);
  }
  database.run('DELETE FROM plan_fact_saved_views WHERE id = ?', viewId);
  return true;
}

export { normalizeFilters as normalizePlanFactViewFilters };
