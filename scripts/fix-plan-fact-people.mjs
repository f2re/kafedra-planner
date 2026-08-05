import { readFileSync, writeFileSync } from 'node:fs';

const path = 'public/plan-fact-next.js';
let source = readFileSync(path, 'utf8');

function replaceExact(beforeLines, afterLines, label) {
  const before = beforeLines.join('\n');
  const after = afterLines.join('\n');
  if (!source.includes(before)) throw new Error(`Не найден блок: ${label}`);
  source = source.replace(before, after);
}

replaceExact(
  [
    'function openPlanFactView() {',
    "  pfMany('.nav-item,.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'plan-fact'));",
    "  pfMany('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'plan-fact'));",
    "  pfOne('#page-title').textContent = 'План / факт';",
    "  pfOne('#page-subtitle').textContent = 'Подтверждённые результаты, показатели и риски';",
    "  pfOne('#calendar-mode-switch')?.classList.add('hidden');",
    "  document.body.classList.remove('mobile-sidebar-open');",
    '  loadPlanFact().catch((error) => {',
    '    pfOne(\'#plan-fact-results\').innerHTML = `<div class="empty-state">${pfSafe(error.message)}</div>`;',
    '  });',
    '}'
  ],
  [
    'async function openPlanFactView() {',
    "  pfMany('.nav-item,.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'plan-fact'));",
    "  pfMany('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'plan-fact'));",
    "  pfOne('#page-title').textContent = 'План / факт';",
    "  pfOne('#page-subtitle').textContent = 'Подтверждённые результаты, показатели и риски';",
    "  pfOne('#calendar-mode-switch')?.classList.add('hidden');",
    "  document.body.classList.remove('mobile-sidebar-open');",
    '  try {',
    '    await refreshPeople();',
    '    await loadPlanFact();',
    '  } catch (error) {',
    '    pfOne(\'#plan-fact-results\').innerHTML = `<div class="empty-state">${pfSafe(error.message)}</div>`;',
    '  }',
    '}'
  ],
  'openPlanFactView'
);

replaceExact(
  [
    'async function initializePlanFact() {',
    '  ensurePlanFactUi();',
    "  const people = await pfApi('/api/people');",
    '  pfState.people = people.items || [];',
    '  renderPeople();',
    '  await refreshPersonalNotifications().catch(() => {});',
    '}'
  ],
  [
    'async function refreshPeople() {',
    "  const selectedProfile = pfOne('#current-person-select')?.value || pfState.currentPersonId;",
    "  const selectedFilter = pfOne('#plan-fact-filters select[name=\"personId\"]')?.value || '';",
    "  const people = await pfApi('/api/people');",
    '  pfState.people = people.items || [];',
    '  if (selectedProfile) pfState.currentPersonId = selectedProfile;',
    '  renderPeople();',
    "  const planPerson = pfOne('#plan-fact-filters select[name=\"personId\"]');",
    '  if (planPerson && selectedFilter && pfState.people.some((person) => person.id === selectedFilter)) {',
    '    planPerson.value = selectedFilter;',
    '  }',
    '}',
    '',
    'async function initializePlanFact() {',
    '  ensurePlanFactUi();',
    '  await refreshPeople();',
    '  await refreshPersonalNotifications().catch(() => {});',
    '}'
  ],
  'initializePlanFact'
);

replaceExact(
  ['  if (view) { event.preventDefault(); event.stopPropagation(); openPlanFactView(); }'],
  ['  if (view) { event.preventDefault(); event.stopPropagation(); openPlanFactView().catch(() => {}); }'],
  'click handler'
);

writeFileSync(path, source);
