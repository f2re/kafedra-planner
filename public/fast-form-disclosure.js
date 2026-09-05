const one = (selector, root = document) => root.querySelector(selector);
const all = (selector, root = document) => [...root.querySelectorAll(selector)];

function ensureStyles() {
  if (one('#r7-fast-form-styles')) return;
  const link = document.createElement('link');
  link.id = 'r7-fast-form-styles';
  link.rel = 'stylesheet';
  link.href = '/fast-form-disclosure.css';
  document.head.append(link);
}

function fieldLabel(selector, root) {
  return one(selector, root)?.closest('label') || null;
}

function eventKindLabel() {
  return one('#event-kind')?.selectedOptions?.[0]?.textContent?.trim() || 'Событие';
}

function syncEventSummary() {
  const summary = one('[data-r7-event-context]');
  if (!summary) return;
  const date = one('#event-date')?.value || 'дата не выбрана';
  summary.textContent = `${eventKindLabel()} · ${date}`;
}

function patchEventForm() {
  const form = one('#event-form');
  if (!form || form.dataset.r7FastPatched === '1') {
    syncEventSummary();
    return;
  }
  const title = fieldLabel('#event-title', form);
  const date = fieldLabel('#event-date', form);
  const kind = fieldLabel('#event-kind', form);
  const category = fieldLabel('#event-category', form);
  const importance = fieldLabel('#event-importance', form);
  const reminder = fieldLabel('#event-reminder', form);
  const description = fieldLabel('#event-description', form);
  const actions = one('.sheet-actions', form);
  if (!title || !date || !kind || !actions) return;

  const primary = document.createElement('div');
  primary.className = 'r7-fast-primary r7-event-primary full';
  const context = document.createElement('div');
  context.className = 'r7-fast-context';
  context.innerHTML = '<span>Контекст</span><strong data-r7-event-context></strong>';
  primary.append(title, date, context);
  form.insertBefore(primary, actions);

  const details = document.createElement('details');
  details.id = 'event-more-fields';
  details.className = 'r7-fast-details full';
  details.innerHTML = '<summary><span>Дополнительно</span><small>тип, категория, важность, напоминание и комментарий</small></summary><div class="r7-fast-details-body"></div>';
  const body = one('.r7-fast-details-body', details);
  [kind, category, importance, reminder, description].filter(Boolean).forEach((field) => body.append(field));
  form.insertBefore(details, actions);
  form.dataset.r7FastPatched = '1';
  syncEventSummary();
}

function openFastCalendarEntry(date) {
  const form = one('#event-form');
  const sheet = one('#event-sheet');
  if (!form || !sheet) return false;
  form.reset();
  one('#event-id').value = '';
  one('#event-title').value = '';
  const dateInput = one('#event-date');
  dateInput.value = date;
  dateInput.dataset.uiPreferenceExplicitDate = '1';
  window.kafedraPreferenceOrigin?.mark?.(dateInput, 'domain');
  const title = one('#event-sheet-title');
  if (title) title.textContent = 'Новая запись';
  patchEventForm();
  const details = one('#event-more-fields');
  if (details) details.open = false;
  one('#sheet-backdrop')?.classList.remove('hidden');
  sheet.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  window.dispatchEvent(new CustomEvent('kafedra:calendar-context-date', { detail: { date } }));
  queueMicrotask(() => one('#event-title')?.focus());
  return true;
}

function moveIfNeeded(node, parent) {
  if (node && node.parentElement !== parent) parent.append(node);
}

function syncPlanPrimary(form) {
  const primary = one('[data-r7-plan-primary]', form);
  if (!primary) return;
  const choice = one('[data-r7-plan-choice]', form);
  const title = fieldLabel('[name="title"]', form);
  const starts = fieldLabel('[name="startsAt"]', form);
  const due = fieldLabel('[name="dueDate"]', form);
  const mode = fieldLabel('[name="executionMode"]', form);
  const helper = one('[data-manual-execution-help]', form);
  [choice, title, starts, due, mode, helper].forEach((node) => moveIfNeeded(node, primary));
  const primaryExecutor = one('.manual-primary-executor', form);
  if (primaryExecutor) {
    moveIfNeeded(primaryExecutor, primary);
    primaryExecutor.classList.toggle('hidden', one('[name="executionMode"]', form)?.value === 'track');
  }
}

function patchPlanItemForm(form) {
  if (!form) return;
  if (form.dataset.r7FastPatched !== '1') {
    const actions = one('.manual-modal-actions', form);
    if (!actions) return;
    const primary = document.createElement('div');
    primary.className = 'r7-fast-primary r7-plan-primary';
    primary.dataset.r7PlanPrimary = '1';
    form.insertBefore(primary, form.firstElementChild);

    const details = document.createElement('details');
    details.id = 'manual-plan-more-fields';
    details.className = 'r7-fast-details';
    details.innerHTML = '<summary><span>Дополнительно</span><small>диапазон дат, направление, результат, комментарий, соисполнители и контроль</small></summary><div class="r7-fast-details-body"></div>';
    const body = one('.r7-fast-details-body', details);
    const rare = [
      fieldLabel('[name="endsAt"]', form),
      fieldLabel('[name="direction"]', form),
      fieldLabel('[name="expectedResult"]', form),
      fieldLabel('[name="description"]', form),
      one('[data-manual-execution-people]', form)
    ].filter(Boolean);
    rare.forEach((node) => body.append(node));
    form.insertBefore(details, actions);
    form.dataset.r7FastPatched = '1';
  }
  syncPlanPrimary(form);
}

function reconcile() {
  patchEventForm();
  patchPlanItemForm(one('#manual-plan-item-form'));
}

window.addEventListener('click', (event) => {
  const add = event.target?.closest?.('[data-new-on-date]');
  if (!add) return;
  const date = String(add.dataset.newOnDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openFastCalendarEntry(date);
}, true);

document.addEventListener('change', (event) => {
  if (event.target?.matches?.('#event-kind, #event-date')) syncEventSummary();
  if (event.target?.matches?.('#manual-plan-item-form [name="executionMode"]')) {
    const form = event.target.closest('#manual-plan-item-form');
    queueMicrotask(() => syncPlanPrimary(form));
  }
}, true);

new MutationObserver(reconcile).observe(document.documentElement, { childList: true, subtree: true });
ensureStyles();
reconcile();

window.kafedraOpenFastCalendarEntry = openFastCalendarEntry;
