// Shared presentation behavior. Domain modules retain ownership of open/save/close.
const definitions = [
  ['#event-sheet', '[data-close-sheet]', '#sheet-backdrop', true],
  ['#template-sheet', '[data-close-sheet]', '#sheet-backdrop', false],
  ['#calendar-start-settings-sheet', '[data-close-sheet]', '#sheet-backdrop', false],
  ['#plan-item-modal', '[data-plans-close]', '#plans-modal-backdrop', true],
  ['#plan-generate-modal', '[data-plans-close]', '#plans-modal-backdrop', true],
  ['#plan-template-modal', '[data-plans-close]', '#plans-modal-backdrop', true],
  ['#manual-plan-modal', '[data-manual-close]', '#manual-plan-backdrop', true],
  ['#meeting-modal', '[data-close-meeting-modal]', '#meeting-modal-backdrop', true],
  ['#lifecycle-modal', '[data-lifecycle-close]', '#lifecycle-modal-backdrop', true],
  ['#directive-modal', '[data-directive-modal-close]', '#directive-modal-backdrop', true],
  ['#organization-shell-panel', '[data-organization-shell-close]', '#organization-shell-backdrop', false],
  ['#organization-modal', '[data-organization-close]', '#organization-backdrop', true],
  ['#science-import-modal', '[data-science-import-close]', '#science-import-backdrop', true],
  ['#science-lifecycle-modal', '[data-science-lifecycle-close]', '#science-lifecycle-backdrop', true],
  ['#science-report-modal', '[data-science-report-close]', '#science-report-backdrop', true],
  ['[data-academic-modal]', '[data-academic-close]', '[data-academic-backdrop]', true],
  ['[data-academic-details]', '[data-academic-details-close]', '[data-academic-backdrop]', false],
  ['#metric-correction-sheet', '[data-pft-close]', '#sheet-backdrop', true],
  ['#plan-fact-view-sheet', '[data-pft-close]', '#sheet-backdrop', true],
  ['#action-center', '[data-action-center-close]', '#action-center-backdrop', false]
];
const focusableSelector = 'button,input,select,textarea,a[href],summary,[tabindex],[contenteditable="true"]';
const active = new Map();
const origins = new WeakMap();
const madeInert = new Set();
let serial = 0;
let lastTrigger = null;
let topRecord = null;
let frame = 0;
let bypass = false;
let discardDialog = null;
let scrollStyle = null;
let wasSuspended = false;

const visible = el => Boolean(el?.isConnected && !el.closest('.hidden,[hidden]')
  && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
const usable = el => visible(el) && !el.closest('[inert]') && !el.matches(':disabled');
const controls = root => [...root.querySelectorAll(focusableSelector)]
  .filter(el => usable(el) && el.tabIndex >= 0 && el.type !== 'hidden');
const nativeModal = () => [...document.querySelectorAll('dialog[open]')].findLast(el => el.matches(':modal'));
const authGate = () => { const gate = document.querySelector('#auth-gate'); return visible(gate) ? gate : null; };
const suspended = () => Boolean(nativeModal() || authGate());
function focus(el) { if (usable(el)) el.focus({ preventScroll: true }); }
function fallbackFocus() {
  return [...document.querySelectorAll('.nav-item.active,.mobile-tab.active,#create-button')].find(usable);
}
function originFor(el) {
  return { element: el, fallback: [...active.values()].find(r => r.element.contains(el))?.origin || null };
}
function restore(origin, container = null) {
  for (let item = origin; item; item = item.fallback) {
    if (usable(item.element) && item.element.matches(focusableSelector) && (!container || container.contains(item.element))) { focus(item.element); return; }
  }
  if (container) initialFocus({ element: container });
  else focus(fallbackFocus());
}
export function rememberPanel(element) {
  if (element && !visible(element)) origins.set(element, originFor(lastTrigger || document.activeElement));
}
export function releasePanel(element) {
  const origin = origins.get(element);
  origins.delete(element);
  requestAnimationFrame(() => { if (!topRecord && !suspended()) restore(origin); });
}
function initialFocus(record) {
  const root = record.element;
  const preferred = root.querySelector('[autofocus]');
  const candidates = controls(root);
  focus(usable(preferred) ? preferred : candidates.find(el => el.matches('input:not([type=hidden]),select,textarea')) || candidates[0] || root);
}
function nameDialog(root) {
  const heading = root.querySelector('h1,h2,h3');
  if (heading) {
    if (!heading.id) heading.id = `workspace-dialog-title-${++serial}`;
    root.setAttribute('aria-labelledby', heading.id);
  }
  root.tabIndex = -1;
  root.dataset.workspaceDialog = 'true';
}
function clearInert() {
  for (const el of madeInert) el.inert = false;
  madeInert.clear();
}
function isolate(record) {
  clearInert();
  if (!record || suspended()) return;
  const backdrop = document.querySelector(record.definition[2]);
  let branch = record.element;
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || sibling === backdrop || sibling.contains(backdrop)
        || sibling.matches('script,style,link,dialog,[role=status],[role=alert]') || sibling.inert) continue;
      sibling.inert = true;
      madeInert.add(sibling);
    }
    if (branch.parentElement === document.body) break;
    branch = branch.parentElement;
  }
}
function refresh() {
  frame = 0;
  const oldTop = topRecord;
  const removed = [];
  for (const [key, record] of active) {
    if (!visible(record.element) || document.querySelector(key) !== record.element) {
      active.delete(key);
      record.element.style.zIndex = record.zIndex;
      removed.push(record);
    }
  }
  for (const definition of definitions) {
    const [key] = definition;
    const element = document.querySelector(key);
    if (!visible(element)) continue;
    let record = active.get(key);
    if (!record) {
      const previous = removed.find(item => item.definition[0] === key);
      record = { definition, element, origin: previous?.origin || originFor(lastTrigger || document.activeElement),
        order: ++serial, dirty: false, form: null, zIndex: element.style.zIndex };
      active.set(key, record);
    }
    const form = element.querySelector('form');
    if (record.form !== form) {
      record.form = form;
      // Replacing an editor DOM node is not a save. A receipt without a form is read-only.
      if (!form) record.dirty = false;
    }
    nameDialog(element);
    for (const button of element.querySelectorAll(definition[1])) {
      if (/^[×✕x]$/.test(button.textContent.trim()) && !button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Закрыть');
    }
  }
  const stack = [...active.values()].sort((a,b) => a.order - b.order);
  topRecord = stack.at(-1) || null;
  stack.forEach((record,index) => {
    const zIndex = String(200 + index * 2);
    if (record.element.style.zIndex !== zIndex) record.element.style.zIndex = zIndex;
    const backdrop = document.querySelector(record.definition[2]);
    if (backdrop) {
      if (backdrop.classList.contains('hidden')) backdrop.classList.remove('hidden');
      const backdropIndex = String(199 + index * 2);
      if (backdrop.style.zIndex !== backdropIndex) backdrop.style.zIndex = backdropIndex;
    }
  });
  if (document.body.classList.contains('workspace-dialog-open') !== Boolean(topRecord)) document.body.classList.toggle('workspace-dialog-open', Boolean(topRecord));
  const paused = suspended();
  if (paused) clearInert();
  if (topRecord !== oldTop || paused !== wasSuspended) {
    isolate(topRecord);
    if (topRecord && !suspended()) {
      if (topRecord.element.contains(document.activeElement) && usable(document.activeElement)) topRecord.lastFocus = document.activeElement;
      else if (removed.includes(oldTop)) restore(oldTop.origin, topRecord.element);
      else if (wasSuspended && !paused && usable(topRecord.lastFocus)) focus(topRecord.lastFocus);
      else initialFocus(topRecord);
    }
    else if (oldTop && !suspended()) restore(oldTop.origin);
  } else if (topRecord && !suspended() && !topRecord.element.contains(document.activeElement)) {
    initialFocus(topRecord);
  }
  wasSuspended = paused;
  // A layer's existing close function can clear overflow while its parent is open.
  if (topRecord && scrollStyle === null) scrollStyle = document.body.style.overflow;
  if (!topRecord && scrollStyle !== null) { document.body.style.overflow = scrollStyle === 'hidden' ? '' : scrollStyle; scrollStyle = null; }
}
function schedule() { if (!frame) frame = requestAnimationFrame(refresh); }
function closeThroughOwner(record) {
  const button = [...record.element.querySelectorAll(record.definition[1])].find(usable);
  if (!button) return;
  bypass = true;
  try { button.click(); } finally { bypass = false; }
  schedule();
}
function requestDismiss(record) {
  if (!record.definition[3] || !record.dirty) { closeThroughOwner(record); return; }
  if (discardDialog?.open) return;
  discardDialog = document.createElement('dialog');
  discardDialog.className = 'workspace-discard-dialog';
  discardDialog.setAttribute('aria-labelledby', 'workspace-discard-title');
  discardDialog.innerHTML = `<h2 id="workspace-discard-title">Не сохранять изменения?</h2>
    <p>Введённые данные останутся в форме, пока вы продолжаете редактирование.</p>
    <div class="workspace-discard-actions">
      <button type="button" class="primary-button" data-workspace-continue autofocus>Продолжить редактирование</button>
      <button type="button" class="secondary-button" data-workspace-discard>Не сохранять</button>
    </div>`;
  const dialog = discardDialog;
  const returnFocus = record.element.contains(document.activeElement) ? document.activeElement : record.lastFocus;
  dialog.querySelector('[data-workspace-continue]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-workspace-discard]').addEventListener('click', () => dialog.close('discard'));
  dialog.addEventListener('close', () => {
    const discard = dialog.returnValue === 'discard';
    dialog.remove();
    discardDialog = null;
    isolate(topRecord);
    if (discard && visible(record.element)) closeThroughOwner(record);
    else if (visible(record.element)) {
      record.lastFocus = returnFocus;
      if (usable(returnFocus)) focus(returnFocus);
      else initialFocus(record);
    }
  }, { once: true });
  document.body.append(dialog);
  clearInert();
  dialog.showModal();
}
window.addEventListener('pointerdown', event => {
  const target = event.target.closest?.(focusableSelector);
  if (target && !target.closest('dialog')) lastTrigger = target;
}, true);
window.addEventListener('click', event => {
  const record = topRecord;
  if (bypass || !record || suspended()) return;
  const target = event.target;
  const close = target.closest?.(record.definition[1]);
  const backdrop = document.querySelector(record.definition[2]);
  if ((close && record.element.contains(close)) || target === backdrop) {
    event.preventDefault();event.stopImmediatePropagation();
    if (close?.textContent.trim() === 'Отмена') closeThroughOwner(record);
    else requestDismiss(record);
  }
}, true);
window.addEventListener('keydown', event => {
  if (event.isComposing) return;
  refresh();
  if (event.key === 'Enter' || event.key === ' '
    || ((event.ctrlKey || event.metaKey) && ['k','n'].includes(event.key.toLowerCase()))) lastTrigger = event.target;
  if (authGate()) {
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && ['k','n'].includes(event.key.toLowerCase()))) { event.preventDefault(); event.stopImmediatePropagation(); }
    return;
  }
  const native = nativeModal();
  if (native) {
    // Let the browser close only its top-layer dialog, not every legacy Escape handler.
    if (event.key === 'Escape') event.stopImmediatePropagation();
    if ((event.ctrlKey || event.metaKey) && ['k','n'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    return;
  }
  const record = topRecord;
  if (!record) return;
  if (event.key === 'Escape') {
    event.preventDefault();event.stopImmediatePropagation();requestDismiss(record);return;
  }
  if (event.key === 'Tab') {
    // Action center owns its local Tab trap; do not run a competing shared trap.
    if (record.element.id === 'action-center') return;
    const items = controls(record.element);
    const current = document.activeElement;
    const target = event.shiftKey ? items.at(-1) : items[0];
    if (!items.length || !record.element.contains(current)
      || (event.shiftKey ? current === items[0] || current === record.element : current === items.at(-1))) {
      event.preventDefault();focus(target || record.element);
    }
  }
  if ((event.ctrlKey || event.metaKey) && ['k','n'].includes(event.key.toLowerCase())) {
    event.preventDefault();event.stopImmediatePropagation();
  }
}, true);
window.addEventListener('focusin', event => {
  if (topRecord && !suspended() && topRecord.element.contains(event.target)) topRecord.lastFocus = event.target;
  if (topRecord && !suspended() && !topRecord.element.contains(event.target)) initialFocus(topRecord);
}, true);
for (const name of ['input','change']) window.addEventListener(name, event => {
  if (!event.isTrusted) return;
  refresh();
  if (!topRecord || suspended()) return;
  if (topRecord.definition[3] && topRecord.element.contains(event.target)
    && event.target.matches('input:not([type=hidden]):not([type=password]),textarea,select')) topRecord.dirty = true;
}, true);
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','hidden','open','style'] });
window.addEventListener('resize', schedule);
refresh();
