import { newId } from '../../core/src/ids.mjs';
import { categoryFor, normalizeName, planLabel } from './shared.mjs';

export function findPerson(database, workspaceId, raw) {
  const normalized = normalizeName(raw);
  if (!normalized) return null;
  return database.get(`
    SELECT * FROM people
    WHERE workspace_id = ? AND normalized_name = ? AND status = 'active'
  `, workspaceId, normalized) || null;
}

export function addFacet(database, workspaceId, sourceKind, sourceId, name, value, now) {
  if (value === null || value === undefined || value === '') return;
  const text = String(value);
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(text);
  database.run(`
    INSERT INTO entity_facets(
      id, workspace_id, source_kind, source_id, facet_name,
      text_value, normalized_value, date_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('facet'), workspaceId, sourceKind, sourceId, name,
  isDate ? null : text, isDate ? null : normalizeName(text), isDate ? text : null, now);
}

export function addReview(database, workspaceId, versionId, issueCode, title, explanation, action, context, now) {
  const exists = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ?
      AND issue_code = ? AND status = 'open'
  `, workspaceId, versionId, issueCode);
  if (exists) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, newId('review'), workspaceId, versionId, issueCode, title,
  explanation, action, JSON.stringify(context || {}), now);
}

export function documentForVersion(database, workspaceId, versionId) {
  return database.get(`
    SELECT d.id, d.title, dv.original_name
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE d.workspace_id = ? AND dv.id = ?
  `, workspaceId, versionId) || null;
}

function calendarDescription(plan, item) {
  return [
    `Источник: ${planLabel(plan)}`,
    item.responsibleRaw ? `Ответственный: ${item.responsibleRaw}` : null,
    item.expectedResult ? `Ожидаемый результат: ${item.expectedResult}` : null,
    item.description || null
  ].filter(Boolean).join('\n');
}

export function insertCalendarItem(database, {
  workspaceId, plan, planItemId, item, documentId, startsAt, endsAt = null,
  title, kind, status, reminderMinutes = null, now
}) {
  database.run(`
    INSERT OR IGNORE INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, revision,
      origin_kind, origin_id, origin_label, origin_document_id, origin_locator_json,
      created_at, updated_at
    ) VALUES (?, ?, 'plan_item', ?, ?, ?, ?, 1, ?, 'normal', ?, ?, ?, ?, NULL, 1,
      'plan', ?, ?, ?, ?, ?, ?)
  `, newId('cal'), workspaceId, planItemId, title, startsAt, endsAt,
  categoryFor(item.direction), status, calendarDescription(plan, item), kind,
  reminderMinutes, plan.id, planLabel(plan), documentId,
  JSON.stringify(item.evidence?.locator || {}), now, now);
}
