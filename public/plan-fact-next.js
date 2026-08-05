const pfBaseFetch = window.fetch.bind(window);
const pfState = {
  people: [],
  data: { items: [], summary: {} },
  currentPersonId: localStorage.getItem('kafedra-current-person-id') || '',
  rebuilt: false,
  timer: null
};
const pfOne = (selector, root = document) => root.querySelector(selector);
const pfMany = (selector, root = document) => [...root.querySelectorAll(selector)];
const pfSafe = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function requestWithUrl(input, url) {
  if (input instanceof Request) return new Request(url.toString(), input);
  return `${url.pathname}${url.search}${url.hash}`;
}

window.fetch = async function personalFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  const personId = localStorage.getItem('kafedra-current-person-id') || '';
  if (url.origin === window.location.origin && personId && method === 'GET' && url.pathname === '/api/notifications') {
    url.pathname = '/api/personal-notifications';
    url.searchParams.set('personId', personId);
    return pfBaseFetch(requestWithUrl(input, url), init);
  }
  if (url.origin === window.location.origin && personId && method === 'POST' && url.pathname === '/api/notifications/state') {
    let body = {};
    try { body = JSON.parse(String(init.body || '{}')); } catch {}
    url.pathname = '/api/personal-notifications/state';
    return pfBaseFetch(requestWithUrl(input, url), {
      ...init,
      body: JSON.stringify({ ...body, personId })
    });
  }
  return pfBaseFetch(input, init);
};

async function pfApi(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensurePlanFactUi() {
  if (!pfOne('[data-view="plan-fact"]')) {
    pfOne('#navigation')?.insertAdjacentHTML('beforeend', '<button class="nav-item" data-view="plan-fact"><span class="nav-icon" aria-hidden="true">◫</span><span>План / факт</span></button>');
    pfOne('.mobile-tabs')?.insertAdjacentHTML('beforeend', '<button class="mobile-tab" data-view="plan-fact"><span>◫</span>План / факт</button>');
  }
  if (!pfOne('[data-view-panel="plan-fact"]')) {
    pfOne('.workspace')?.insertAdjacentHTML('beforeend', `<section class="view" data-view-panel="plan-fact">
      <div class="section-heading"><div><h2>План / факт</h2><p>Обязательства сотрудников, фактические показатели из отчётов и риски сроков.</p></div><button id="plan-fact-rebuild" class="secondary-button" type="button">Пересчитать</button></div>
      <form id="plan-fact-filters" class="plan-fact-toolbar">
        <select name="scope" aria-label="Режим выборки"><option value="department">Вся кафедра</option><option value="owner">Задачи сотрудника</option><option value="manager">Контроль руководителя</option></select>
        <select name="personId" aria-label="Сотрудник"></select>
        <input name="from" type="date" aria-label="Период с">
        <input name="to" type="date" aria-label="Период по">
        <select name="direction"><option value="">Все направления</option><option value="science">Наука</option><option value="education">Образование</option><option value="organizational">Организация</option><option value="personnel">Кадры</option><option value="safety">Безопасность</option><option value="finance">Финансы</option><option value="digital">Цифровизация</option></select>
        <select name="status"><option value="">Все состояния</option><option value="open">Открыто</option><option value="submitted">На проверке</option><option value="rework">Доработка</option><option value="completed">Выполнено</option></select>
        <select name="periodKind"><option value="">Все периоды</option><option value="semester">Семестр</option><option value="academic_year">Учебный год</option><option value="calendar_year">Календарный год</option><option value="quarter">Квартал</option></select>
        <input name="periodKey" placeholder="2026-1 или 2026/27">
      </form>
      <div id="plan-fact-summary" class="plan-fact-summary"></div>
      <div id="plan-fact-results" class="plan-fact-list"></div>
    </section>`);
  }
  if (!pfOne('#current-person-select')) {
    pfOne('.topbar-actions')?.insertAdjacentHTML('afterbegin', `<label class="current-person-control" title="Персональная выборка и уведомления"><span>Профиль</span><select id="current-person-select" aria-label="Текущий сотрудник"></select></label>`);
  }
  if (!pfOne('#plan-fact-styles')) {
    const link = document.createElement('link');
    link.id = 'plan-fact-styles'; link.rel = 'stylesheet'; link.href = '/plan-fact-next.css';
    document.head.append(link);
  }
}

function personOptions(includeDepartment = true) {
  return [
    ...(includeDepartment ? ['<option value="">Вся кафедра</option>'] : []),
    ...pfState.people.map((person) => `<option value="${pfSafe(person.id)}">${pfSafe(person.display_name)}</option>`)
  ].join('');
}

function renderPeople() {
  const profile = pfOne('#current-person-select');
  if (profile) {
    profile.innerHTML = personOptions(true);
    profile.value = pfState.people.some((person) => person.id === pfState.currentPersonId) ? pfState.currentPersonId : '';
  }
  const planPerson = pfOne('#plan-fact-filters select[name="personId"]');
  if (planPerson) {
    planPerson.innerHTML = personOptions(true);
    planPerson.value = profile?.value || '';
  }
  const scope = pfOne('#plan-fact-filters select[name="scope"]');
  if (scope && !planPerson?.value) scope.value = 'department';
  else if (scope && planPerson?.value && scope.value === 'department') scope.value = 'owner';
}

function riskLabel(item) {
  return item.risk?.label || 'Без оценки';
}

function statusLabel(value) {
  return ({ open: 'Открыто', submitted: 'На проверке', rework: 'Доработка', completed: 'Выполнено', cancelled: 'Отменено' })[value] || value || '';
}

function metricLine(metric) {
  const target = metric.targetNumeric ?? metric.targetText ?? '—';
  const actual = metric.actualNumeric ?? metric.actualText ?? '—';
  const unit = metric.unit ? ` ${metric.unit}` : '';
  const attainment = metric.attainmentPercent === null ? '' : `<span class="metric-attainment ${pfSafe(metric.status)}">${metric.attainmentPercent}%</span>`;
  return `<tr><th>${pfSafe(metric.name)}</th><td>${pfSafe(target)}${target === '—' ? '' : pfSafe(unit)}</td><td>${pfSafe(actual)}${actual === '—' ? '' : pfSafe(unit)}</td><td>${attainment || '—'}</td></tr>`;
}

function renderPlanFact(data) {
  const summary = data.summary || {};
  pfOne('#plan-fact-summary').innerHTML = `
    <article><span>Обязательств</span><strong>${summary.total || 0}</strong></article>
    <article><span>Выполнено</span><strong>${summary.completed || 0}</strong></article>
    <article class="risk"><span>Требует внимания</span><strong>${summary.atRisk || 0}</strong></article>
    <article><span>Средний прогресс</span><strong>${summary.averageProgress || 0}%</strong></article>`;
  pfOne('#plan-fact-results').innerHTML = data.items?.length ? data.items.map((item) => {
    const owner = item.owners?.map((person) => person.display_name || person.executor_raw).filter(Boolean).join(', ') || 'не назначен';
    const measured = item.summary?.measured || 0;
    const planned = item.summary?.planned || 0;
    return `<button class="plan-fact-card ${pfSafe(item.risk?.severity || '')}" type="button" data-plan-fact-kind="${pfSafe(item.sourceKind)}" data-plan-fact-id="${pfSafe(item.id)}">
      <div class="plan-fact-main"><div class="plan-fact-card-head"><span class="plan-fact-kind">${item.sourceKind === 'periodic_task' ? 'периодическая задача' : 'поручение'}</span><span class="plan-fact-risk">${pfSafe(riskLabel(item))}</span></div><strong>${pfSafe(item.title)}</strong><p>${pfSafe(owner)}${item.documentNumber ? ` · № ${pfSafe(item.documentNumber)}` : ''}${item.periodKey ? ` · ${pfSafe(item.periodKey)}` : ''}</p><small>Показатели: ${measured}/${planned} · ${pfSafe(statusLabel(item.status))}</small></div>
      <div class="plan-fact-progress"><strong>${Number(item.progressPercent || 0)}%</strong><span>${pfSafe(item.dueDate || 'без срока')}</span><i style="--progress:${Math.max(0, Math.min(100, Number(item.progressPercent || 0)))}%"></i></div>
    </button>`;
  }).join('') : '<div class="empty-state">По выбранным условиям обязательств не найдено.</div>';
}

function currentFilters() {
  const form = pfOne('#plan-fact-filters');
  const values = Object.fromEntries(new FormData(form));
  const personId = values.personId || '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (!value || ['scope', 'personId'].includes(key)) continue;
    params.set(key, value);
  }
  if (personId && values.scope === 'owner') params.set('ownerPersonId', personId);
  if (personId && values.scope === 'manager') params.set('managerPersonId', personId);
  return params;
}

async function loadPlanFact({ rebuild = false } = {}) {
  if (rebuild || !pfState.rebuilt) {
    await pfApi('/api/plan-fact/rebuild', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    pfState.rebuilt = true;
  }
  const data = await pfApi(`/api/plan-fact?${currentFilters()}`);
  pfState.data = data;
  renderPlanFact(data);
}

function openPlanFactView() {
  pfMany('.nav-item,.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'plan-fact'));
  pfMany('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'plan-fact'));
  pfOne('#page-title').textContent = 'План / факт';
  pfOne('#page-subtitle').textContent = 'Подтверждённые результаты, показатели и риски';
  pfOne('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  loadPlanFact().catch((error) => {
    pfOne('#plan-fact-results').innerHTML = `<div class="empty-state">${pfSafe(error.message)}</div>`;
  });
}

function outcomeHtml(outcome) {
  if (!outcome) return '<div class="empty-state">Отчёт с фактическими показателями ещё не связан.</div>';
  return `<div class="plan-fact-outcome"><div><span>Результат</span><strong>${pfSafe(outcome.result_state)}</strong></div><div><span>Проверка</span><strong>${pfSafe(outcome.review_status)}</strong></div><p>${pfSafe(outcome.summary || 'Краткий итог не извлечён.')}</p>${outcome.report_document_id ? `<button class="secondary-button" type="button" data-inspector-document="${pfSafe(outcome.report_document_id)}">Открыть отчёт</button>` : ''}</div>`;
}

async function showPlanFact(id) {
  const item = await pfApi(`/api/assignments/${encodeURIComponent(id)}/plan-fact`);
  const inspector = pfOne('#ux-inspector');
  const body = pfOne('#ux-inspector-body');
  if (!inspector || !body) return;
  const owners = item.owners.map((person) => person.display_name || person.executor_raw).filter(Boolean).join(', ') || 'не назначен';
  body.innerHTML = `<section class="inspector-section plan-fact-inspector">
    <div class="eyebrow">План / факт</div><h2>${pfSafe(item.title)}</h2>
    <div class="plan-fact-inspector-summary"><div><span>Прогресс</span><strong>${item.progressPercent}%</strong></div><div><span>Срок</span><strong>${pfSafe(item.dueDate || 'не задан')}</strong></div><div><span>Риск</span><strong>${pfSafe(riskLabel(item))}</strong></div></div>
    <p>${pfSafe(owners)}${item.expectedResult ? ` · ${pfSafe(item.expectedResult)}` : ''}</p>
    ${outcomeHtml(item.currentOutcome)}
    <h3>Показатели</h3>
    ${item.metrics.length ? `<div class="plan-fact-table-wrap"><table class="plan-fact-table"><thead><tr><th>Показатель</th><th>План</th><th>Факт</th><th>Исполнение</th></tr></thead><tbody>${item.metrics.map(metricLine).join('')}</tbody></table></div>` : '<div class="empty-state">Явные числовые показатели не найдены. Текстовый результат и статус всё равно сохранены.</div>'}
    ${item.sourceDocumentId ? `<button class="text-button" type="button" data-inspector-document="${pfSafe(item.sourceDocumentId)}">Открыть основание</button>` : ''}
  </section>`;
  inspector.classList.remove('hidden');
  pfOne('#sheet-backdrop')?.classList.remove('hidden');
}

async function refreshPersonalNotifications() {
  const personId = localStorage.getItem('kafedra-current-person-id') || '';
  if (!personId) return;
  const data = await pfApi(`/api/personal-notifications?personId=${encodeURIComponent(personId)}&limit=100`);
  const badge = pfOne('#notification-badge');
  if (badge) {
    badge.textContent = data.unread;
    badge.classList.toggle('hidden', data.unread === 0);
  }
  const list = pfOne('#notification-list');
  if (!list) return;
  list.innerHTML = data.items.length ? data.items.map((item) => `<article class="notification-item ${item.read ? 'read' : ''}"><span class="notification-dot"></span><div><strong>${pfSafe(item.title)}</strong><p>${pfSafe(item.body)}</p><time>${pfSafe(String(item.notifyAt || '').slice(0, 10))}</time></div><div class="notification-actions">${!item.read ? `<button type="button" data-notification-action="read" data-notification-key="${pfSafe(item.key)}" aria-label="Прочитано">✓</button>` : ''}<button type="button" data-notification-action="dismiss" data-notification-key="${pfSafe(item.key)}" aria-label="Скрыть">×</button></div></article>`).join('') : '<div class="empty-state">Новых уведомлений нет.</div>';
}

async function initializePlanFact() {
  ensurePlanFactUi();
  const people = await pfApi('/api/people');
  pfState.people = people.items || [];
  renderPeople();
  await refreshPersonalNotifications().catch(() => {});
}

document.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view="plan-fact"]');
  if (view) { event.preventDefault(); event.stopPropagation(); openPlanFactView(); }
  const card = event.target.closest('[data-plan-fact-id]');
  if (card && card.dataset.planFactKind === 'assignment') showPlanFact(card.dataset.planFactId).catch(() => {});
  if (event.target.closest('#plan-fact-rebuild')) loadPlanFact({ rebuild: true }).catch(() => {});
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'current-person-select') {
    pfState.currentPersonId = event.target.value;
    localStorage.setItem('kafedra-current-person-id', pfState.currentPersonId);
    const planPerson = pfOne('#plan-fact-filters select[name="personId"]');
    const scope = pfOne('#plan-fact-filters select[name="scope"]');
    if (planPerson) planPerson.value = pfState.currentPersonId;
    if (scope) scope.value = pfState.currentPersonId ? 'owner' : 'department';
    refreshPersonalNotifications().catch(() => {});
    if (pfOne('[data-view-panel="plan-fact"]')?.classList.contains('active')) loadPlanFact().catch(() => {});
  }
  if (event.target.closest('#plan-fact-filters')) loadPlanFact().catch(() => {});
});

document.addEventListener('input', (event) => {
  if (!event.target.closest('#plan-fact-filters')) return;
  clearTimeout(pfState.timer);
  pfState.timer = setTimeout(() => loadPlanFact().catch(() => {}), 250);
});

initializePlanFact().catch(() => {});
