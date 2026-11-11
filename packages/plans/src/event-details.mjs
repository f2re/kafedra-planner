import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import { requireAuthenticated } from '../../auth/src/policy.mjs';
import { assertPlanItemAccess, resolvePlanItemAccess } from './access.mjs';
import { getEventTemplateVersion, normalizeEventCustomValues } from './event-templates.mjs';

function fail(code, message, status = 400, details) { throw new AppError(code, message, status, details); }
function source(database, workspaceId, id) {
  const row = database.get(`SELECT pi.id,pi.status,p.status AS plan_status FROM plan_items pi
    JOIN plans p ON p.id=pi.plan_id WHERE p.workspace_id=? AND pi.id=?`, workspaceId, id);
  if (!row) fail('plan_item_not_found', 'Мероприятие не найдено.', 404);
  return row;
}
function active(row) { return row.plan_status === 'active' && row.status !== 'cancelled'; }

export function getPlanEventDetails(database, workspaceId, planItemId, context) {
  requireAuthenticated(context);
  assertPlanItemAccess(database, workspaceId, context, planItemId, 'read');
  const item = source(database, workspaceId, planItemId);
  const details = database.get('SELECT * FROM plan_item_details WHERE workspace_id=? AND plan_item_id=?', workspaceId, planItemId);
  return {
    planItemId, location: details?.location || '', customValues: details ? JSON.parse(details.custom_values_json) : {},
    revision: details?.revision || 0,
    canEdit: active(item) && resolvePlanItemAccess(database, workspaceId, context, planItemId, 'edit').allowed,
    updatedAt: details?.updated_at || null
  };
}

export function addEventDetailsToSource(database, workspaceId, item, context) {
  const details = getPlanEventDetails(database, workspaceId, item.id, context);
  return { ...item, location: details.location, customValues: details.customValues,
    detailsRevision: details.revision, canEditDetails: details.canEdit };
}

export function updatePlanEventDetails(database, workspaceId, planItemId, input, context, now = new Date().toISOString()) {
  requireAuthenticated(context);
  assertPlanItemAccess(database, workspaceId, context, planItemId, 'edit');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('event_details_input_invalid', 'Передайте поля мероприятия.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('event_details_revision_required', 'Обновите мероприятие перед сохранением.');
  const actorId = context.personId || null;
  if (context.enabled && !actorId) fail('event_details_profile_required', 'Нужен профиль сотрудника.', 403);
  if (actorId && !database.get('SELECT id FROM people WHERE workspace_id=? AND id=?', workspaceId, actorId)) fail('event_details_profile_required', 'Профиль сотрудника не найден.', 403);
  return database.transaction(() => {
    if (!active(source(database, workspaceId, planItemId))) fail('event_details_source_inactive', 'План находится в архиве или мероприятие отменено.', 409);
    const previous = getPlanEventDetails(database, workspaceId, planItemId, context);
    if (input.expectedRevision !== previous.revision) fail('event_details_revision_conflict', 'Мероприятие уже изменено. Обновите его и повторите правку.', 409, { revision: previous.revision });
    let location = previous.location;
    if (input.location !== undefined) {
      if (typeof input.location !== 'string' || input.location.trim().length > 1000) fail('event_location_invalid', 'Укажите место проведения длиной не более 1000 знаков.');
      location = input.location.trim();
    }
    const customValues = { ...previous.customValues };
    if (input.customValues !== undefined) {
      if (!input.customValues || typeof input.customValues !== 'object' || Array.isArray(input.customValues)) fail('event_custom_values_invalid', 'Передайте значения дополнительных полей.');
      if (Object.keys(input.customValues).length) {
        if (typeof input.templateVersionId !== 'string' || !input.templateVersionId) fail('event_template_version_required', 'Выберите версию шаблона для дополнительных полей.');
        const template = getEventTemplateVersion(database, workspaceId, input.templateVersionId, context);
        const values = normalizeEventCustomValues(input.customValues, template.definition, { existingValues: previous.customValues });
        for (const [key, value] of Object.entries(values)) {
          if (value === null) delete customValues[key];
          else customValues[key] = value;
        }
      }
    }
    if (location === previous.location && JSON.stringify(customValues) === JSON.stringify(previous.customValues)) return previous;
    if (Object.keys(customValues).length > 200) fail('event_custom_values_limit', 'У мероприятия слишком много дополнительных полей.');
    database.run(`INSERT INTO plan_item_details(plan_item_id,workspace_id,location,custom_values_json,revision,updated_by_person_id,created_at,updated_at)
      VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(plan_item_id) DO UPDATE SET
      location=excluded.location,custom_values_json=excluded.custom_values_json,revision=plan_item_details.revision+1,
      updated_by_person_id=excluded.updated_by_person_id,updated_at=excluded.updated_at`,
    planItemId, workspaceId, location, JSON.stringify(customValues), actorId, now, now);
    database.run(`INSERT INTO audit_log(id,workspace_id,actor,action,subject_kind,subject_id,details_json,created_at)
      VALUES (?,?,?,'plan_event.details_updated','plan_item',?,?,?)`, newId('audit'), workspaceId, actorId || 'operator', planItemId,
    JSON.stringify({ provenance: 'manual', previous: { location: previous.location, customValues: previous.customValues, revision: previous.revision }, next: { location, customValues, revision: previous.revision + 1 } }), now);
    return getPlanEventDetails(database, workspaceId, planItemId, context);
  });
}
