const LOCAL_SETTING_KEY = 'kafedra-calendar-start-mode-v1';
const START_MODES = new Set(['auto', 'month', 'week', 'tasks']);
const FIXED_MODES = new Set(['month', 'week', 'tasks']);
const startState = { auth: null, setting: 'auto' };
let resolveReady;
window.kafedraCalendarStartReady = new Promise((resolve) => { resolveReady = resolve; });

function safeSetting(value) {
  const mode = String(value || '').trim();
  return START_MODES.has(mode) ? mode : 'auto';
}

function localSetting() {
  try { return safeSetting(localStorage.getItem(LOCAL_SETTING_KEY)); }
  catch { return 'auto'; }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function authContext() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (window.kafedraAuthReady) {
      try { return await window.kafedraAuthReady; }
      catch { return { authEnabled: true, authenticated: false }; }
    }
    if (window.kafedraAuthContext) return window.kafedraAuthContext;
    await delay(10);
  }
  return { authEnabled: true, authenticated: false };
}

async function loadSetting(context) {
  if (context?.authEnabled === false) return localSetting();
  if (!context?.authenticated) return 'auto';
  try {
    const response = await window.fetch('/api/ui-settings/calendar-start');
    if (!response.ok) return 'auto';
    const payload = await response.json().catch(() => ({}));
    return safeSetting(payload.calendarStartMode);
  } catch {
    return 'auto';
  }
}

function applyFixedSetting(mode) {
  if (!FIXED_MODES.has(mode)) return;
  document.documentElement.dataset.uiCalendarModeTouched = '1';
  const button = document.querySelector(`[data-calendar-mode="${mode}"]`);
  if (button && button.getAttribute('aria-selected') !== 'true') button.click();
}

function ensureDialog() {
  let sheet = document.querySelector('#calendar-start-settings-sheet');
  if (sheet) return sheet;
  sheet = document.createElement('section');
  sheet.id = 'calendar-start-settings-sheet';
  sheet.className = 'sheet hidden';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'calendar-start-settings-title');
  sheet.innerHTML = `
    <header class="sheet-header">
      <div><div class="eyebrow">Настройки</div><h2 id="calendar-start-settings-title">Календарь при открытии</h2></div>
      <button class="icon-button" type="button" data-close-sheet aria-label="Закрыть">×</button>
    </header>
    <form id="calendar-start-settings-form" class="sheet-body form-grid">
      <label class="field full">
        <span>Стартовый режим</span>
        <select name="calendarStartMode">
          <option value="auto">Автоматически</option>
          <option value="month">Месяц</option>
          <option value="week">Неделя</option>
          <option value="tasks">Задачи</option>
        </select>
      </label>
      <p class="helper full">«Автоматически» учитывает ваши явные переключения. Выбранные «Месяц», «Неделя» или «Задачи» всегда имеют приоритет над обучаемым выбором.</p>
      <p id="calendar-start-settings-status" class="helper full" role="status" aria-live="polite"></p>
      <div class="sheet-actions full">
        <button type="button" class="secondary-button" data-close-sheet>Закрыть</button>
        <button type="submit" class="primary-button">Сохранить</button>
      </div>
    </form>`;
  document.body.append(sheet);
  return sheet;
}

function ensureSettingsEntry() {
  const context = startState.auth;
  if (context?.authEnabled === false) {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    const target = mobile ? document.querySelector('.mobile-tabs') : document.querySelector('#navigation');
    if (!target) return;
    let button = document.querySelector('#calendar-settings-button');
    if (button && button.parentElement !== target) {
      button.remove();
      button = null;
    }
    if (button) return;
    button = document.createElement('button');
    button.id = 'calendar-settings-button';
    button.type = 'button';
    button.title = 'Настройки';
    button.setAttribute('aria-label', 'Настройки');
    if (mobile) {
      button.className = 'mobile-tab';
      button.innerHTML = '<span aria-hidden="true">⚙</span>Настройки';
    } else {
      button.className = 'nav-item';
      button.innerHTML = '<span class="nav-icon" aria-hidden="true">⚙</span><span>Настройки</span>';
    }
    target.append(button);
    return;
  }
  if (!context?.authenticated) return;
  const menu = document.querySelector('.auth-user-menu');
  if (!menu || menu.querySelector('[data-auth-action="settings"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.authAction = 'settings';
  button.textContent = 'Настройки';
  const password = menu.querySelector('[data-auth-action="password"]');
  menu.insertBefore(button, password || menu.firstChild);
}

function openSettings() {
  ensureSettingsEntry();
  const sheet = ensureDialog();
  const select = sheet.querySelector('select[name="calendarStartMode"]');
  select.value = startState.setting;
  sheet.querySelector('#calendar-start-settings-status').textContent = '';
  document.querySelector('#sheet-backdrop')?.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => select.focus());
}

async function saveSetting(mode) {
  const normalized = safeSetting(mode);
  if (startState.auth?.authEnabled === false) {
    localStorage.setItem(LOCAL_SETTING_KEY, normalized);
    startState.setting = normalized;
    return normalized;
  }
  const response = await window.fetch('/api/ui-settings/calendar-start', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ calendarStartMode: normalized })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Ошибка HTTP ${response.status}`);
  startState.setting = safeSetting(payload.calendarStartMode);
  return startState.setting;
}

async function initialize() {
  startState.auth = await authContext();
  startState.setting = await loadSetting(startState.auth);
  applyFixedSetting(startState.setting);
  ensureSettingsEntry();
  new MutationObserver(ensureSettingsEntry).observe(document.documentElement, { childList: true, subtree: true });
  window.matchMedia('(max-width: 720px)').addEventListener?.('change', ensureSettingsEntry);
  resolveReady(startState.setting);
}

initialize().catch(() => resolveReady('auto'));

document.addEventListener('click', (event) => {
  if (event.target.closest('#calendar-settings-button, [data-auth-action="settings"]')) openSettings();
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'calendar-start-settings-form') return;
  event.preventDefault();
  const form = event.target;
  const status = form.querySelector('#calendar-start-settings-status');
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  status.textContent = 'Сохранение…';
  try {
    const mode = await saveSetting(form.elements.namedItem('calendarStartMode').value);
    if (FIXED_MODES.has(mode)) applyFixedSetting(mode);
    status.textContent = mode === 'auto'
      ? 'Сохранено. Автоматический выбор применится при следующем открытии календаря.'
      : 'Сохранено. Этот режим будет открываться независимо от статистики использования.';
  } catch (error) {
    status.textContent = error.message || 'Не удалось сохранить настройку.';
  } finally {
    submit.disabled = false;
  }
});

window.kafedraCalendarStart = {
  get setting() { return startState.setting; },
  localKey: LOCAL_SETTING_KEY
};
