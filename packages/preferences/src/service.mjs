import { AppError } from '../../core/src/errors.mjs';

const FIXED_VALUES = new Map([
  ['calendar.mode', new Set(['month', 'week', 'tasks'])],
  ['calendar.new.kind', new Set(['event', 'task'])],
  ['calendar.new.category', new Set(['organizational', 'education', 'science', 'everyday'])],
  ['calendar.new.importance', new Set(['normal', 'high', 'critical', 'low'])],
  ['calendar.new.reminder', new Set(['', '0', '60', '1440', '4320', '10080'])],
  ['template.field.required', new Set(['0', '1'])]
]);
const PERSON_KEYS = new Set(['meeting.chairperson', 'meeting.secretary']);
const TEXT_KEYS = new Set(['template.document.type']);
const SUPPORTED_KEYS = new Set([...FIXED_VALUES.keys(), ...PERSON_KEYS, ...TEXT_KEYS]);

function preferenceError(code, message) {
  throw new AppError(code, message, 400);
}

function normalizeKey(value) {
  const key = String(value || '').trim();
  if (!SUPPORTED_KEYS.has(key)) preferenceError('ui_preference_key_invalid', 'Неизвестный контекст пользовательского выбора.');
  return key;
}

function normalizeValue(database, workspaceId, key, value) {
  const text = String(value ?? '');
  if (text.length > 240 || /[\u0000-\u001f\u007f]/u.test(text)) {
    preferenceError('ui_preference_value_invalid', 'Значение пользовательского выбора недопустимо.');
  }
  const allowed = FIXED_VALUES.get(key);
  if (allowed && !allowed.has(text)) preferenceError('ui_preference_value_invalid', 'Значение не разрешено для этого выбора.');
  if (PERSON_KEYS.has(key)) {
    const person = database.get(
      "SELECT id FROM people WHERE workspace_id = ? AND id = ? AND status = 'active'",
      workspaceId,
      text
    );
    if (!person) preferenceError('ui_preference_person_invalid', 'Выбранный сотрудник недоступен.');
  }
  if (TEXT_KEYS.has(key)) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 80 || !/^[\p{L}\p{N}._ -]+$/u.test(trimmed)) {
      preferenceError('ui_preference_value_invalid', 'Повторно используемое текстовое значение недопустимо.');
    }
    return trimmed;
  }
  return text;
}

function normalizeKeys(keys) {
  const source = Array.isArray(keys) && keys.length ? keys : [...SUPPORTED_KEYS];
  return [...new Set(source.map(normalizeKey))];
}

export function supportedUiPreferenceKeys() {
  return [...SUPPORTED_KEYS];
}

export function listUiPreferences(database, workspaceId, accountId, keys = []) {
  const normalizedKeys = normalizeKeys(keys);
  const result = Object.fromEntries(normalizedKeys.map((key) => [key, []]));
  if (!accountId || !normalizedKeys.length) return result;
  const placeholders = normalizedKeys.map(() => '?').join(',');
  const rows = database.all(`
    SELECT context_key, choice_value,
      COUNT(*) AS selection_count,
      MAX(selected_at) AS last_selected_at
    FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ? AND context_key IN (${placeholders})
    GROUP BY context_key, choice_value
    ORDER BY context_key, selection_count DESC, last_selected_at DESC, choice_value
  `, workspaceId, accountId, ...normalizedKeys);
  for (const row of rows) {
    result[row.context_key]?.push({
      value: row.choice_value,
      count: Number(row.selection_count || 0),
      lastSelectedAt: row.last_selected_at
    });
  }
  return result;
}

export function recordUiPreferences(database, workspaceId, accountId, input, now = new Date().toISOString()) {
  if (!accountId) return { preferences: listUiPreferences(database, workspaceId, null) };
  const interactionId = String(input?.interactionId || '').trim();
  if (!interactionId || interactionId.length > 120 || /[\u0000-\u001f\u007f]/u.test(interactionId)) {
    preferenceError('ui_preference_interaction_invalid', 'Не удалось идентифицировать пользовательское действие.');
  }
  const rawChoices = Array.isArray(input?.choices) ? input.choices.slice(0, 32) : [];
  if (!rawChoices.length) preferenceError('ui_preference_choices_required', 'Нет пользовательских выборов для сохранения.');
  const choices = [];
  const seenKeys = new Set();
  for (const raw of rawChoices) {
    const key = normalizeKey(raw?.key);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    choices.push({ key, value: normalizeValue(database, workspaceId, key, raw?.value) });
  }
  database.transaction(() => {
    for (const choice of choices) {
      database.run(`
        INSERT OR IGNORE INTO ui_choice_preferences(
          workspace_id, account_id, context_key, choice_value, interaction_id, selected_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, workspaceId, accountId, choice.key, choice.value, interactionId, now);
    }
  });
  return { preferences: listUiPreferences(database, workspaceId, accountId, choices.map((choice) => choice.key)) };
}
