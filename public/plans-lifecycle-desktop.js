const DESKTOP_MEDIA = '(min-width: 721px)';
const SEGMENT_ID = 'plans-lifecycle-segment';
const STYLE_ID = 'plans-lifecycle-desktop-styles';
const VALID_VALUES = new Set(['active', 'archived']);
const media = window.matchMedia(DESKTOP_MEDIA);
const originalState = new WeakMap();
let reconcileQueued = false;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plans-lifecycle-desktop.css';
  document.head.append(link);
}

function findBridge() {
  return document.getElementById('plans-lifecycle-status');
}

function findFilterbar(select) {
  return select?.closest('[data-plan-filters], .plans-filterbar') || null;
}

function remember(select) {
  if (originalState.has(select)) return;
  originalState.set(select, {
    ariaHidden: select.getAttribute('aria-hidden'),
    tabIndex: select.getAttribute('tabindex')
  });
}

function restoreBridge(select) {
  if (!select) return;
  const state = originalState.get(select);
  select.classList.remove('plans-lifecycle-bridge');
  findFilterbar(select)?.classList.remove('has-plans-lifecycle-segment');
  if (state?.ariaHidden === null || state?.ariaHidden === undefined) select.removeAttribute('aria-hidden');
  else select.setAttribute('aria-hidden', state.ariaHidden);
  if (state?.tabIndex === null || state?.tabIndex === undefined) select.removeAttribute('tabindex');
  else select.setAttribute('tabindex', state.tabIndex);
}

function filtered() {
  return ['plans-q', 'plans-kind', 'plans-period', 'plans-direction', 'plans-responsible']
    .some((id) => String(document.getElementById(id)?.value || '').trim());
}

function updateEmptyState(value) {
  const empty = document.querySelector('#plans-list > .empty-state');
  if (!empty) return;
  const known = new Set(['Планов по этим условиям нет.', 'Текущих планов нет', 'Архив пуст']);
  if (!known.has(empty.textContent.trim())) return;
  const nextText = filtered()
    ? 'Планов по этим условиям нет.'
    : (value === 'archived' ? 'Архив пуст' : 'Текущих планов нет');
  if (empty.textContent.trim() !== nextText) empty.textContent = nextText;
}

function syncSegment(segment, select) {
  if (!segment || !select) return;
  const value = VALID_VALUES.has(select.value) ? select.value : 'active';
  segment.querySelectorAll('[data-lifecycle-view]').forEach((button) => {
    const selected = button.dataset.lifecycleView === value;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle('is-selected', selected);
  });
  updateEmptyState(value);
}

function dispatchBridge(select, value) {
  if (!VALID_VALUES.has(value) || select.value === value) return false;
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function activate(button) {
  const segment = button.closest(`#${SEGMENT_ID}`);
  const select = findBridge();
  if (!segment || !select) return;
  const changed = dispatchBridge(select, button.dataset.lifecycleView);
  syncSegment(segment, select);
  if (changed) button.focus({ preventScroll: true });
}

function segmentMarkup() {
  const segment = document.createElement('div');
  segment.id = SEGMENT_ID;
  segment.className = 'plans-lifecycle-segment';
  segment.setAttribute('role', 'tablist');
  segment.setAttribute('aria-label', 'Состояние планов');
  segment.innerHTML = `
    <button type="button" role="tab" data-lifecycle-view="active" aria-selected="false" tabindex="-1">Текущие</button>
    <button type="button" role="tab" data-lifecycle-view="archived" aria-selected="false" tabindex="-1">Архив</button>
  `;
  return segment;
}

function placeSegment(segment, filterbar, select) {
  const search = filterbar.querySelector('.plans-search');
  if (search) {
    if (segment.parentElement !== filterbar || search.nextElementSibling !== segment) search.after(segment);
    return;
  }
  if (segment.parentElement !== filterbar || select.previousElementSibling !== segment) select.before(segment);
}

function removeSegment() {
  document.getElementById(SEGMENT_ID)?.remove();
  restoreBridge(findBridge());
}

function reconcile() {
  reconcileQueued = false;
  const select = findBridge();
  if (!media.matches) {
    removeSegment();
    return;
  }
  if (!select) return;
  const filterbar = findFilterbar(select);
  if (!filterbar) return;

  ensureStyles();
  remember(select);
  select.classList.add('plans-lifecycle-bridge');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  filterbar.classList.add('has-plans-lifecycle-segment');

  let segment = document.getElementById(SEGMENT_ID);
  if (!segment) segment = segmentMarkup();
  placeSegment(segment, filterbar, select);
  syncSegment(segment, select);
}

function scheduleReconcile() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest(`#${SEGMENT_ID} [data-lifecycle-view]`);
  if (button) activate(button);
}, true);

document.addEventListener('keydown', (event) => {
  const button = event.target.closest(`#${SEGMENT_ID} [data-lifecycle-view]`);
  if (!button) return;
  const buttons = [...button.closest(`#${SEGMENT_ID}`).querySelectorAll('[data-lifecycle-view]')];
  let target = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = buttons[(buttons.indexOf(button) + 1) % buttons.length];
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = buttons[(buttons.indexOf(button) - 1 + buttons.length) % buttons.length];
  if (event.key === 'Home') target = buttons[0];
  if (event.key === 'End') target = buttons.at(-1);
  if (!target) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
  activate(target);
}, true);

document.addEventListener('input', (event) => {
  if (event.target.id === 'plans-lifecycle-status' || event.target.closest('[data-plan-filters], .plans-filterbar')) {
    scheduleReconcile();
  }
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'plans-lifecycle-status' || event.target.closest('[data-plan-filters], .plans-filterbar')) {
    scheduleReconcile();
  }
}, true);

const observer = new MutationObserver(scheduleReconcile);
observer.observe(document.documentElement, { childList: true, subtree: true });
if (typeof media.addEventListener === 'function') media.addEventListener('change', scheduleReconcile);
else media.addListener(scheduleReconcile);

scheduleReconcile();
