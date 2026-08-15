const preferenceState = {
  preferences: new Map(),
  transportFetch: null,
  installed: false,
  loaded: false,
  calendarModeTouched: false
};

const STATIC_BINDINGS = [
  ['#event-kind', 'calendar.new.kind'],
  ['#event-category', 'calendar.new.category'],
  ['#event-importance', 'calendar.new.importance'],
  ['#event-reminder', 'calendar.new.reminder'],
  ['#template-document-type', 'template.document.type'],
  ['#field-required', 'template.field.required']
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ranking(key) {
  return preferenceState.preferences.get(key) || [];
}

function setPreferencePayload(payload) {
  const source = payload?.preferences || {};
  for (const [key, rows] of Object.entries(source)) {
    preferenceState.preferences.set(key, Array.isArray(rows) ? rows : []);
  }
}

function preferredValue(key, allowed = null, fallback = null) {
  for (const row of ranking(key)) {
    if (!allowed || allowed.includes(row.value)) return row.value;
  }
  return fallback;
}

function rankSelect(select, key, { chooseDefault = false } = {}) {
  if (!select) return;
  const selected = select.value;
  const rows = ranking(key);
  const signature = rows.map((row) => `${row.value}:${row.count}`).join('|');
  if (select.dataset.uiPreferenceRankSignature !== signature) {
    const order = new Map(rows.map((row, index) => [row.value, index]));
    const options = [...select.options].map((option, index) => ({ option, index }));
    const pinned = [];
    const movable = [];
    for (const item of options) {
      if (item.option.disabled || (select.required && item.option.value === '')) pinned.push(item);
      else movable.push(item);
    }
    movable.sort((a, b) => {
      const aRank = order.has(a.option.value) ? order.get(a.option.value) : Number.MAX_SAFE_INTEGER;
      const bRank = order.has(b.option.value) ? order.get(b.option.value) : Number.MAX_SAFE_INTEGER;
      return aRank - bRank || a.index - b.index;
    });
    for (const item of [...pinned, ...movable]) select.append(item.option);
    select.dataset.uiPreferenceRankSignature = signature;
  }
  const allowed = [...select.options].map((option) => option.value);
  const next = chooseDefault ? preferredValue(key, allowed, selected) : selected;
  if (allowed.includes(next)) select.value = next;
}

function bindControl(element, key) {
  if (!element) return;
  element.dataset.uiPreferenceKey = key;
}

function installStaticBindings() {
  for (const [selector, key] of STATIC_BINDINGS) bindControl(document.querySelector(selector), key);
}

function bindMeetingSettings() {
  const form = document.querySelector('#meeting-settings-form');
  if (!form) return;
  const chair = form.elements.namedItem('chairpersonPersonId');
  const secretary = form.elements.namedItem('secretaryPersonId');
  bindControl(chair, 'meeting.chairperson');
  bindControl(secretary, 'meeting.secretary');
  rankSelect(chair, 'meeting.chairperson', { chooseDefault: !chair?.value });
  rankSelect(secretary, 'meeting.secretary', { chooseDefault: !secretary?.value });
}

function applyEventDefaults() {
  const sheet = document.querySelector('#event-sheet');
  if (!sheet || sheet.classList.contains('hidden')) return;
  const isNew = !document.querySelector('#event-id')?.value;
  for (const [selector, key] of STATIC_BINDINGS.slice(0, 4)) {
    const select = document.querySelector(selector);
    if (select instanceof HTMLSelectElement) {
      rankSelect(select, key, { chooseDefault: isNew && select.dataset.uiPreferenceDirty !== '1' });
    }
  }
}

function applyTemplateDefaults() {
  const sheet = document.querySelector('#template-sheet');
  if (!sheet || sheet.classList.contains('hidden')) return;
  const documentType = document.querySelector('#template-document-type');
  if (documentType && documentType.dataset.uiPreferenceDirty !== '1') {
    documentType.value = preferredValue('template.document.type', null, documentType.value || 'custom_document');
  }
  const editor = document.querySelector('#field-editor');
  const required = document.querySelector('#field-required');
  if (editor && !editor.classList.contains('hidden') && required && required.dataset.uiPreferenceDirty !== '1') {
    const learned = preferredValue('template.field.required', ['0', '1'], required.checked ? '1' : '0');
    required.checked = learned === '1';
  }
}

function applyCalendarModeDefault() {
  if (preferenceState.calendarModeTouched) return;
  const preferred = preferredValue('calendar.mode', ['month', 'week', 'tasks'], null);
  if (!preferred) return;
  const button = document.querySelector(`[data-calendar-mode="${CSS.escape(preferred)}"]`);
  if (!button || button.classList.contains('active')) return;
  button.click();
}

function applyPreferences() {
  installStaticBindings();
  bindMeetingSettings();
  applyEventDefaults();
  applyTemplateDefaults();
  applyCalendarModeDefault();
}

function dirtyChoices(root) {
  if (!root) return { choices: [], elements: [] };
  const elements = [...root.querySelectorAll('[data-ui-preference-key][data-ui-preference-dirty="1"]')];
  const seen = new Set();
  const choices = [];
  for (const element of elements) {
    const key = element.dataset.uiPreferenceKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let value;
    if (element instanceof HTMLInputElement && element.type === 'checkbox') value = element.checked ? '1' : '0';
    else value = element.value;
    choices.push({ key, value: String(value ?? '') });
  }
  return { choices, elements };
}

function interactionId() {
  return globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function persistChoices(choices) {
  if (!choices.length || !preferenceState.transportFetch) return;
  try {
    const response = await preferenceState.transportFetch('/api/ui-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interactionId: interactionId(), choices })
    });
    if (!response.ok) return;
    setPreferencePayload(await response.json().catch(() => ({})));
  } catch {}
}

function recordDirty(root) {
  const captured = dirtyChoices(root);
  if (!captured.choices.length) return;
  for (const element of captured.elements) delete element.dataset.uiPreferenceDirty;
  void persistChoices(captured.choices);
}

function requestContext(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return null;
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin) return null;
  const calendarWrite = (method === 'POST' && url.pathname === '/api/calendar')
    || (method === 'PATCH' && url.pathname.startsWith('/api/calendar/'));
  if (calendarWrite && !document.querySelector('#event-sheet')?.classList.contains('hidden')) {
    return document.querySelector('#event-form');
  }
  if (method === 'POST' && url.pathname === '/api/templates' && !document.querySelector('#template-sheet')?.classList.contains('hidden')) {
    return document.querySelector('#template-sheet');
  }
  if (method === 'PUT' && url.pathname === '/api/meeting-settings') return document.querySelector('#meeting-settings-form');
  return null;
}

async function installFetchObserver() {
  if (preferenceState.installed) return;
  for (let attempt = 0; attempt < 160 && !window.kafedraAuthReady; attempt += 1) await sleep(25);
  if (window.kafedraAuthReady) await window.kafedraAuthReady.catch(() => null);
  if (preferenceState.installed) return;
  preferenceState.transportFetch = window.fetch.bind(window);
  window.fetch = async function uiPreferenceAwareFetch(input, init = {}) {
    const root = requestContext(input, init);
    const response = await preferenceState.transportFetch(input, init);
    if (response.ok && root) recordDirty(root);
    return response;
  };
  preferenceState.installed = true;
  await loadPreferences();
}

async function loadPreferences() {
  if (!preferenceState.transportFetch) return;
  try {
    const response = await preferenceState.transportFetch('/api/ui-preferences');
    if (!response.ok) return;
    setPreferencePayload(await response.json().catch(() => ({})));
    preferenceState.loaded = true;
    applyPreferences();
    window.dispatchEvent(new CustomEvent('kafedra-ui-preferences-ready'));
  } catch {}
}

document.addEventListener('change', (event) => {
  const control = event.target.closest?.('[data-ui-preference-key]');
  if (control && event.isTrusted) control.dataset.uiPreferenceDirty = '1';
});
document.addEventListener('input', (event) => {
  const control = event.target.closest?.('[data-ui-preference-key]');
  if (control instanceof HTMLInputElement && control.type !== 'checkbox' && event.isTrusted) {
    control.dataset.uiPreferenceDirty = '1';
  }
});

document.addEventListener('click', (event) => {
  if (!event.isTrusted) return;
  const mode = event.target.closest?.('[data-calendar-mode]')?.dataset.calendarMode;
  if (mode) {
    preferenceState.calendarModeTouched = true;
    void persistChoices([{ key: 'calendar.mode', value: mode }]);
  }
  if (event.target.closest?.('#add-template-field')) {
    queueMicrotask(() => {
      const editor = document.querySelector('#field-editor');
      if (editor?.classList.contains('hidden')) recordDirty(editor);
    });
  }
});

new MutationObserver(() => applyPreferences()).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['class']
});

installStaticBindings();
void installFetchObserver();
window.addEventListener('kafedra-auth-changed', () => void installFetchObserver());

window.kafedraUiPreferences = {
  preferredValue,
  ranking: (key) => [...ranking(key)]
};
