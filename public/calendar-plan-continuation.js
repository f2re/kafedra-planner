import { calendarContextDate, calendarPlanContinuation } from './calendar-plan-flow.js';

const flowState = {
  active: false,
  date: '',
  choices: [],
  advancing: false,
  awaitingCreatedPlan: false,
  addTriggered: false
};

const one = (selector, root = document) => root.querySelector(selector);

function rememberDate(value) {
  flowState.date = calendarContextDate(value);
  window.dispatchEvent(new CustomEvent('kafedra:calendar-context-date', { detail: { date: flowState.date } }));
}

function resetFlow() {
  flowState.active = false;
  flowState.choices = [];
  flowState.advancing = false;
  flowState.awaitingCreatedPlan = false;
  flowState.addTriggered = false;
}

function markDomainDate(input) {
  if (!input || !flowState.date) return;
  input.value = flowState.date;
  input.dataset.uiPreferenceExplicitDate = '1';
  window.kafedraPreferenceOrigin?.mark?.(input, 'domain');
}

function planChoices(select) {
  return [...(select?.options || [])]
    .filter((option) => option.value)
    .map((option) => ({ id: option.value, label: option.textContent?.trim() || option.value }));
}

function addPlanChoiceToItemForm(form) {
  if (flowState.choices.length < 2 || one('[data-r7-plan-choice]', form)) return;
  const label = document.createElement('label');
  label.className = 'field r7-plan-choice';
  label.dataset.r7PlanChoice = '1';
  label.innerHTML = `<span>План</span><select name="planId" aria-label="План для мероприятия">${flowState.choices
    .map((plan) => `<option value="${String(plan.id).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${String(plan.label).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</option>`)
    .join('')}</select>`;
  form.insertBefore(label, form.firstElementChild);
  const select = one('select[name="planId"]', label);
  if (flowState.choices.some((plan) => plan.id === form.dataset.planId)) select.value = form.dataset.planId;
}

function prepareItemForm(form) {
  if (!flowState.active || !form) return;
  form.dataset.calendarContextDate = flowState.date;
  markDomainDate(one('[name="startsAt"]', form));
  addPlanChoiceToItemForm(form);
  const modal = one('#manual-plan-modal');
  if (modal) modal.style.visibility = '';
  flowState.advancing = false;
  flowState.awaitingCreatedPlan = false;
}

function continueIntermediate() {
  if (!flowState.active || flowState.advancing) return false;
  const select = one('#manual-calendar-plan-select');
  const next = one('[data-manual-calendar-plan-next]');
  if (!select || !next) return false;
  const continuation = calendarPlanContinuation(planChoices(select));
  if (continuation.mode === 'create') return false;
  flowState.choices = continuation.plans.map((plan) => ({
    id: plan.id,
    label: [...select.options].find((option) => option.value === plan.id)?.textContent?.trim() || plan.id
  }));
  next.dataset.date = flowState.date;
  if (continuation.planId) select.value = continuation.planId;
  flowState.advancing = true;
  const modal = one('#manual-plan-modal');
  if (modal) modal.style.visibility = 'hidden';
  queueMicrotask(() => next.click());
  return true;
}

function preparePlanCreate(form) {
  if (!flowState.active || !form || form.dataset.r7CalendarContinuation === '1') return;
  form.dataset.r7CalendarContinuation = '1';
  form.dataset.calendarContextDate = flowState.date;
  flowState.awaitingCreatedPlan = true;
  const helper = one('.manual-helper', form);
  if (helper) helper.textContent = 'После создания плана сразу откроется исходное действие из календаря. Дату повторять не нужно.';
}

function continueAfterPlanCreated() {
  if (!flowState.active || !flowState.awaitingCreatedPlan || flowState.addTriggered) return;
  const modal = one('#manual-plan-modal');
  if (modal && !modal.classList.contains('hidden')) return;
  const add = [...document.querySelectorAll('[data-manual-add-item]')]
    .find((button) => button.getClientRects().length && !button.disabled);
  if (!add) return;
  flowState.addTriggered = true;
  add.click();
}

function reconcile() {
  if (!flowState.active) return;
  if (continueIntermediate()) return;
  const createForm = one('#manual-plan-create-form');
  if (createForm) preparePlanCreate(createForm);
  const itemForm = one('#manual-plan-item-form');
  if (itemForm) prepareItemForm(itemForm);
  else continueAfterPlanCreated();
}

window.addEventListener('click', (event) => {
  const dated = event.target?.closest?.('[data-calendar-date], [data-new-on-date]');
  if (dated) rememberDate(dated.dataset.newOnDate || dated.dataset.calendarDate);
  const start = event.target?.closest?.('[data-manual-calendar-add]');
  if (start) {
    flowState.active = true;
    flowState.choices = [];
    flowState.advancing = false;
    flowState.awaitingCreatedPlan = false;
    flowState.addTriggered = false;
    if (!flowState.date) rememberDate('');
  }
  if (flowState.active && event.target?.closest?.('[data-manual-close]')) resetFlow();
}, true);

window.addEventListener('kafedra:calendar-context-date', (event) => {
  const date = String(event.detail?.date || '');
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) flowState.date = date;
});

document.addEventListener('submit', (event) => {
  const itemForm = event.target.closest?.('#manual-plan-item-form');
  if (itemForm && flowState.active) {
    const planId = one('[name="planId"]', itemForm)?.value;
    if (planId) itemForm.dataset.planId = planId;
    queueMicrotask(resetFlow);
  }
  const createForm = event.target.closest?.('#manual-plan-create-form[data-r7-calendar-continuation="1"]');
  if (createForm) flowState.awaitingCreatedPlan = true;
}, true);

new MutationObserver(reconcile).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
reconcile();

window.kafedraCalendarPlanContinuation = {
  get date() { return flowState.date; },
  setDate: rememberDate
};
