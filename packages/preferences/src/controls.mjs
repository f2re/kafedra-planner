import { newId } from '../../core/src/ids.mjs';

const LEARNING_CONTEXT = '__control.learning__';
const PIN_PREFIX = '__pin__:';
const RESERVED_INTERACTIONS = new Set(['control', 'pin', 'explicit']);

export const SAFE_PIN_KEYS = Object.freeze([
  'calendar.mode',
  'calendar.new.kind',
  'calendar.new.date_offset',
  'calendar.new.category',
  'calendar.new.importance',
  'calendar.new.reminder',
  'template.document.type',
  'template.field.type',
  'template.field.strategy',
  'template.field.required',
  'meeting.new.date_offset',
  'work.periodic.period_kind',
  'work.periodic.direction',
  'work.periodic.start_offset',
  'work.periodic.due_offset',
  'plans.filter.kind',
  'plans.filter.period',
  'plans.filter.direction',
  'plan.item.direction',
  'search.filter.source_kind',
  'search.filter.direction',
  'search.filter.role',
  'search.filter.status',
  'search.filter.report',
  'science.filter.kind',
  'planfact.scope',
  'planfact.filter.direction',
  'planfact.filter.status',
  'planfact.filter.period_kind'
]);

function accountScope(accountId) {
  return String(accountId || '__default__');
}

function pinContext(key) {
  return `${PIN_PREFIX}${key}`;
}

function candidateExists(database, workspaceId, scope, key, value) {
  return Boolean(database.get(`
    SELECT 1 AS present
    FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_scope = ? AND context_key = ? AND choice_value = ?
      AND interaction_id NOT IN ('control', 'pin', 'explicit')
    LIMIT 1
  `, workspaceId, scope, key, value));
}

export function readPreferenceControls(database, workspaceId, accountId = null) {
  const scope = accountScope(accountId);
  const learning = database.get(`
    SELECT choice_value FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_scope = ? AND context_key = ? AND interaction_id = 'control'
    ORDER BY selected_at DESC LIMIT 1
  `, workspaceId, scope, LEARNING_CONTEXT);
  const pins = database.all(`
    SELECT context_key, choice_value FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_scope = ? AND interaction_id = 'pin'
      AND context_key LIKE '__pin__:%'
    ORDER BY selected_at DESC, id DESC
  `, workspaceId, scope);
  const pinned = {};
  for (const row of pins) {
    const key = String(row.context_key).slice(PIN_PREFIX.length);
    if (SAFE_PIN_KEYS.includes(key) && !(key in pinned)) pinned[key] = row.choice_value;
  }
  return {
    learningEnabled: learning?.choice_value !== '0',
    pinned,
    safePinKeys: [...SAFE_PIN_KEYS]
  };
}

export function setPreferenceLearning(database, workspaceId, accountId, enabled, now = new Date().toISOString()) {
  const scope = accountScope(accountId);
  const value = enabled === false ? '0' : '1';
  database.transaction(() => {
    database.run(`
      DELETE FROM ui_choice_preferences
      WHERE workspace_id = ? AND account_scope = ? AND context_key = ? AND interaction_id = 'control'
    `, workspaceId, scope, LEARNING_CONTEXT);
    database.run(`
      INSERT INTO ui_choice_preferences(
        id, workspace_id, account_scope, context_key, choice_value,
        interaction_id, selected_at, last_selected_at
      ) VALUES (?, ?, ?, ?, ?, 'control', ?, ?)
    `, newId('prefctl'), workspaceId, scope, LEARNING_CONTEXT, value, now, now);
  });
  return readPreferenceControls(database, workspaceId, accountId);
}

export function setPinnedPreference(database, workspaceId, accountId, key, value, now = new Date().toISOString()) {
  const normalizedKey = String(key || '').trim();
  if (!SAFE_PIN_KEYS.includes(normalizedKey)) throw new Error('preference_pin_key_forbidden');
  const normalizedValue = value == null || value === '' ? null : String(value);
  const scope = accountScope(accountId);
  if (normalizedValue && !candidateExists(database, workspaceId, scope, normalizedKey, normalizedValue)) {
    throw new Error('preference_pin_value_unknown');
  }
  const context = pinContext(normalizedKey);
  database.transaction(() => {
    database.run(`
      DELETE FROM ui_choice_preferences
      WHERE workspace_id = ? AND account_scope = ? AND context_key = ? AND interaction_id = 'pin'
    `, workspaceId, scope, context);
    if (normalizedValue) {
      database.run(`
        INSERT INTO ui_choice_preferences(
          id, workspace_id, account_scope, context_key, choice_value,
          interaction_id, selected_at, last_selected_at
        ) VALUES (?, ?, ?, ?, ?, 'pin', ?, ?)
      `, newId('prefpin'), workspaceId, scope, context, normalizedValue, now, now);
    }
  });
  return readPreferenceControls(database, workspaceId, accountId);
}

export function resetLearnedPreferences(database, workspaceId, accountId) {
  const scope = accountScope(accountId);
  const before = Number(database.get(`
    SELECT COUNT(*) AS count FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_scope = ?
  `, workspaceId, scope)?.count || 0);
  database.run(`
    DELETE FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_scope = ?
      AND interaction_id NOT IN ('control', 'pin', 'explicit')
      AND context_key NOT LIKE '__control.%'
      AND context_key NOT LIKE '__pin__:%'
  `, workspaceId, scope);
  const after = Number(database.get(`
    SELECT COUNT(*) AS count FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_scope = ?
  `, workspaceId, scope)?.count || 0);
  return { deleted: Math.max(0, before - after), controls: readPreferenceControls(database, workspaceId, accountId) };
}

export function preferenceControlRow(row) {
  return RESERVED_INTERACTIONS.has(String(row?.interaction_id || ''))
    || String(row?.context_key || '').startsWith('__control.')
    || String(row?.context_key || '').startsWith(PIN_PREFIX);
}
