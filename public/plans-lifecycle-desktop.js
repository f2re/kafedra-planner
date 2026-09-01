const STYLE_ID = 'plans-lifecycle-desktop-stylesheet';
const SEGMENT_ID = 'plans-lifecycle-segment';
const SOURCE_ID = 'plans-lifecycle-status';
const DESKTOP_QUERY = '(min-width: 721px)';
const GENERIC_EMPTY = /^(?:Планов по этим условиям нет\.?|Планы не найдены\.?|Нет планов\.?)$/u;
const MODE_EMPTY = {
  active: 'Текущих планов нет',
  archived: 'Архив пуст'
};

let observer = null;
let media = null;
let scheduled = false;

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function isArchivedOption(option) {
  const identity = normalize(`${option?.value || ''} ${option?.textContent || ''}`);
  return /(?:^archived$|^archive$|^true$|архив)/u.test(identity);
}

function isActiveOption(option) {
  const identity = normalize(`${option?.value || ''} ${option?.textContent || ''}`);
  return /(?:^active$|^current$|^false$|текущ|действ|в работе|рабоч)/u.test(identity);
}

export function resolveLifecycleOptions(select) {
  const options = Array.from(select?.options || []);
  const archived = options.find(isArchivedOption) || null;
  if (!archived) return null;
  const active = options.find((option) => option !== archived && isActiveOption(option))
    || options.find((option) => option !== archived && normalize(option.value) === '')
    || options.find((option) => option !== archived)
    || null;
  return active ? { active, archived } : null;
}

function isDesktop() {
  return typeof window === 'undefined' || window.matchMedia(DESKTOP_QUERY).matches;
}

function ensureStylesheet(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plans-lifecycle-desktop.css';
  doc.head.append(link);
}

function sourceOwner(select) {
  const label = select.closest('label');
  if (label && label.querySelectorAll('select').length === 1) return label;
  const parent = select.parentElement;
  if (!parent) return select;
  const identity = normalize(`${parent.id || ''} ${parent.className || ''} ${parent.textContent || ''}`);
  if (parent.querySelectorAll('select').length === 1 && /(?:filter|field|control|состоя|архив)/u.test(identity)) {
    return parent;
  }
  return select;
}

function plansRoot(select) {
  return select.closest('[data-view="plans"], [data-plans-root], #plans-view, #plansView, #plans, .plans-view, .plans-next')
    || document.querySelector('[data-view="plans"], #plans-view, #plansView, #plans')
    || select.closest('section, main')
    || document.body;
}

function hasSecondaryCondition(root, select) {
  const controls = Array.from(root.querySelectorAll('input, select'));
  return controls.some((control) => {
    if (control === select || control.disabled || control.type === 'hidden') return false;
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
    const value = normalize(control.value);
    return value !== '' && value !== 'all' && value !== 'все';
  });
}

function emptyNode(root) {
  const candidates = root.querySelectorAll('[data-plans-empty], #plans-empty, .plans-empty, #plan-list .empty-state, #plans-list .empty-state, #plan-list .muted, #plans-list .muted');
  return Array.from(candidates).find((node) => {
    const text = String(node.textContent || '').trim();
    return GENERIC_EMPTY.test(text) || text === MODE_EMPTY.active || text === MODE_EMPTY.archived;
  }) || null;
}

function selectedMode(select, options) {
  return select.value === options.archived.value ? 'archived' : 'active';
}

function syncEmptyCopy(select, options) {
  const root = plansRoot(select);
  const empty = emptyNode(root);
  if (!empty) return;
  if (hasSecondaryCondition(root, select)) {
    if (empty.textContent?.trim() === MODE_EMPTY.active || empty.textContent?.trim() === MODE_EMPTY.archived) {
      empty.textContent = 'Планов по этим условиям нет.';
    }
    return;
  }
  empty.textContent = MODE_EMPTY[selectedMode(select, options)];
}

function restoreSource(select) {
  const owner = sourceOwner(select);
  select.hidden = false;
  select.removeAttribute('aria-hidden');
  select.removeAttribute('data-plan-lifecycle-source');
  select.tabIndex = 0;
  if (owner !== select) {
    owner.hidden = false;
    owner.removeAttribute('aria-hidden');
    owner.removeAttribute('data-plan-lifecycle-source-owner');
  }
}

function hideSource(select) {
  const owner = sourceOwner(select);
  select.hidden = true;
  select.setAttribute('aria-hidden', 'true');
  select.setAttribute('data-plan-lifecycle-source', 'true');
  select.tabIndex = -1;
  if (owner !== select) {
    owner.hidden = true;
    owner.setAttribute('aria-hidden', 'true');
    owner.setAttribute('data-plan-lifecycle-source-owner', 'true');
  }
  return owner;
}

function dispatchMode(select, value) {
  if (select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export function enhancePlansLifecycle(select) {
  if (!(select instanceof HTMLSelectElement) || !select.isConnected || !isDesktop()) return null;
  const options = resolveLifecycleOptions(select);
  if (!options) return null;

  const previous = document.getElementById(SEGMENT_ID);
  if (previous) {
    const source = document.getElementById(previous.dataset.sourceId || '');
    if (source === select) return previous;
    previous.remove();
  }

  if (!select.id) select.id = SOURCE_ID;
  const owner = hideSource(select);
  const segment = document.createElement('div');
  segment.id = SEGMENT_ID;
  segment.className = 'plans-lifecycle-segment';
  segment.setAttribute('data-plan-lifecycle', 'segment');
  segment.setAttribute('role', 'tablist');
  segment.setAttribute('aria-label', 'Показать планы');
  segment.dataset.sourceId = select.id;

  const definitions = [
    { mode: 'active', label: 'Текущие', value: options.active.value },
    { mode: 'archived', label: 'Архив', value: options.archived.value }
  ];
  const buttons = definitions.map((definition) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plans-lifecycle-segment__tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('data-plan-lifecycle-mode', definition.mode);
    button.dataset.value = definition.value;
    button.textContent = definition.label;
    segment.append(button);
    return button;
  });

  const sync = () => {
    const mode = selectedMode(select, options);
    for (const button of buttons) {
      const selected = button.getAttribute('data-plan-lifecycle-mode') === mode;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
    queueMicrotask(() => syncEmptyCopy(select, options));
  };

  const activate = (button) => {
    dispatchMode(select, button.dataset.value || '');
    sync();
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activate(button));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      buttons[next].focus();
      activate(buttons[next]);
    });
  });

  select.addEventListener('change', sync);
  owner.before(segment);
  sync();
  return segment;
}

function findSource(root = document) {
  return root.querySelector(`#${SOURCE_ID}`)
    || Array.from(root.querySelectorAll('select')).find((select) => resolveLifecycleOptions(select) && /(?:plan|план)/u.test(normalize(`${select.id} ${select.name} ${select.closest('section, main')?.textContent || ''}`)))
    || null;
}

function reconcile(root = document) {
  const source = findSource(root);
  const segment = document.getElementById(SEGMENT_ID);
  if (!isDesktop()) {
    if (segment) segment.remove();
    if (source) restoreSource(source);
    return;
  }
  if (segment) {
    const attachedSource = document.getElementById(segment.dataset.sourceId || '');
    if (!attachedSource || !attachedSource.isConnected || attachedSource !== source) segment.remove();
  }
  if (source) enhancePlansLifecycle(source);
}

function scheduleReconcile() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    reconcile(document);
  });
}

export function installPlansLifecycleDesktop(root = document) {
  ensureStylesheet(root.ownerDocument || root);
  reconcile(root);
  if (!observer && document.body) {
    observer = new MutationObserver(scheduleReconcile);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (!media) {
    media = window.matchMedia(DESKTOP_QUERY);
    media.addEventListener?.('change', scheduleReconcile);
  }
}

if (typeof document !== 'undefined') {
  globalThis.KafedraPlansLifecycleDesktop = {
    enhancePlansLifecycle,
    installPlansLifecycleDesktop,
    resolveLifecycleOptions
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installPlansLifecycleDesktop(), { once: true });
  } else {
    installPlansLifecycleDesktop();
  }
}
