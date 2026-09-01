const STYLE_ID = 'plans-lifecycle-desktop-stylesheet';
const SEGMENT_ID = 'plans-lifecycle-segment';
const SOURCE_ID = 'plans-lifecycle-status';
const ENHANCED_ATTRIBUTE = 'data-plans-lifecycle-desktop';

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
  return select.closest('[data-view="plans"], [data-plans-root], #plans-view, #plansView, #plans, .plans-view, .plans-next')
    || select.closest('section, main')
    || document;
}

function filterRoot(select, owner) {
  return owner.closest('[data-plan-filters], .plans-toolbar, .plan-filters, .filters, .filter-grid')
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
  const archived = select.value === lifecycle.archived.value;
  return archived ? 'Архив пуст' : 'Текущих планов нет';
}

function syncEmptyState(select, owner, lifecycle) {
  const root = plansRoot(select);
  const constrained = hasSecondaryConstraint(select, owner);
  const generic = 'Планов по этим условиям нет.';
  const known = new Set([generic, 'Планов по этим условиям нет', 'Текущих планов нет', 'Архив пуст']);
  for (const element of root.querySelectorAll('[data-empty-state], .empty-state, .state-empty, .plans-empty, .muted')) {
    const text = String(element.textContent || '').trim();
    if (!known.has(text)) continue;
    element.textContent = constrained ? generic : emptyTextFor(select, lifecycle);
    element.dataset.planLifecycleEmpty = constrained ? 'filtered' : (select.value === lifecycle.archived.value ? 'archived' : 'current');
  }
}

function hideSource(select, owner) {
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.dataset.lifecycleSource = 'true';
  if (owner !== select) {
    owner.hidden = true;
    owner.setAttribute('aria-hidden', 'true');
    owner.dataset.lifecycleSourceHidden = 'true';
  }
}

function showSource(select, owner) {
  select.hidden = false;
  select.removeAttribute('aria-hidden');
  select.removeAttribute('tabindex');
  delete select.dataset.lifecycleSource;
  if (owner !== select) {
    owner.hidden = false;
    owner.removeAttribute('aria-hidden');
    delete owner.dataset.lifecycleSourceHidden;
  }
}

function dispatchLifecycleChange(select, value) {
  if (select.value === value) return false;
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

let activeSelect = null;
let activeOwner = null;
let activeSegment = null;
let activeChangeHandler = null;
let observer = null;
let scanQueued = false;

function detachActive() {
  if (activeSelect && activeChangeHandler) activeSelect.removeEventListener('change', activeChangeHandler);
  if (activeSelect?.isConnected && activeOwner) showSource(activeSelect, activeOwner);
  activeSegment?.remove();
  if (activeSelect) activeSelect.removeAttribute(ENHANCED_ATTRIBUTE);
  activeSelect = null;
  activeOwner = null;
  activeSegment = null;
  activeChangeHandler = null;
}

export function enhanceLifecycleSelect(select) {
  if (!(select instanceof HTMLSelectElement) || !select.isConnected) return null;
  const lifecycle = resolveLifecycleOptions(select);
  if (!lifecycle) return null;
  if (activeSelect === select && activeSegment?.isConnected) return activeSegment;
  detachActive();

  const owner = sourceOwner(select);
  const segment = document.createElement('div');
  segment.id = SEGMENT_ID;
  segment.className = 'plans-lifecycle-segment';
  segment.setAttribute('role', 'tablist');
  segment.setAttribute('aria-label', 'Показать планы');
  segment.dataset.planLifecycle = 'desktop';

  const definitions = [
    { key: 'current', label: 'Текущие', option: lifecycle.current },
    { key: 'archived', label: 'Архив', option: lifecycle.archived }
  ];
  const buttons = definitions.map(({ key, label, option }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plans-lifecycle-segment__button';
    button.dataset.lifecycleView = key;
    button.dataset.lifecycleValue = option.value;
    button.setAttribute('role', 'tab');
    button.textContent = label;
    segment.append(button);
    return button;
  });

  const sync = () => {
    const selectedKey = select.value === lifecycle.archived.value ? 'archived' : 'current';
    for (const button of buttons) {
      const selected = button.dataset.lifecycleView === selectedKey;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
    queueMicrotask(() => {
      if (select.isConnected) syncEmptyState(select, owner, lifecycle);
    });
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      dispatchLifecycleChange(select, button.dataset.lifecycleValue || '');
      sync();
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
      if (event.key === 'ArrowRight') nextIndex = Math.min(buttons.length - 1, index + 1);
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      buttons[nextIndex].focus();
      buttons[nextIndex].click();
    });
  });

  owner.before(segment);
  hideSource(select, owner);
  select.setAttribute(ENHANCED_ATTRIBUTE, 'true');
  select.addEventListener('change', sync);
  activeSelect = select;
  activeOwner = owner;
  activeSegment = segment;
  activeChangeHandler = sync;
  sync();
  return segment;
}

function scan() {
  const source = document.getElementById(SOURCE_ID)
    || document.querySelector('select[data-plan-lifecycle-status]');
  if (!source) {
    if (activeSelect && !activeSelect.isConnected) detachActive();
    return;
  }
  enhanceLifecycleSelect(source);
  if (activeSelect && activeOwner) {
    const lifecycle = resolveLifecycleOptions(activeSelect);
    if (lifecycle) syncEmptyState(activeSelect, activeOwner, lifecycle);
  }
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scan();
  });
}

export function installPlansLifecycleDesktop(root = document) {
  ensureStylesheet(root.ownerDocument || root);
  scan();
  if (observer || !document.body) return;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  globalThis.KafedraPlansLifecycleDesktop = {
    enhanceLifecycleSelect,
    installPlansLifecycleDesktop,
    resolveLifecycleOptions
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installPlansLifecycleDesktop(), { once: true });
  } else {
    installPlansLifecycleDesktop();
  }
}
