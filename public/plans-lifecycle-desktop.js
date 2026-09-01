const STYLE_ID = 'plans-lifecycle-desktop-css';
const SEGMENT_ID = 'plans-lifecycle-segment';
const SOURCE_ID = 'plans-lifecycle-status';
const ENHANCED_ATTRIBUTE = 'data-plans-lifecycle-desktop';
const DESKTOP_QUERY = '(min-width: 721px)';

const state = {
  active: null,
  media: null,
  mediaHandler: null,
  observer: null,
  scanQueued: false,
  installed: false
};

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function optionIdentity(option) {
  return normalize(`${option?.value || ''} ${option?.textContent || ''}`);
}

function isArchiveOption(option) {
  return /(?:^archived$|^archive$|^true$|архив)/u.test(optionIdentity(option));
}

function isCurrentOption(option) {
  return /(?:^active$|^current$|^false$|текущ|действ|в работе|рабоч)/u.test(optionIdentity(option));
}

export function resolveLifecycleOptions(select) {
  const options = Array.from(select?.options || []);
  const archived = options.find(isArchiveOption) || null;
  if (!archived) return null;
  const current = options.find((option) => option !== archived && isCurrentOption(option))
    || options.find((option) => option !== archived && normalize(option.value) === '')
    || options.find((option) => option !== archived)
    || null;
  return current ? { current, archived } : null;
}

function ensureStylesheet(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plans-lifecycle-desktop.css';
  doc.head.append(link);
}

function captureAttribute(element, name) {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name)
  };
}

function restoreAttribute(element, name, snapshot) {
  if (snapshot.present) element.setAttribute(name, snapshot.value ?? '');
  else element.removeAttribute(name);
}

function captureVisibilityState(element) {
  return {
    hidden: element.hidden,
    ariaHidden: captureAttribute(element, 'aria-hidden'),
    tabindex: captureAttribute(element, 'tabindex')
  };
}

export function restoreVisibilityState(element, snapshot) {
  if (!element || !snapshot) return;
  element.hidden = snapshot.hidden;
  restoreAttribute(element, 'aria-hidden', snapshot.ariaHidden);
  restoreAttribute(element, 'tabindex', snapshot.tabindex);
}

function conceal(element) {
  element.hidden = true;
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('tabindex', '-1');
}

function sourceOwner(select) {
  const label = select.closest('label');
  if (label && label.querySelectorAll('select').length === 1 && !label.querySelector('input, textarea, button')) {
    return label;
  }
  const parent = select.parentElement;
  if (parent && parent.querySelectorAll('select').length === 1 && !parent.querySelector('input, textarea, button')) {
    return parent;
  }
  return select;
}

function plansRoot(select) {
  return select.closest('[data-view-panel="plans"], [data-view="plans"], [data-plans-root], #plans-view, #plansView, #plans, .plans-view, .plans-next')
    || select.closest('section, main')
    || document;
}

function filterRoot(select, owner) {
  return owner.closest('[data-plan-filters], .plans-filterbar, .plans-toolbar, .plan-filters, .filters, .filter-grid')
    || owner.parentElement
    || plansRoot(select);
}

function hasSecondaryConstraint(select, owner) {
  const root = filterRoot(select, owner);
  for (const control of root.querySelectorAll('input, select, textarea')) {
    if (control === select || control.disabled || control.hidden || control.getAttribute('aria-hidden') === 'true') continue;
    if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) {
      if (control.checked) return true;
      continue;
    }
    if (control instanceof HTMLSelectElement) {
      if (control.selectedIndex > 0 && normalize(control.value) !== '') return true;
      continue;
    }
    if (normalize(control.value) !== '') return true;
  }
  return false;
}

function emptyTextFor(select, lifecycle) {
  return select.value === lifecycle.archived.value ? 'Архив пуст' : 'Текущих планов нет';
}

function syncEmptyState(select, owner, lifecycle) {
  const root = plansRoot(select);
  const list = root.querySelector('#plans-list, [data-plans-list], .plans-list');
  if (!list || list.querySelector('.plan-card, [data-plan-id]')) return;
  const empty = list.querySelector('[data-empty-state], .empty-state, .state-empty, .plans-empty');
  if (!empty) return;

  const generic = 'Планов по этим условиям нет.';
  const known = new Set([generic, 'Планов по этим условиям нет', 'Текущих планов нет', 'Архив пуст']);
  const current = String(empty.textContent || '').trim();
  if (!known.has(current)) return;

  const constrained = hasSecondaryConstraint(select, owner);
  const next = constrained ? generic : emptyTextFor(select, lifecycle);
  if (current !== next) empty.textContent = next;
  empty.dataset.planLifecycleEmpty = constrained
    ? 'filtered'
    : (select.value === lifecycle.archived.value ? 'archived' : 'active');
}

function dispatchLifecycleChange(select, value) {
  if (select.value === value) return false;
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function syncActive() {
  const active = state.active;
  if (!active || !active.select.isConnected || !active.segment.isConnected) return;
  const selectedView = active.select.value === active.lifecycle.archived.value ? 'archived' : 'active';
  for (const button of active.buttons) {
    const selected = button.dataset.lifecycleView === selectedView;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  }
  queueMicrotask(() => {
    if (state.active === active && active.select.isConnected) {
      syncEmptyState(active.select, active.owner, active.lifecycle);
    }
  });
}

export function detachActive() {
  const active = state.active;
  if (!active) return;
  active.select.removeEventListener('input', active.syncHandler);
  active.select.removeEventListener('change', active.syncHandler);
  active.segment.remove();
  active.select.removeAttribute(ENHANCED_ATTRIBUTE);
  if (active.select.isConnected) restoreVisibilityState(active.select, active.selectState);
  if (active.owner !== active.select && active.owner.isConnected) {
    restoreVisibilityState(active.owner, active.ownerState);
  }
  state.active = null;
}

export function enhanceLifecycleSelect(select) {
  if (!(select instanceof HTMLSelectElement) || !select.isConnected || !state.media?.matches) return null;
  const lifecycle = resolveLifecycleOptions(select);
  if (!lifecycle) return null;
  if (state.active?.select === select && state.active.segment.isConnected) {
    syncActive();
    return state.active.segment;
  }

  detachActive();
  const owner = sourceOwner(select);
  const segment = document.createElement('div');
  segment.id = SEGMENT_ID;
  segment.className = 'plans-lifecycle-segment';
  segment.setAttribute('role', 'tablist');
  segment.setAttribute('aria-label', 'Показать планы');
  segment.dataset.planLifecycle = 'desktop';

  const definitions = [
    { view: 'active', label: 'Текущие', option: lifecycle.current },
    { view: 'archived', label: 'Архив', option: lifecycle.archived }
  ];
  const buttons = definitions.map(({ view, label, option }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plans-lifecycle-segment__button';
    button.dataset.lifecycleView = view;
    button.dataset.lifecycleValue = option.value;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.textContent = label;
    segment.append(button);
    return button;
  });

  const activateButton = (button) => {
    if (!button) return;
    dispatchLifecycleChange(select, button.dataset.lifecycleValue || '');
    syncActive();
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activateButton(button));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
      if (event.key === 'ArrowRight') nextIndex = Math.min(buttons.length - 1, index + 1);
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      buttons[nextIndex].focus();
      activateButton(buttons[nextIndex]);
    });
  });

  const selectState = captureVisibilityState(select);
  const ownerState = owner === select ? null : captureVisibilityState(owner);
  owner.before(segment);
  conceal(select);
  if (owner !== select) conceal(owner);
  select.setAttribute(ENHANCED_ATTRIBUTE, 'true');

  const syncHandler = () => syncActive();
  select.addEventListener('input', syncHandler);
  select.addEventListener('change', syncHandler);
  state.active = { select, owner, segment, buttons, lifecycle, selectState, ownerState, syncHandler };
  syncActive();
  return segment;
}

function scan() {
  if (!state.media?.matches) {
    detachActive();
    return;
  }
  const source = document.getElementById(SOURCE_ID)
    || document.querySelector('select[data-plan-lifecycle-status]');
  if (!source) {
    detachActive();
    return;
  }
  enhanceLifecycleSelect(source);
}

function scheduleScan() {
  if (state.scanQueued) return;
  state.scanQueued = true;
  requestAnimationFrame(() => {
    state.scanQueued = false;
    scan();
  });
}

function mediaChanged() {
  if (state.media?.matches) scheduleScan();
  else detachActive();
}

export function installPlansLifecycleDesktop(root = document) {
  ensureStylesheet(root.ownerDocument || root);
  if (!state.media) {
    state.media = window.matchMedia(DESKTOP_QUERY);
    state.mediaHandler = mediaChanged;
    if (typeof state.media.addEventListener === 'function') state.media.addEventListener('change', state.mediaHandler);
    else state.media.addListener(state.mediaHandler);
  }
  if (!state.observer) {
    state.observer = new MutationObserver(scheduleScan);
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  state.installed = true;
  scan();
}

export function destroyPlansLifecycleDesktop() {
  detachActive();
  state.observer?.disconnect();
  state.observer = null;
  if (state.media && state.mediaHandler) {
    if (typeof state.media.removeEventListener === 'function') state.media.removeEventListener('change', state.mediaHandler);
    else state.media.removeListener(state.mediaHandler);
  }
  state.media = null;
  state.mediaHandler = null;
  state.scanQueued = false;
  state.installed = false;
}

if (typeof document !== 'undefined') {
  globalThis.KafedraPlansLifecycleDesktop = {
    installPlansLifecycleDesktop,
    destroyPlansLifecycleDesktop,
    enhanceLifecycleSelect,
    resolveLifecycleOptions,
    detachActive,
    restoreVisibilityState
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installPlansLifecycleDesktop(), { once: true });
  } else {
    installPlansLifecycleDesktop();
  }
}
