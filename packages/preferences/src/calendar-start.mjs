import { AppError } from '../../core/src/errors.mjs';

const SETTING_CONTEXT = 'settings.calendar.start_mode';
const SETTING_INTERACTION = 'explicit';
const START_MODES = new Set(['auto', 'month', 'week', 'tasks']);
const CALENDAR_MODES = new Set(['month', 'week', 'tasks']);

function normalizeStartMode(value) {
  const mode = String(value ?? '').trim();
  if (!START_MODES.has(mode)) {
    throw new AppError(
      'calendar_start_mode_invalid',
      'Выберите автоматический режим, месяц, неделю или задачи.',
      400
    );
  }
  return mode;
}

function validCalendarMode(value) {
  const mode = String(value ?? '').trim();
  return CALENDAR_MODES.has(mode) ? mode : null;
}

export function resolveCalendarStartMode({ setting = 'auto', learned = null, legacy = null } = {}) {
  const explicit = String(setting ?? '').trim();
  if (CALENDAR_MODES.has(explicit)) return explicit;
  return validCalendarMode(learned) || validCalendarMode(legacy) || 'month';
}

export function readCalendarStartMode(database, workspaceId, accountId) {
  if (!accountId) return 'auto';
  const row = database.get(`
    SELECT choice_value
    FROM ui_choice_preferences
    WHERE workspace_id = ? AND account_id = ?
      AND context_key = ? AND interaction_id = ?
  `, workspaceId, accountId, SETTING_CONTEXT, SETTING_INTERACTION);
  return START_MODES.has(row?.choice_value) ? row.choice_value : 'auto';
}

export function writeCalendarStartMode(
  database,
  workspaceId,
  accountId,
  value,
  now = new Date().toISOString()
) {
  if (!accountId) {
    throw new AppError(
      'calendar_start_mode_account_required',
      'Персональная настройка доступна после входа в аккаунт.',
      409
    );
  }
  const account = database.get(
    'SELECT id FROM auth_accounts WHERE workspace_id = ? AND id = ? AND is_active = 1',
    workspaceId,
    accountId
  );
  if (!account) {
    throw new AppError('account_not_found', 'Аккаунт не найден.', 404);
  }
  const mode = normalizeStartMode(value);
  database.run(`
    INSERT INTO ui_choice_preferences(
      workspace_id, account_id, context_key, choice_value, interaction_id, selected_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, account_id, context_key, interaction_id)
    DO UPDATE SET choice_value = excluded.choice_value, selected_at = excluded.selected_at
  `, workspaceId, accountId, SETTING_CONTEXT, mode, SETTING_INTERACTION, now);
  return mode;
}

export function calendarStartModeSettingKey() {
  return SETTING_CONTEXT;
}
