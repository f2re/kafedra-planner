const $wa = (selector, root = document) => root.querySelector(selector);
const $$wa = (selector, root = document) => [...root.querySelectorAll(selector)];

const workAutomationState = {
  assignments: null,
  assignmentsLoadedAt: 0,
  plans: new Map(),
  timer: null,
  running: false
};

function ensureWorkAutomationStyles() {
  if ($wa('#work-automation-next-styles')) return;
  const style = document.createElement('style');
  style.id = 'work-automation-next-styles';
  style.textContent = `
    .work-periodic-form.work-smart-collapsed{display:none!important}
    .work-create-periodic{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-left:auto}
    .work-create-periodic .primary-button{white-space:nowrap}
    .work-origin-plan{font-weight:700}
    .auto-assignment-status{display:inline-flex;margin-top:5px;padding:2px 7px;border-radius:999px;background:var(--surface-subtle,#eef4fb);font-size:11px;font-weight:700;line-height:1.4}
    .auto-assignment-status.needs-review{font-weight:600}
    @media(max-width:720px){
      .work-create-periodic{width:100%;justify-content:stretch}
      .work-create-periodic .primary-button{width:100%}
    }
  `;
  document.head.append(style);
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function enhancePeriodicForm() {
  const panel = $wa('[data-view-panel="work"]');
  const form = $wa('#periodic-task-form', panel || document);
  if (!panel || !form) return;

  let launcher = $wa('.work-create-periodic', panel);
  if (!launcher) {
    launcher = document.createElement('div');
    launcher.className = 'work-create-periodic';
    launcher.innerHTML = '<button id="work-create-periodic" class="primary-button" type="button" aria-expanded="false">Создать периодическую задачу</button>';
    const heading = $wa('.section-heading', panel);
    if (heading) heading.append(launcher);
    else form.before(launcher);
    form.classList.add('work-smart-collapsed');
  }

  const managerEmpty = $wa('select[name="managerPersonId"] option[value=""]', form);
  if (managerEmpty && managerEmpty.textContent !== 'Определить по структуре') {
    managerEmpty.textContent = 'Определить по структуре';
  }
}

function enhanceControllerLabels() {
  $$wa('#plan-source-form select[name="controllerPersonId"] option[value=""]').forEach((option) => {
    if (option.textContent !== 'Определить по структуре') option.textContent = 'Определить по структуре';
  });
}

async function assignmentMap() {
  const now = Date.now();
  if (workAutomationState.assignments && now - workAutomationState.assignmentsLoadedAt < 1500) {
    return workAutomationState.assignments;
  }
  const payload = await json('/api/assignments?limit=2000');
  if (!payload) return workAutomationState.assignments || new Map();
  workAutomationState.assignments = new Map((payload.items || []).map((item) => [item.id, item]));
  workAutomationState.assignmentsLoadedAt = now;
  return workAutomationState.assignments;
}

async function tagWorkOrigins() {
  const cards = $$wa('.work-card[data-work-kind="assignment"]');
  if (!cards.length) return;
  const assignments = await assignmentMap();
  for (const card of cards) {
    const assignment = assignments.get(card.dataset.workId);
    if (!assignment) continue;
    const fromPlan = assignment.evidence?.source === 'plan_item' || (!assignment.directive_id && assignment.evidence?.planItemId);
    if (!fromPlan) continue;
    card.dataset.workOrigin = 'plan';
    const pill = $wa('.work-pill', card);
    if (pill && pill.textContent !== 'поручение из плана') {
      pill.textContent = 'поручение из плана';
      pill.classList.add('work-origin-plan');
    }
  }
}

async function currentPlan() {
  const active = $wa('.plan-card.active[data-plan-id]');
  const planId = active?.dataset.planId;
  if (!planId) return null;
  const cached = workAutomationState.plans.get(planId);
  if (cached && Date.now() - cached.loadedAt < 1200) return cached.value;
  const value = await json(`/api/plans/${encodeURIComponent(planId)}`);
  if (value) workAutomationState.plans.set(planId, { value, loadedAt: Date.now() });
  return value;
}

async function tagPlanResponsibility() {
  const rows = $$wa('[data-plan-item-row]');
  if (!rows.length) return;
  const plan = await currentPlan();
  if (!plan) return;
  const items = new Map((plan.items || []).map((item) => [item.id, item]));
  for (const row of rows) {
    const item = items.get(row.dataset.planItemRow);
    if (!item) continue;
    const cell = row.children?.[3];
    if (!cell) continue;
    let badge = $wa('[data-auto-assignment-status]', cell);
    const state = item.assignment
      ? { text: 'Назначен', className: '' }
      : item.responsible_person_id
        ? { text: 'Предлагается назначить', className: '' }
        : item.responsible_raw
          ? { text: 'Нужно уточнить сотрудника', className: 'needs-review' }
          : null;
    if (!state) {
      badge?.remove();
      continue;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.autoAssignmentStatus = '1';
      badge.className = 'auto-assignment-status';
      cell.append(document.createElement('br'), badge);
    }
    badge.textContent = state.text;
    badge.classList.toggle('needs-review', Boolean(state.className));
  }
}

async function enhance() {
  if (workAutomationState.running) return;
  workAutomationState.running = true;
  try {
    ensureWorkAutomationStyles();
    enhancePeriodicForm();
    enhanceControllerLabels();
    await Promise.allSettled([tagWorkOrigins(), tagPlanResponsibility()]);
  } finally {
    workAutomationState.running = false;
  }
}

function scheduleEnhance() {
  clearTimeout(workAutomationState.timer);
  workAutomationState.timer = setTimeout(() => enhance().catch(() => {}), 40);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('#work-create-periodic');
  if (!button) return;
  const form = $wa('#periodic-task-form');
  if (!form) return;
  const opening = form.classList.contains('work-smart-collapsed');
  form.classList.toggle('work-smart-collapsed', !opening);
  button.setAttribute('aria-expanded', String(opening));
  button.textContent = opening ? 'Скрыть форму' : 'Создать периодическую задачу';
  if (opening) $wa('input[name="title"]', form)?.focus();
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'periodic-task-form') return;
  workAutomationState.assignmentsLoadedAt = 0;
  setTimeout(scheduleEnhance, 100);
}, true);

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.body, { childList: true, subtree: true });
scheduleEnhance();
