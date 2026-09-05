const LEARNING_CONTEXT = '__control.learning__';
const PIN_PREFIX = '__pin__:';

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

function pinContext(key) {
  return `${PIN_PREFIX}${key}`;
}

function defaultControls() {
  return { learningEnabled: true, pinned: {}, safePinKeys: [...SAFE_PIN_KEYS] };
}

function requireAccount(accountId) {
  const value = String(accountId || '').trim();
  if (!value) throw new Error('preference_account_required');
  return value;
}

function candidateExists(database, workspaceId, accountId, key, value) {
  return Boolean(database.get(`
    SELECT 1 AS present
    FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ? AND context_key = ? AND choice_value = ?
      AND interaction_id NOT IN ('control', 'pin', 'explicit')
    LIMIT 1
  `, workspaceId, accountId, key, value));
}

export function readPreferenceControls(database, workspaceId, accountId = null) {
  if (!accountId) return defaultControls();
  const learning = database.get(`
    SELECT choice_value FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ? AND context_key = ? AND interaction_id = 'control'
    ORDER BY selected_at DESC LIMIT 1
  `, workspaceId, accountId, LEARNING_CONTEXT);
  const pins = database.all(`
    SELECT context_key, choice_value FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ? AND interaction_id = 'pin'
      AND context_key LIKE '__pin__:%'
    ORDER BY selected_at DESC, context_key ASC
  `, workspaceId, accountId);
  const pinned = {};
  for (const row of pins) {
    const key = String(row.context_key).slice(PIN_PREFIX.length);
    if (SAFE_PIN_KEYS.includes(key)) pinned[key] = row.choice_value;
  }
  return {
    learningEnabled: learning?.choice_value !== '0',
    pinned,
    safePinKeys: [...SAFE_PIN_KEYS]
  };
}

export function setPreferenceLearning(database, workspaceId, accountId, enabled, now = new Date().toISOString()) {
  const account = requireAccount(accountId);
  const value = enabled === false ? '0' : '1';
  database.transaction(() => {
    database.run(`
      DELETE FROM ui_choice_preferences
      WHERE workspace_id = ? AND account_id = ? AND context_key = ? AND interaction_id = 'control'
    `, workspaceId, account, LEARNING_CONTEXT);
    database.run(`
      INSERT INTO ui_choice_preferences(
        workspace_id, account_id, context_key, choice_value, interaction_id, selected_at
      ) VALUES (?, ?, ?, ?, 'control', ?)
    `, workspaceId, account, LEARNING_CONTEXT, value, now);
  });
  return readPreferenceControls(database, workspaceId, account);
}

export function setPinnedPreference(database, workspaceId, accountId, key, value, now = new Date().toISOString()) {
  const account = requireAccount(accountId);
  const normalizedKey = String(key || '').trim();
  if (!SAFE_PIN_KEYS.includes(normalizedKey)) throw new Error('preference_pin_key_forbidden');
  const normalizedValue = value == null || value === '' ? null : String(value);
  if (normalizedValue && !candidateExists(database, workspaceId, account, normalizedKey, normalizedValue)) {
    throw new Error('preference_pin_value_unknown');
  }
  const context = pinContext(normalizedKey);
  database.transaction(() => {
    database.run(`
      DELETE FROM ui_choice_preferences
      WHERE workspace_id = ? AND account_id = ? AND context_key = ? AND interaction_id = 'pin'
    `, workspaceId, account, context);
    if (normalizedValue) {
      database.run(`
        INSERT INTO ui_choice_preferences(
          workspace_id, account_id, context_key, choice_value, interaction_id, selected_at
        ) VALUES (?, ?, ?, ?, 'pin', ?)
      `, workspaceId, account, context, normalizedValue, now);
    }
  });
  return readPreferenceControls(database, workspaceId, account);
}

export function resetLearnedPreferences(database, workspaceId, accountId) {
  const account = requireAccount(accountId);
  const before = Number(database.get(`
    SELECT COUNT(*) AS count FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ?
  `, workspaceId, account)?.count || 0);
  database.run(`
    DELETE FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ?
      AND interaction_id NOT IN ('control', 'pin', 'explicit')
      AND context_key NOT LIKE '__control.%'
      AND context_key NOT LIKE '__pin__:%'
  `, workspaceId, account);
  const after = Number(database.get(`
    SELECT COUNT(*) AS count FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ?
  `, workspaceId, account)?.count || 0);
  return { deleted: Math.max(0, before - after), controls: readPreferenceControls(database, workspaceId, account) };
}
