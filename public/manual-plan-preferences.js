const MANUAL_KEYS = [
  'plan.item.direction',
  'plan.item.execution_mode',
  'plan.item.executor',
  'plan.item.controller',
  'plan.item.start_offset',
  'plan.item.end_offset',
  'plan.item.due_offset'
];
const LOCAL_KEY = 'kafedra-ui-preferences-v2';
const DAY_MS = 86_400_000;
const authContext = await window.kafedraAuthReady;
const preferenceFetch = window.fetch.bind(window);
const formStates = new WeakMap();
const manualRows = new Map();
let peoplePromise = null;
let pendingExplicitStart = null;

const $mp = (selector, root = document) => root.querySelector(selector);
const $$mp = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function shiftDate(base, days) {
  const timestamp = parseDateKey(base);
  if (timestamp === null) return '';
  const date = new Date(timestamp + Number(days) * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dateOffset(value, base) {
  const target = parseDateKey(value);
  const source = parseDateKey(base);
  if (target === null || source === null) return null;
  return Math.round((target - source) / DAY_MS);
}

function loadLocalRows() {
  if (authContext?.authEnabled !== false) return;
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
    for (const key of MANUAL_KEYS) {
      if (Array.isArray(stored[key])) manualRows.set(key, stored[key]);
    }
  } catch {}
}

function rowsFor(key) {
  if (manualRows.has(key)) return manualRows.get(key);
  const ranking = window.kafedraUiPreferences?.ranking?.(key);
  const rows = ranking instanceof Map
    ? [...ranking.entries()].map(([value, count]) => ({ value, count: Number(count || 0) }))
    : [];
  if (rows.length) manualRows.set(key, rows);
  return rows;
}

function preferredValue(key) {
  return rowsFor(key)?.[0]?.value ?? window.kafedraUiPreferences?.preferredValue?.(key) ?? null;
}

function updateLocalChoices(choices) {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch {}
  const now = new Date().toISOString();
  for (const choice of choices) {
    const rows = Array.isArray(stored[choice.key]) ? [...stored[choice.key]] : [];
    const existing = rows.find((row) => String(row.value) === String(choice.value));
    if (existing) {
      existing.count = Number(existing.count || 0) + 1;
      existing.lastSelectedAt = now;
    } else {
      rows.push({ value: String(choice.value), count: 1, lastSelectedAt: now });
    }
    rows.sort((left, right) => Number(right.count || 0) - Number(left.count || 0)
      || String(right.lastSelectedAt || '').localeCompare(String(left.lastSelectedAt || ''))
      || String(left.value).localeCompare(String(right.value), 'ru'));
    stored[choice.key] = rows;
    manualRows.set(choice.key, rows);
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(stored));
}

function interactionId() {
  return `manual-plan:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

async function recordChoices(choices) {
  if (!choices.length) return;
  if (authContext?.authEnabled === false) {
    updateLocalChoices(choices);
    return;
  }
  if (!authContext?.authenticated) return;
  try {
    const response = await preferenceFetch('/api/ui-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interactionId: interactionId(), choices })
    });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    for (const [key, rows] of Object.entries(payload.preferences || {})) {
      if (MANUAL_KEYS.includes(key) && Array.isArray(rows)) manualRows.set(key, rows);
    }
  } catch {}
}

async function loadPeople() {
  if (!peoplePromise) {
    peoplePromise = preferenceFetch('/api/people')
      .then(async (response) => response.ok ? await response.json() : { items: [] })
      .then((payload) => (payload.items || []).filter((person) => person.status !== 'inactive'))
      .catch(() => []);
  }
  return await peoplePromise;
}

async function loadExistingItem(form) {
  if (!form.dataset.itemId || !form.dataset.planId) return null;
  try {
    const response = await preferenceFetch(`/api/plans/${encodeURIComponent(form.dataset.planId)}`);
    if (!response.ok) return null;
    const plan = await response.json();
    return (plan.items || []).find((item) => item.id === form.dataset.itemId) || null;
  } catch {
    return null;
  }
}

function originalOptionOrder(select) {
  const current = [...select.options].map((option) => option.value);
  let stored = [];
  try { stored = JSON.parse(select.dataset.manualPreferenceOrder || '[]'); } catch {}
  if (stored.length !== current.length || stored.some((value) => !current.includes(value))) {
    select.dataset.manualPreferenceOrder = JSON.stringify(current);
    return current;
  }
  return stored;
}

function rankSelect(select, key, { chooseDefault = false } = {}) {
  if (!(select instanceof HTMLSelectElement) || !select.options.length) return;
  const scores = new Map(rowsFor(key).map((row) => [String(row.value), Number(row.count || 0)]));
  const original = originalOptionOrder(select);
  const selected = select.value;
  const pinned = [...select.options].filter((option) => option.value === '' || option.disabled);
  const movable = [...select.options].filter((option) => !pinned.includes(option));
  movable.sort((left, right) => (scores.get(right.value) || 0) - (scores.get(left.value) || 0)
    || original.indexOf(left.value) - original.indexOf(right.value));
  for (const option of [...pinned, ...movable]) select.append(option);
  if (chooseDefault) {
    const preferred = preferredValue(key);
    if (preferred !== null && [...select.options].some((option) => option.value === preferred)) select.value = preferred;
  } else if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function applyDateDefault(input, key, base, { explicit = false } = {}) {
  if (!(input instanceof HTMLInputElement) || input.type !== 'date' || input.value || explicit) return;
  const preferred = preferredValue(key);
  if (preferred === 'none' || preferred === null) return;
  const match = /^d:(-?\d+)$/u.exec(String(preferred));
  if (!match) return;
  const value = shiftDate(base, Number(match[1]));
  if (value) input.value = value;
}

function executionHelp(mode) {
  return {
    track: 'Только событие или контрольный срок. Отчёт не обязателен.',
    assigned: 'Создаётся поручение выбранным исполнителям и попадает в «План / факт».',
    open: 'Создаётся задача без исполнителя. Сотрудник сможет взять её на себя.'
  }[mode] || '';
}

function syncExecution(form) {
  const mode = $mp('[name="executionMode"]', form)?.value || 'track';
  $mp('[data-manual-execution-people]', form)?.classList.toggle('hidden', mode === 'track');
  const help = $mp('[data-manual-execution-help]', form);
  if (help) help.textContent = executionHelp(mode);
  const primary = $mp('[name="primaryExecutorPersonId"]', form);
  if (primary) primary.required = mode === 'assigned';
}

function syncCoexecutors(form) {
  const primaryId = $mp('[name="primaryExecutorPersonId"]', form)?.value || '';
  for (const input of $$mp('[name="coexecutorPersonIds"]', form)) {
    const same = Boolean(primaryId && input.value === primaryId);
    if (same) input.checked = false;
    input.disabled = same;
  }
}

function applyDerivedController(form, people, { force = false } = {}) {
  const primaryId = $mp('[name="primaryExecutorPersonId"]', form)?.value || '';
  const controller = $mp('[name="controllerPersonId"]', form);
  if (!controller) return false;
  const managerId = people.find((person) => person.id === primaryId)?.manager_id || '';
  const userTouched = controller.dataset.manualControllerTouched === '1';
  const mayReplace = force || (!userTouched && (
    !controller.value
    || controller.dataset.manualDerivedController === '1'
    || controller.dataset.manualSuggestedController === '1'
  ));
  if (managerId && mayReplace && [...controller.options].some((option) => option.value === managerId)) {
    controller.value = managerId;
    controller.dataset.manualDerivedController = '1';
    controller.dataset.manualSuggestedController = '0';
    return true;
  }
  if (!managerId && controller.dataset.manualDerivedController === '1') {
    controller.value = '';
    controller.dataset.manualDerivedController = '0';
  }
  return false;
}

function personOptions(people, selectedId) {
  return `<option value="">Не выбран</option>${people.map((person) => `
    <option value="${escapeHtml(person.id)}" ${person.id === selectedId ? 'selected' : ''}>${escapeHtml(person.display_name)}</option>
  `).join('')}`;
}

function setupFormData(form) {
  form.addEventListener('formdata', (event) => {
    event.formData.delete('executorPersonIds');
    const primary = String(event.formData.get('primaryExecutorPersonId') || '').trim();
    if (primary) event.formData.append('executorPersonIds', primary);
    for (const coexecutor of event.formData.getAll('coexecutorPersonIds').map(String).filter(Boolean)) {
      if (coexecutor !== primary) event.formData.append('executorPersonIds', coexecutor);
    }
  });
}

function choiceFor(form, key) {
  if (key === 'plan.item.direction') return { key, value: $mp('[name="direction"]', form)?.value || 'organizational' };
  if (key === 'plan.item.execution_mode') return { key, value: $mp('[name="executionMode"]', form)?.value || 'track' };
  if (key === 'plan.item.executor') return { key, value: $mp('[name="primaryExecutorPersonId"]', form)?.value || '' };
  if (key === 'plan.item.controller') return { key, value: $mp('[name="controllerPersonId"]', form)?.value || '' };
  const mappings = {
    'plan.item.start_offset': ['startsAt', localDateKey()],
    'plan.item.end_offset': ['endsAt', $mp('[name="startsAt"]', form)?.value || localDateKey()],
    'plan.item.due_offset': ['dueDate', $mp('[name="startsAt"]', form)?.value || localDateKey()]
  };
  const mapping = mappings[key];
  if (!mapping) return null;
  const value = $mp(`[name="${mapping[0]}"]`, form)?.value || '';
  if (!value) return { key, value: 'none' };
  const offset = dateOffset(value, mapping[1]);
  return Number.isInteger(offset) ? { key, value: `d:${offset}` } : null;
}

function dirtyChoices(form) {
  const state = formStates.get(form);
  if (!state) return [];
  return [...state.dirty].map((key) => choiceFor(form, key)).filter(Boolean);
}

function markDirty(form, key) {
  const state = formStates.get(form);
  if (state) state.dirty.add(key);
}

async function patchForm(form) {
  if (!form || form.dataset.manualAdaptivePatched === '1' || form.dataset.manualAdaptivePatching === '1') return;
  form.dataset.manualAdaptivePatching = '1';
  const submit = $mp('button[type="submit"]', form);
  if (submit) submit.disabled = true;
  try {
    const [people, item] = await Promise.all([loadPeople(), loadExistingItem(form)]);
    if (!form.isConnected || form.dataset.manualAdaptivePatched === '1') return;
    const isNew = !form.dataset.itemId;
    const startsAt = $mp('[name="startsAt"]', form);
    const explicitStart = Boolean(isNew && pendingExplicitStart && startsAt?.value === pendingExplicitStart);
    if (explicitStart) form.dataset.manualExplicitStart = '1';
    pendingExplicitStart = null;

    const legacyInputs = $$mp('[name="executorPersonIds"]', form);
    const legacySelected = legacyInputs.filter((input) => input.checked).map((input) => input.value);
    const assignmentExecutors = item?.assignment?.executors || [];
    const existingPrimary = assignmentExecutors.find((row) => row.role === 'executor')?.person_id
      || item?.responsible_person_id || legacySelected[0] || '';
    const preferredExecutor = isNew ? preferredValue('plan.item.executor') : null;
    const primaryId = existingPrimary || (people.some((person) => person.id === preferredExecutor) ? preferredExecutor : '');
    const existingCoexecutors = new Set(
      assignmentExecutors.filter((row) => row.role === 'coexecutor').map((row) => row.person_id).filter(Boolean)
    );
    if (!existingCoexecutors.size) {
      for (const id of legacySelected) if (id !== primaryId) existingCoexecutors.add(id);
    }
    for (const input of legacyInputs) {
      input.name = 'coexecutorPersonIds';
      input.checked = existingCoexecutors.has(input.value);
    }

    const list = $mp('.manual-people-list', form);
    if (list) {
      list.insertAdjacentHTML('beforebegin', `
        <label class="field manual-primary-executor">
          <span>Основной исполнитель</span>
          <select name="primaryExecutorPersonId">${personOptions(people, primaryId)}</select>
          <small>Соисполнители выбираются отдельно; поручение не создаёт дубли.</small>
        </label>`);
    }

    const direction = $mp('[name="direction"]', form);
    const mode = $mp('[name="executionMode"]', form);
    const primary = $mp('[name="primaryExecutorPersonId"]', form);
    const controller = $mp('[name="controllerPersonId"]', form);
    rankSelect(direction, 'plan.item.direction', { chooseDefault: isNew });
    rankSelect(mode, 'plan.item.execution_mode', { chooseDefault: isNew });
    rankSelect(primary, 'plan.item.executor', { chooseDefault: isNew && !primary.value });
    rankSelect(controller, 'plan.item.controller', { chooseDefault: false });

    if (isNew) {
      applyDateDefault(startsAt, 'plan.item.start_offset', localDateKey(), { explicit: explicitStart });
      const startBase = startsAt?.value || localDateKey();
      applyDateDefault($mp('[name="endsAt"]', form), 'plan.item.end_offset', startBase);
      applyDateDefault($mp('[name="dueDate"]', form), 'plan.item.due_offset', startBase);
    }

    const derived = isNew && applyDerivedController(form, people, { force: !controller?.value });
    if (isNew && !derived && controller && !controller.value) {
      rankSelect(controller, 'plan.item.controller', { chooseDefault: true });
      if (controller.value) controller.dataset.manualSuggestedController = '1';
    }

    formStates.set(form, { isNew, dirty: new Set(), people });
    setupFormData(form);
    syncCoexecutors(form);
    syncExecution(form);
    form.dataset.manualAdaptivePatched = '1';
  } finally {
    delete form.dataset.manualAdaptivePatching;
    if (submit) submit.disabled = false;
  }
}

function schedulePatch() {
  const form = $mp('#manual-plan-item-form');
  if (form) patchForm(form).catch(() => {});
}

document.addEventListener('click', (event) => {
  const calendarNext = event.target.closest('[data-manual-calendar-plan-next]');
  if (calendarNext) pendingExplicitStart = calendarNext.dataset.date || null;
  if (event.target.closest('[data-manual-add-item]')) pendingExplicitStart = null;
}, true);

document.addEventListener('change', (event) => {
  if (!event.isTrusted) return;
  const form = event.target.closest('#manual-plan-item-form[data-manual-adaptive-patched="1"]');
  if (!form) return;
  const state = formStates.get(form);
  if (!state) return;
  if (event.target.matches('[name="direction"]')) markDirty(form, 'plan.item.direction');
  if (event.target.matches('[name="executionMode"]')) {
    markDirty(form, 'plan.item.execution_mode');
    syncExecution(form);
  }
  if (event.target.matches('[name="primaryExecutorPersonId"]')) {
    markDirty(form, 'plan.item.executor');
    syncCoexecutors(form);
    const derived = applyDerivedController(form, state.people, { force: false });
    const controller = $mp('[name="controllerPersonId"]', form);
    if (!derived && controller && !controller.value && controller.dataset.manualControllerTouched !== '1') {
      rankSelect(controller, 'plan.item.controller', { chooseDefault: true });
      if (controller.value) controller.dataset.manualSuggestedController = '1';
    }
  }
  if (event.target.matches('[name="coexecutorPersonIds"]') && event.target.checked) {
    const primary = $mp('[name="primaryExecutorPersonId"]', form);
    if (primary && !primary.value) {
      primary.value = event.target.value;
      markDirty(form, 'plan.item.executor');
      syncCoexecutors(form);
      applyDerivedController(form, state.people, { force: false });
    }
  }
  if (event.target.matches('[name="controllerPersonId"]')) {
    event.target.dataset.manualDerivedController = '0';
    event.target.dataset.manualSuggestedController = '0';
    event.target.dataset.manualControllerTouched = '1';
    markDirty(form, 'plan.item.controller');
  }
  if (event.target.matches('[name="startsAt"]')) markDirty(form, 'plan.item.start_offset');
  if (event.target.matches('[name="endsAt"]')) markDirty(form, 'plan.item.end_offset');
  if (event.target.matches('[name="dueDate"]')) markDirty(form, 'plan.item.due_offset');
}, true);

document.addEventListener('input', (event) => {
  if (!event.isTrusted) return;
  const form = event.target.closest('#manual-plan-item-form[data-manual-adaptive-patched="1"]');
  if (!form) return;
  if (event.target.matches('[name="startsAt"]')) markDirty(form, 'plan.item.start_offset');
  if (event.target.matches('[name="endsAt"]')) markDirty(form, 'plan.item.end_offset');
  if (event.target.matches('[name="dueDate"]')) markDirty(form, 'plan.item.due_offset');
}, true);

window.fetch = async function manualPlanPreferenceFetch(input, init = {}) {
  const response = await preferenceFetch(input, init);
  try {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.origin);
    const itemWrite = url.origin === window.location.origin && response.ok && (
      (method === 'POST' && /^\/api\/plans\/[^/]+\/items$/u.test(url.pathname))
      || (method === 'PATCH' && /^\/api\/plans\/[^/]+\/items\/[^/]+$/u.test(url.pathname))
    );
    if (itemWrite) {
      const form = $mp('#manual-plan-item-form[data-manual-adaptive-patched="1"]');
      const choices = form ? dirtyChoices(form) : [];
      if (form) formStates.get(form)?.dirty.clear();
      if (choices.length) recordChoices(choices).catch(() => {});
    }
  } catch {}
  return response;
};

loadLocalRows();
const observer = new MutationObserver(schedulePatch);
observer.observe(document.documentElement, { childList: true, subtree: true });
schedulePatch();
