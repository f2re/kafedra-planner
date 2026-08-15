const preferenceState = {
  rows: new Map(),
  bindings: new WeakMap(),
  calendarFiltersTouched: false,
  applying: false
};

const localFallbackKey = 'kafedra-ui-preferences-v2';
const authContext = await window.kafedraAuthReady;
const transportFetch = window.fetch.bind(window);
const $u = (selector, root = document) => root.querySelector(selector);
const $$u = (selector, root = document) => [...root.querySelectorAll(selector)];
const CALENDAR_CATEGORIES = ['science', 'education', 'organizational', 'everyday'];

const CONTROL_BINDINGS = [
  { selector: '#event-kind', key: 'calendar.new.kind', policy: 'default', record: 'submit', when: newEvent },
  { selector: '#event-date', key: 'calendar.new.date_offset', policy: 'date', record: 'submit', when: newGlobalEvent, dateBase: todayKey, required: true },
  { selector: '#event-category', key: 'calendar.new.category', policy: 'default', record: 'submit', when: newEvent },
  { selector: '#event-importance', key: 'calendar.new.importance', policy: 'default', record: 'submit', when: newEvent },
  { selector: '#event-reminder', key: 'calendar.new.reminder', policy: 'default', record: 'submit', when: newEvent, allowEmpty: true },

  { selector: '#template-document-type', key: 'template.document.type', policy: 'default', record: 'submit' },
  { selector: '#field-type', key: 'template.field.type', policy: 'default', record: 'field', when: templateFieldVisible, chooseWhen: (element) => element.value === 'string' },
  { selector: '#field-strategy', key: 'template.field.strategy', policy: 'default', record: 'field', when: templateFieldVisible, chooseWhen: (element) => element.value === 'line' },
  { selector: '#field-required', key: 'template.field.required', policy: 'default', record: 'field', when: templateFieldVisible },

  { selector: '#meeting-settings-form select[name="chairpersonPersonId"]', key: 'meeting.chairperson', policy: 'default', record: 'submit', chooseWhen: emptyValue },
  { selector: '#meeting-settings-form select[name="secretaryPersonId"]', key: 'meeting.secretary', policy: 'default', record: 'submit', chooseWhen: emptyValue },
  { selector: '#meeting-create-form input[name="meetingDate"]', key: 'meeting.new.date_offset', policy: 'date', record: 'submit', dateBase: todayKey, required: true },

  { selector: '#periodic-task-form select[name="ownerPersonId"]', key: 'work.periodic.owner', policy: 'default', record: 'submit', chooseWhen: emptyValue },
  { selector: '#periodic-task-form select[name="managerPersonId"]', key: 'work.periodic.manager', policy: 'rank', record: 'submit' },
  { selector: '#periodic-task-form select[name="periodKind"]', key: 'work.periodic.period_kind', policy: 'default', record: 'submit' },
  { selector: '#periodic-task-form input[name="startsAt"]', key: 'work.periodic.start_offset', policy: 'date', record: 'submit', dateBase: todayKey, required: false },
  { selector: '#periodic-task-form input[name="dueDate"]', key: 'work.periodic.due_offset', policy: 'date', record: 'submit', dateBase: periodicDueBase, required: true },
  { selector: '#periodic-task-form select[name="direction"]', key: 'work.periodic.direction', policy: 'default', record: 'submit' },
  { selector: '#work-search-form select[name="direction"]', key: 'work.filter.direction', policy: 'rank', record: 'immediate' },
  { selector: '#work-search-form select[name="status"]', key: 'work.filter.status', policy: 'rank', record: 'immediate' },
  { selector: '[data-periodic-edit-form] select[name="ownerPersonId"]', key: 'work.periodic.owner', policy: 'rank', record: 'submit' },
  { selector: '[data-periodic-edit-form] select[name="managerPersonId"]', key: 'work.periodic.manager', policy: 'rank', record: 'submit' },
  { selector: '[data-periodic-edit-form] select[name="status"]', key: 'work.periodic.edit.status', policy: 'rank', record: 'submit' },
  { selector: '[data-responsibility-form] select[name="executorPersonId"]', key: 'work.responsibility.executor', policy: 'rank', record: 'submit' },
  { selector: '[data-responsibility-form] select[name="controllerPersonId"]', key: 'work.responsibility.controller', policy: 'rank', record: 'submit' },

  { selector: '#plans-kind', key: 'plans.filter.kind', policy: 'rank', record: 'immediate' },
  { selector: '#plans-period', key: 'plans.filter.period', policy: 'rank', record: 'immediate' },
  { selector: '#plans-direction', key: 'plans.filter.direction', policy: 'rank', record: 'immediate' },
  { selector: '#plan-item-form select[name="direction"]', key: 'plan.item.direction', policy: 'rank', record: 'submit' },

  { selector: '#search-filters select[name="sourceKind"]', key: 'search.filter.source_kind', policy: 'rank', record: 'immediate' },
  { selector: '#search-filters select[name="direction"]', key: 'search.filter.direction', policy: 'rank', record: 'immediate' },
  { selector: '#search-filters select[name="role"]', key: 'search.filter.role', policy: 'rank', record: 'immediate' },
  { selector: '#search-filters select[name="status"]', key: 'search.filter.status', policy: 'rank', record: 'immediate' },
  { selector: '#search-filters select[name="report"]', key: 'search.filter.report', policy: 'rank', record: 'immediate' },
  { selector: '#science-search-form select[name="kind"]', key: 'science.filter.kind', policy: 'rank', record: 'immediate' },

  { selector: '#current-person-select', key: 'profile.current_person', policy: 'default', record: 'immediate', allowEmpty: true, when: managerProfile, notify: 'change' },
  { selector: '#plan-fact-filters select[name="scope"]', key: 'planfact.scope', policy: 'default', record: 'immediate', when: planFactModeAvailable, notify: 'change' },
  { selector: '#plan-fact-filters select[name="direction"]', key: 'planfact.filter.direction', policy: 'rank', record: 'immediate' },
  { selector: '#plan-fact-filters select[name="status"]', key: 'planfact.filter.status', policy: 'rank', record: 'immediate' },
  { selector: '#plan-fact-filters select[name="periodKind"]', key: 'planfact.filter.period_kind', policy: 'rank', record: 'immediate' },

  { selector: '#admin-object-kind', key: 'admin.object.kind', policy: 'default', record: 'immediate' }
];

function newEvent() {
  return !$u('#event-id')?.value;
}

function newGlobalEvent(element) {
  return newEvent() && element?.dataset.uiPreferenceExplicitDate !== '1';
}

function templateFieldVisible(element) {
  return Boolean(element?.closest('#field-editor') && !$u('#field-editor')?.classList.contains('hidden'));
}

function emptyValue(element) {
  return !String(element?.value || '').trim();
}

function managerProfile() {
  return ['manager', 'admin'].includes(window.kafedraAuthContext?.role || authContext?.role || '');
}

function planFactModeAvailable(element) {
  return Boolean(
    element?.closest('#plan-fact-filters')
    && $u('[data-view-panel="plan-fact"]')?.classList.contains('active')
  );
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayKey() {
  return localDateKey(new Date());
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const millis = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return Number.isFinite(millis) ? millis : null;
}

function dateDifferenceDays(value, base) {
  const target = parseDateKey(value);
  const source = parseDateKey(base);
  if (target === null || source === null) return null;
  return Math.round((target - source) / 86_400_000);
}

function shiftDate(base, days) {
  const source = parseDateKey(base);
  if (source === null) return '';
  const date = new Date(source + Number(days) * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function periodicDueBase(element) {
  const form = element?.closest('#periodic-task-form');
  return form?.elements.namedItem('startsAt')?.value || todayKey();
}

function generatedPeriodKey(kind, date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (kind === 'calendar_year') return String(year);
  if (kind === 'quarter') return `${year}-Q${Math.ceil(month / 3)}`;
  if (kind === 'semester') {
    const academicStart = month >= 9 ? year : year - 1;
    const semester = month >= 9 || month === 1 ? 1 : 2;
    return `${academicStart}-${semester}`;
  }
  if (kind === 'academic_year') {
    const start = month >= 9 ? year : year - 1;
    return `${start}/${String(start + 1).slice(-2)}`;
  }
  return '';
}

function syncPeriodicPeriodKey({ force = false } = {}) {
  const form = $u('#periodic-task-form');
  const kind = form?.elements.namedItem('periodKind');
  const key = form?.elements.namedItem('periodKey');
  if (!form || !kind || !key) return;
  const derived = generatedPeriodKey(kind.value);
  if (!derived) {
    if (force && key.dataset.uiDerivedPeriodAuto === '1') key.value = '';
    return;
  }
  const manual = key.dataset.uiDerivedPeriodManual === '1';
  if (!force && manual && key.value) return;
  if (!key.value || key.dataset.uiDerivedPeriodAuto === '1' || force) {
    key.value = derived;
    key.dataset.uiDerivedPeriodAuto = '1';
    if (!key.value) key.dataset.uiDerivedPeriodManual = '0';
  }
}

function loadLocalRows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(localFallbackKey) || '{}');
    for (const [key, rows] of Object.entries(parsed)) {
      if (Array.isArray(rows)) preferenceState.rows.set(key, rows);
    }
  } catch {}
}

function saveLocalRows() {
  const object = Object.fromEntries([...preferenceState.rows.entries()]);
  localStorage.setItem(localFallbackKey, JSON.stringify(object));
}

function mergePreferencePayload(payload) {
  for (const [key, rows] of Object.entries(payload?.preferences || {})) {
    preferenceState.rows.set(key, Array.isArray(rows) ? rows : []);
  }
}

function preferredValue(key) {
  return preferenceState.rows.get(key)?.[0]?.value ?? null;
}

function ranking(key) {
  return new Map((preferenceState.rows.get(key) || []).map((row) => [String(row.value), Number(row.count || 0)]));
}

function interactionId(prefix = 'ui') {
  return `${prefix}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function updateLocalChoices(choices) {
  const now = new Date().toISOString();
  for (const choice of choices) {
    const rows = [...(preferenceState.rows.get(choice.key) || [])];
    const existing = rows.find((row) => String(row.value) === String(choice.value));
    if (existing) {
      existing.count = Number(existing.count || 0) + 1;
      existing.lastSelectedAt = now;
    } else {
      rows.push({ value: String(choice.value), count: 1, lastSelectedAt: now });
    }
    rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0)
      || String(b.lastSelectedAt || '').localeCompare(String(a.lastSelectedAt || ''))
      || String(a.value).localeCompare(String(b.value), 'ru'));
    preferenceState.rows.set(choice.key, rows);
  }
  saveLocalRows();
}

async function persistChoices(choices, prefix = 'ui') {
  if (!choices.length) return;
  if (authContext?.authEnabled === false) {
    updateLocalChoices(choices);
    queueMicrotask(applyPreferences);
    return;
  }
  if (!authContext?.authenticated) return;
  try {
    const response = await transportFetch('/api/ui-preferences', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interactionId: interactionId(prefix), choices })
    });
    if (!response.ok) return;
    mergePreferencePayload(await response.json().catch(() => ({})));
    queueMicrotask(applyPreferences);
  } catch {}
}

function optionOrder(element) {
  const values = [...element.options].map((option) => option.value);
  let stored = [];
  try { stored = JSON.parse(element.dataset.uiPreferenceOriginalOrder || '[]'); } catch {}
  const sameSet = stored.length === values.length && stored.every((value) => values.includes(value));
  if (!sameSet) {
    element.dataset.uiPreferenceOriginalOrder = JSON.stringify(values);
    return values;
  }
  return stored;
}

function rankSelect(element, key, { chooseDefault = false } = {}) {
  if (!(element instanceof HTMLSelectElement) || !element.options.length) return false;
  const rows = ranking(key);
  const original = optionOrder(element);
  const selected = element.value;
  const options = [...element.options];
  const pinned = options.filter((option) => option.value === '' || option.disabled);
  const movable = options.filter((option) => !pinned.includes(option));
  movable.sort((left, right) => {
    const score = (rows.get(right.value) || 0) - (rows.get(left.value) || 0);
    if (score) return score;
    return original.indexOf(left.value) - original.indexOf(right.value);
  });
  const ordered = [...pinned, ...movable];
  const signature = `${key}:${ordered.map((option) => option.value).join('|')}`;
  if (element.dataset.uiPreferenceRankSignature !== signature) {
    for (const option of ordered) element.append(option);
    element.dataset.uiPreferenceRankSignature = signature;
  }
  let changed = false;
  if (chooseDefault) {
    const preferred = preferredValue(key);
    if (preferred !== null && [...element.options].some((option) => option.value === preferred) && element.value !== preferred) {
      element.value = preferred;
      changed = true;
    }
  } else if ([...element.options].some((option) => option.value === selected)) {
    element.value = selected;
  }
  return changed;
}

function applyDateDefault(element, binding) {
  if (!(element instanceof HTMLInputElement) || element.type !== 'date') return false;
  const preferred = preferredValue(binding.key);
  if (preferred === null) return false;
  if (preferred === 'none') {
    if (binding.required || element.value === '') return false;
    element.value = '';
    return true;
  }
  const match = /^d:(-?\d+)$/u.exec(preferred);
  if (!match) return false;
  const base = String(binding.dateBase?.(element) || todayKey());
  const next = shiftDate(base, Number(match[1]));
  if (!next || element.value === next) return false;
  element.value = next;
  return true;
}

function bindControls() {
  for (const binding of CONTROL_BINDINGS) {
    for (const element of $$u(binding.selector)) {
      preferenceState.bindings.set(element, binding);
      element.dataset.uiPreferenceKey = binding.key;
      element.dataset.uiPreferenceRecord = binding.record;
    }
  }
}

function shouldApplyDefault(element, binding) {
  if (element.dataset.uiPreferenceDirty === '1' || element.dataset.uiPreferenceTouchedSession === '1') return false;
  if (binding.when && !binding.when(element)) return false;
  if (binding.chooseWhen && !binding.chooseWhen(element)) return false;
  return true;
}

function applyBinding(element, binding) {
  if (binding.when && !binding.when(element) && binding.policy === 'rank') return;
  let changed = false;
  if (binding.policy === 'date') {
    if (shouldApplyDefault(element, binding)) changed = applyDateDefault(element, binding);
  } else if (element instanceof HTMLSelectElement) {
    changed = rankSelect(element, binding.key, {
      chooseDefault: binding.policy === 'default' && shouldApplyDefault(element, binding)
    });
  } else if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    if (binding.policy === 'default' && shouldApplyDefault(element, binding)) {
      const preferred = preferredValue(binding.key);
      if (preferred !== null) {
        const checked = preferred === '1';
        changed = element.checked !== checked;
        element.checked = checked;
      }
    }
  } else if (binding.policy === 'default' && shouldApplyDefault(element, binding)) {
    const preferred = preferredValue(binding.key);
    if (preferred !== null && element.value !== preferred) {
      element.value = preferred;
      changed = true;
    }
  }
  if (changed && binding.notify) {
    element.dispatchEvent(new Event(binding.notify, { bubbles: true }));
  }
}

function applyCalendarModeDefault() {
  if (document.documentElement.dataset.uiCalendarModeTouched === '1') return;
  const mode = preferredValue('calendar.mode');
  if (!mode) return;
  const button = $u(`[data-calendar-mode="${CSS.escape(mode)}"]`);
  if (button && !button.classList.contains('active')) button.click();
}

function canonicalCategories() {
  return CALENDAR_CATEGORIES.filter((value) => $u(`[data-filter-category="${value}"]`)?.getAttribute('aria-pressed') === 'true');
}

function applyCalendarFilterDefaults() {
  if (preferenceState.calendarFiltersTouched) return;
  const kind = preferredValue('calendar.filter.kind');
  if (kind) {
    const button = $u(`[data-filter-kind="${CSS.escape(kind)}"]`);
    if (button?.getAttribute('aria-pressed') !== 'true') button.click();
  }
  const raw = preferredValue('calendar.filter.categories');
  if (!raw) return;
  const desired = new Set(String(raw).split(',').filter((value) => CALENDAR_CATEGORIES.includes(value)));
  if (!desired.size) return;
  for (const category of CALENDAR_CATEGORIES) {
    const button = $u(`[data-filter-category="${category}"]`);
    if (!button) continue;
    const active = button.getAttribute('aria-pressed') === 'true';
    if (active !== desired.has(category)) button.click();
  }
}

function applyPreferences() {
  if (preferenceState.applying) return;
  preferenceState.applying = true;
  try {
    bindControls();
    for (const binding of CONTROL_BINDINGS) {
      for (const element of $$u(binding.selector)) applyBinding(element, binding);
    }
    applyCalendarModeDefault();
    applyCalendarFilterDefaults();
    syncPeriodicPeriodKey();
  } finally {
    preferenceState.applying = false;
  }
}

function choiceFromElement(element, binding) {
  if (!binding || !element) return null;
  if (binding.when && !binding.when(element)) return null;
  if (binding.policy === 'date') {
    if (binding.key === 'calendar.new.date_offset' && element.dataset.uiPreferenceExplicitDate === '1') return null;
    if (!element.value) return binding.required ? null : { key: binding.key, value: 'none' };
    const base = String(binding.dateBase?.(element) || todayKey());
    const offset = dateDifferenceDays(element.value, base);
    if (!Number.isInteger(offset)) return null;
    return { key: binding.key, value: `d:${offset}` };
  }
  let value;
  if (element instanceof HTMLInputElement && element.type === 'checkbox') value = element.checked ? '1' : '0';
  else value = String(element.value ?? '').trim();
  if (!value && !binding.allowEmpty) return null;
  return { key: binding.key, value };
}

function dirtyChoices(root) {
  if (!root) return [];
  const controls = $$u('[data-ui-preference-key][data-ui-preference-dirty="1"]', root);
  const unique = new Map();
  for (const element of controls) {
    const choice = choiceFromElement(element, preferenceState.bindings.get(element));
    if (choice) unique.set(choice.key, choice);
  }
  return [...unique.values()];
}

function clearDirty(root) {
  if (!root) return;
  for (const element of $$u('[data-ui-preference-dirty="1"]', root)) delete element.dataset.uiPreferenceDirty;
}

function recordDirty(root, prefix) {
  const choices = dirtyChoices(root);
  clearDirty(root);
  if (choices.length) persistChoices(choices, prefix);
  return choices;
}

function dirtyForm(selector) {
  return $$u(selector).find((form) => form.querySelector('[data-ui-preference-dirty="1"]')) || null;
}

function requestContext(method, pathname) {
  if (pathname === '/api/ui-preferences') return null;
  if (pathname === '/api/calendar' && method === 'POST') return { root: $u('#event-form'), prefix: 'calendar' };
  if (/^\/api\/calendar\/[^/]+$/u.test(pathname) && method === 'PATCH') return { root: $u('#event-form'), prefix: 'calendar' };
  if (pathname === '/api/templates' && method === 'POST') return { root: $u('#template-sheet'), prefix: 'template' };
  if (pathname === '/api/meeting-settings' && method === 'PUT') return { root: $u('#meeting-settings-form'), prefix: 'meeting-settings' };
  if (pathname === '/api/meetings' && method === 'POST') return { root: $u('#meeting-create-form'), prefix: 'meeting-create' };
  if (pathname === '/api/periodic-tasks' && method === 'POST') return { root: $u('#periodic-task-form'), prefix: 'periodic-create', reapply: true };
  if (/^\/api\/periodic-tasks\/[^/]+$/u.test(pathname) && method === 'PATCH') return { root: dirtyForm('[data-periodic-edit-form]'), prefix: 'periodic-edit' };
  if (/^\/api\/assignments\/[^/]+\/responsibility$/u.test(pathname) && method === 'PUT') return { root: dirtyForm('[data-responsibility-form]'), prefix: 'responsibility' };
  if (/^\/api\/plans\/[^/]+\/items\/[^/]+$/u.test(pathname) && method === 'PATCH') return { root: $u('#plan-item-form'), prefix: 'plan-item' };
  return null;
}

window.fetch = async function preferenceObservedFetch(input, init = {}) {
  const response = await transportFetch(input, init);
  try {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin && response.ok && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const context = requestContext(method, url.pathname);
      if (context?.root) recordDirty(context.root, context.prefix);
      if (context?.reapply) queueMicrotask(() => {
        syncPeriodicPeriodKey({ force: true });
        applyPreferences();
      });
    }
  } catch {}
  return response;
};

async function loadPreferences() {
  if (authContext?.authEnabled === false) {
    loadLocalRows();
    return;
  }
  if (!authContext?.authenticated) return;
  try {
    const response = await transportFetch('/api/ui-preferences');
    if (!response.ok) return;
    mergePreferencePayload(await response.json().catch(() => ({})));
  } catch {}
}

function markTrustedControl(event) {
  if (!event.isTrusted) return;
  const element = event.target.closest?.('[data-ui-preference-key]');
  if (!element) return;
  const binding = preferenceState.bindings.get(element);
  if (!binding) return;
  element.dataset.uiPreferenceDirty = '1';
  if (binding.record === 'immediate') {
    element.dataset.uiPreferenceTouchedSession = '1';
    const choice = choiceFromElement(element, binding);
    if (choice) persistChoices([choice], binding.key.replaceAll('.', '-'));
  }
}

document.addEventListener('change', (event) => {
  markTrustedControl(event);
  if (event.target.matches('#periodic-task-form select[name="periodKind"]')) {
    const key = $u('#periodic-task-form input[name="periodKey"]');
    if (key?.dataset.uiDerivedPeriodManual !== '1' || !key.value) syncPeriodicPeriodKey({ force: true });
  }
}, true);

document.addEventListener('input', (event) => {
  markTrustedControl(event);
  if (event.isTrusted && event.target.matches('#periodic-task-form input[name="periodKey"]')) {
    event.target.dataset.uiDerivedPeriodManual = '1';
    event.target.dataset.uiDerivedPeriodAuto = '0';
  }
}, true);

document.addEventListener('click', (event) => {
  const mode = event.target.closest('[data-calendar-mode]');
  if (mode && event.isTrusted) {
    document.documentElement.dataset.uiCalendarModeTouched = '1';
    persistChoices([{ key: 'calendar.mode', value: mode.dataset.calendarMode }], 'calendar-mode');
  }

  const filterKind = event.target.closest('[data-filter-kind]');
  if (filterKind && event.isTrusted) {
    preferenceState.calendarFiltersTouched = true;
    queueMicrotask(() => persistChoices([{ key: 'calendar.filter.kind', value: filterKind.dataset.filterKind }], 'calendar-filter-kind'));
  }
  const filterCategory = event.target.closest('[data-filter-category]');
  if (filterCategory && event.isTrusted) {
    preferenceState.calendarFiltersTouched = true;
    queueMicrotask(() => {
      const categories = canonicalCategories();
      if (categories.length) persistChoices([{ key: 'calendar.filter.categories', value: categories.join(',') }], 'calendar-filter-categories');
    });
  }

  if (event.target.closest('#create-button') && event.isTrusted) {
    queueMicrotask(() => {
      const date = $u('#event-date');
      if (date) date.dataset.uiPreferenceExplicitDate = '0';
      applyPreferences();
    });
  }
  const newOnDate = event.target.closest('[data-new-on-date]');
  if (newOnDate && event.isTrusted) {
    const explicitDate = newOnDate.dataset.newOnDate;
    queueMicrotask(() => {
      const date = $u('#event-date');
      if (date) {
        date.dataset.uiPreferenceExplicitDate = '1';
        if (explicitDate) date.value = explicitDate;
      }
    });
  }

  if (event.target.closest('#add-template-field') && event.isTrusted) {
    queueMicrotask(() => recordDirty($u('#field-editor'), 'template-field'));
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.isTrusted && (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'n') {
    queueMicrotask(() => {
      const date = $u('#event-date');
      if (date) date.dataset.uiPreferenceExplicitDate = '0';
      applyPreferences();
    });
  }
}, true);

window.addEventListener('kafedra:view-changed', () => queueMicrotask(applyPreferences));

const observer = new MutationObserver(() => {
  const eventSheet = $u('#event-sheet');
  if (eventSheet?.classList.contains('hidden')) delete $u('#event-date')?.dataset.uiPreferenceExplicitDate;
  queueMicrotask(applyPreferences);
});
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

await loadPreferences();
applyPreferences();
window.kafedraUiPreferences = { preferredValue, ranking, apply: applyPreferences };
