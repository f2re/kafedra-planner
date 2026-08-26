import { AppError } from '../../core/src/errors.mjs';

const FIXED_VALUES = new Map([
  ['calendar.mode', new Set(['month', 'week', 'tasks'])],
  ['calendar.filter.kind', new Set(['all', 'event', 'task'])],
  ['calendar.new.kind', new Set(['event', 'task'])],
  ['calendar.new.category', new Set(['organizational', 'education', 'science', 'everyday'])],
  ['calendar.new.importance', new Set(['normal', 'high', 'critical', 'low'])],
  ['calendar.new.reminder', new Set(['', '0', '60', '1440', '4320', '10080'])],
  ['template.field.required', new Set(['0', '1'])],
  ['template.field.type', new Set(['string', 'text', 'date', 'number', 'boolean'])],
  ['template.field.strategy', new Set(['after_label', 'next_line', 'line', 'between'])],
  ['work.periodic.period_kind', new Set(['semester', 'academic_year', 'calendar_year', 'quarter', 'custom'])],
  ['work.periodic.direction', new Set(['organizational', 'education', 'science'])],
  ['work.filter.direction', new Set(['science', 'education', 'organizational', 'personnel', 'safety', 'finance', 'digital'])],
  ['work.filter.status', new Set(['open', 'submitted', 'completed', 'cancelled'])],
  ['plans.filter.kind', new Set(['department', 'faculty', 'personal', 'unit', 'organization'])],
  ['plans.filter.direction', new Set(['education', 'science', 'organizational', 'everyday'])],
  ['plan.item.direction', new Set(['organizational', 'education', 'science', 'everyday'])],
  ['plan.item.execution_mode', new Set(['track', 'assigned', 'open'])],
  ['search.filter.source_kind', new Set(['document', 'protocol', 'directive', 'assignment', 'periodic_task', 'plans', 'science'])],
  ['search.filter.direction', new Set(['science', 'education', 'organizational', 'personnel', 'safety', 'finance', 'digital'])],
  ['search.filter.role', new Set(['executor', 'controller', 'observer'])],
  ['search.filter.status', new Set(['open', 'overdue', 'submitted', 'rework', 'completed', 'proposed', 'active'])],
  ['search.filter.report', new Set(['with', 'without', 'submitted', 'confirmed'])],
  ['science.filter.kind', new Set(['article', 'conference', 'grant', 'patent', 'project', 'nir_report'])],
  ['planfact.scope', new Set(['department', 'owner', 'manager'])],
  ['planfact.filter.direction', new Set(['science', 'education', 'organizational', 'personnel', 'safety', 'finance', 'digital'])],
  ['planfact.filter.status', new Set(['open', 'submitted', 'rework', 'completed'])],
  ['planfact.filter.period_kind', new Set(['semester', 'academic_year', 'calendar_year', 'quarter'])],
  ['work.periodic.edit.status', new Set(['open', 'completed', 'cancelled'])],
  ['admin.object.kind', new Set(['document', 'directive', 'scientific_item'])]
]);

const SET_KEYS = new Map([
  ['calendar.filter.categories', ['science', 'education', 'organizational', 'everyday']]
]);

const PERSON_KEYS = new Map([
  ['meeting.chairperson', { allowEmpty: false }],
  ['meeting.secretary', { allowEmpty: false }],
  ['work.periodic.owner', { allowEmpty: false }],
  ['work.periodic.manager', { allowEmpty: true }],
  ['work.responsibility.executor', { allowEmpty: true }],
  ['work.responsibility.controller', { allowEmpty: true }],
  ['plan.item.executor', { allowEmpty: true }],
  ['plan.item.controller', { allowEmpty: true }],
  ['profile.current_person', { allowEmpty: true }]
]);

const DATE_OFFSET_KEYS = new Map([
  ['calendar.new.date_offset', { min: -365, max: 365, allowNone: false }],
  ['meeting.new.date_offset', { min: -365, max: 365, allowNone: false }],
  ['work.periodic.start_offset', { min: -1095, max: 1095, allowNone: true }],
  ['work.periodic.due_offset', { min: -1095, max: 1095, allowNone: false }],
  ['plan.item.start_offset', { min: -1095, max: 1095, allowNone: true }],
  ['plan.item.end_offset', { min: -1095, max: 1095, allowNone: true }],
  ['plan.item.due_offset', { min: -1095, max: 1095, allowNone: true }]
]);

const TEXT_KEYS = new Set([
  'template.document.type',
  'plans.filter.period'
]);

const SAFE_TEXT = /^[\p{L}\p{N}_.:/+() -]+$/u;
const SUPPORTED_KEYS = new Set([
  ...FIXED_VALUES.keys(),
  ...SET_KEYS.keys(),
  ...PERSON_KEYS.keys(),
  ...DATE_OFFSET_KEYS.keys(),
  ...TEXT_KEYS
]);

function validateDateOffset(key, text) {
  const config = DATE_OFFSET_KEYS.get(key);
  if (text === 'none' && config.allowNone) return text;
  const match = /^d:(-?\d{1,4})$/u.exec(text);
  if (!match) {
    throw new AppError('ui_preference_value_invalid', 'Недопустимое относительное значение даты.', 400, { key });
  }
  const days = Number(match[1]);
  if (!Number.isInteger(days) || days < config.min || days > config.max) {
    throw new AppError('ui_preference_value_invalid', 'Относительное значение даты вне допустимого диапазона.', 400, {
      key, min: config.min, max: config.max
    });
  }
  return `d:${days}`;
}

function validatePreferenceValue(database, workspaceId, key, value) {
  const text = String(value ?? '').trim();
  if (SET_KEYS.has(key)) {
    const order = SET_KEYS.get(key);
    const requested = [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];
    if (!requested.length || requested.some((item) => !order.includes(item))) {
      throw new AppError('ui_preference_value_invalid', 'Недопустимый набор пользовательских предпочтений.', 400, { key });
    }
    return order.filter((item) => requested.includes(item)).join(',');
  }
  const fixed = FIXED_VALUES.get(key);
  if (fixed) {
    if (!fixed.has(text)) {
      throw new AppError('ui_preference_value_invalid', 'Недопустимое значение пользовательского предпочтения.', 400, { key });
    }
    return text;
  }
  if (PERSON_KEYS.has(key)) {
    const { allowEmpty } = PERSON_KEYS.get(key);
    if (!text && allowEmpty) return '';
    const person = text && database.get(
      "SELECT id FROM people WHERE workspace_id=? AND id=? AND status='active'",
      workspaceId, text
    );
    if (!person) throw new AppError('ui_preference_value_invalid', 'Выбранный сотрудник недоступен.', 400, { key });
    return text;
  }
  if (DATE_OFFSET_KEYS.has(key)) return validateDateOffset(key, text);
  if (TEXT_KEYS.has(key)) {
    if (!text || text.length > 80 || !SAFE_TEXT.test(text)) {
      throw new AppError('ui_preference_value_invalid', 'Недопустимое повторно используемое значение.', 400, { key });
    }
    return text;
  }
  throw new AppError('ui_preference_key_invalid', 'Этот элемент интерфейса не разрешён для обучения.', 400, { key });
}

function normalizeChoice(database, workspaceId, choice) {
  const key = String(choice?.key || '').trim();
  if (!SUPPORTED_KEYS.has(key)) {
    throw new AppError('ui_preference_key_invalid', 'Этот элемент интерфейса не разрешён для обучения.', 400, { key });
  }
  return { key, value: validatePreferenceValue(database, workspaceId, key, choice?.value) };
}

export function supportedUiPreferenceKeys() {
  return [...SUPPORTED_KEYS].sort();
}

export function listUiPreferences(database, workspaceId, accountId, keys = supportedUiPreferenceKeys()) {
  const requested = [...new Set(keys.filter((key) => SUPPORTED_KEYS.has(key)))];
  const result = Object.fromEntries(requested.map((key) => [key, []]));
  if (!accountId || !requested.length) return result;
  const placeholders = requested.map(() => '?').join(',');
  const rows = database.all(`
    SELECT context_key AS key, choice_value AS value, COUNT(*) AS count, MAX(selected_at) AS last_selected_at
    FROM ui_choice_preferences
    WHERE workspace_id=? AND account_id=? AND context_key IN (${placeholders})
    GROUP BY context_key, choice_value
    ORDER BY context_key ASC, count DESC, last_selected_at DESC, choice_value ASC
  `, workspaceId, accountId, ...requested);
  for (const row of rows) {
    result[row.key].push({
      value: row.value,
      count: Number(row.count),
      lastSelectedAt: row.last_selected_at
    });
  }
  return result;
}

export function recordUiPreferences(database, workspaceId, accountId, body, now = new Date().toISOString()) {
  if (!accountId) return { preferences: listUiPreferences(database, workspaceId, null) };
  const interactionId = String(body?.interactionId || '').trim();
  if (!interactionId || interactionId.length > 120 || /[\u0000-\u001f\u007f]/u.test(interactionId)) {
    throw new AppError('ui_preference_interaction_invalid', 'Не удалось идентифицировать пользовательское действие.', 400);
  }
  const rawChoices = Array.isArray(body?.choices) ? body.choices.slice(0, 32) : [];
  if (!rawChoices.length) {
    throw new AppError('ui_preference_choices_required', 'Нет пользовательских выборов для сохранения.', 400);
  }
  const unique = new Map();
  for (const raw of rawChoices) {
    const choice = normalizeChoice(database, workspaceId, raw);
    if (!unique.has(choice.key)) unique.set(choice.key, choice);
  }
  const choices = [...unique.values()];
  database.transaction(() => {
    for (const choice of choices) {
      database.run(`
        INSERT OR IGNORE INTO ui_choice_preferences(
          workspace_id,account_id,context_key,choice_value,interaction_id,selected_at
        ) VALUES(?,?,?,?,?,?)
      `, workspaceId, accountId, choice.key, choice.value, interactionId, now);
    }
  });
  return {
    preferences: listUiPreferences(database, workspaceId, accountId, choices.map((choice) => choice.key))
  };
}
