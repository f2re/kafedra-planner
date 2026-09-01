const STYLE_ID = 'plans-lifecycle-segment-stylesheet';
const SEGMENT_ID = 'plans-lifecycle-segment';
const SOURCE_ID = 'plans-lifecycle-status';

export const PLAN_LIFECYCLE_MODES = Object.freeze([
  { value: 'active', label: 'Текущие' },
  { value: 'archived', label: 'Архив' }
]);

export function normalizePlanLifecycleMode(value) {
  return value === 'archived' ? 'archived' : 'active';
}

export function nextPlanLifecycleMode(current, key) {
  const index = PLAN_LIFECYCLE_MODES.findIndex((item) => item.value === normalizePlanLifecycleMode(current));
  if (key === 'Home') return PLAN_LIFECYCLE_MODES[0].value;
  if (key === 'End') return PLAN_LIFECYCLE_MODES.at(-1).value;
  if (key === 'ArrowLeft') {
    return PLAN_LIFECYCLE_MODES[(index - 1 + PLAN_LIFECYCLE_MODES.length) % PLAN_LIFECYCLE_MODES.length].value;
  }
  if (key === 'ArrowRight') {
    return PLAN_LIFECYCLE_MODES[(index + 1) % PLAN_LIFECYCLE_MODES.length].value;
  }
  return PLAN_LIFECYCLE_MODES[index].value;
}

function ensureStylesheet(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plans-lifecycle-segment.css';
  doc.head.append(link);
}

function hideCompatibilitySelect(select) {
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.dataset.lifecycleCompatibilityBridge = 'true';
}

function emptyMessage(mode) {
  return mode === 'archived'
    ? 'Архивных планов по этим условиям нет.'
    : 'Текущих планов по этим условиям нет.';
}

function syncEmptyState(doc, mode) {
  const list = doc.querySelector('#plans-list');
  if (!list || list.querySelector('.plan-card, [data-plan-id]')) return;
  const empty = list.querySelector('.empty-state');
  if (!empty) return;
  const current = empty.textContent.trim();
  const recognized = new Set([
    'Планов по этим условиям нет.',
    'Текущих планов по этим условиям нет.',
    'Архивных планов по этим условиям нет.'
  ]);
  if (recognized.has(current)) empty.textContent = emptyMessage(mode);
}

function syncSegment(doc = document) {
  const select = doc.getElementById(SOURCE_ID);
  const segment = doc.getElementById(SEGMENT_ID);
  if (!(select instanceof HTMLSelectElement) || !segment) return;
  const mode = normalizePlanLifecycleMode(select.value);
  segment.querySelectorAll('[role="tab"]').forEach((button) => {
    const selected = button.dataset.lifecycleValue === mode;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  segment.dataset.lifecycleValue = mode;
  syncEmptyState(doc, mode);
}

function selectMode(select, mode) {
  const normalized = normalizePlanLifecycleMode(mode);
  if (select.value !== normalized) {
    select.value = normalized;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  queueMicrotask(() => syncSegment(select.ownerDocument));
}

function createSegment(select) {
  const doc = select.ownerDocument;
  const segment = doc.createElement('div');
  segment.id = SEGMENT_ID;
  segment.className = 'plans-lifecycle-segment';
  segment.setAttribute('role', 'tablist');
  segment.setAttribute('aria-label', 'Состояние планов');
  segment.innerHTML = PLAN_LIFECYCLE_MODES.map((item) => `
    <button
      type="button"
      class="plans-lifecycle-segment__tab"
      role="tab"
      aria-controls="plans-list"
      aria-selected="false"
      tabindex="-1"
      data-lifecycle-value="${item.value}"
    >${item.label}</button>
  `).join('');

  segment.addEventListener('click', (event) => {
    const button = event.target.closest('[role="tab"][data-lifecycle-value]');
    if (!button || !segment.contains(button)) return;
    selectMode(select, button.dataset.lifecycleValue);
  });

  segment.addEventListener('keydown', (event) => {
    const button = event.target.closest('[role="tab"][data-lifecycle-value]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = nextPlanLifecycleMode(button.dataset.lifecycleValue, event.key);
    selectMode(select, next);
    segment.querySelector(`[data-lifecycle-value="${next}"]`)?.focus();
  });

  const filterbar = select.closest('.plans-filterbar') || doc.querySelector('.plans-filterbar');
  if (filterbar) filterbar.before(segment);
  else select.before(segment);
  return segment;
}

let observedDocument = null;
let observer = null;
let boundSelect = null;
let scheduled = false;

function reconcile(doc = document) {
  const select = doc.getElementById(SOURCE_ID);
  if (!(select instanceof HTMLSelectElement)) return null;
  ensureStylesheet(doc);
  hideCompatibilitySelect(select);

  let segment = doc.getElementById(SEGMENT_ID);
  if (!segment || boundSelect !== select) {
    segment?.remove();
    segment = createSegment(select);
    boundSelect = select;
    select.addEventListener('change', () => queueMicrotask(() => syncSegment(doc)));
  }
  syncSegment(doc);
  return segment;
}

function scheduleReconcile(doc) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    reconcile(doc);
  });
}

export function installPlansLifecycleSegment(doc = document) {
  const segment = reconcile(doc);
  if (observer && observedDocument === doc) return segment;
  observer?.disconnect();
  observedDocument = doc;
  observer = new MutationObserver(() => scheduleReconcile(doc));
  if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
  return segment;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installPlansLifecycleSegment(document), { once: true });
  } else {
    installPlansLifecycleSegment(document);
  }
}
