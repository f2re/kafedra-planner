const workState = { filters: {}, data: null, documents: [], people: [] };
const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

async function workApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureWorkUi() {
  if (!q('[data-view="work"]')) {
    q('#navigation')?.insertAdjacentHTML('beforeend', '<button class="nav-item" data-view="work"><span class="nav-icon" aria-hidden="true">→</span><span>Поручения</span></button>');
    q('.mobile-tabs')?.insertAdjacentHTML('beforeend', '<button class="mobile-tab" data-view="work"><span>→</span>Поручения</button>');
  }
  if (!q('[data-view-panel="work"]')) {
    q('.workspace')?.insertAdjacentHTML('beforeend', `<section class="view" data-view-panel="work">
      <div class="section-heading"><div><h2>Поручения и основания</h2><p>Распоряжения, исполнители, сроки, отчёты и семестровые задачи в одном месте.</p></div></div>
      <form id="work-search-form" class="work-toolbar">
        <input name="q" type="search" placeholder="Номер, тема, текст…">
        <input name="from" type="date" aria-label="Дата с">
        <input name="to" type="date" aria-label="Дата по">
        <select name="direction"><option value="">Все направления</option><option value="science">Наука</option><option value="education">Образование</option><option value="organizational">Организация</option><option value="personnel">Кадры</option><option value="safety">Безопасность</option><option value="finance">Финансы</option><option value="digital">Цифровизация</option></select>
        <input name="executor" placeholder="Исполнитель">
        <select name="status"><option value="">Все состояния</option><option value="open">Открыто</option><option value="submitted">Отчёт представлен</option><option value="completed">Выполнено</option><option value="cancelled">Отменено</option></select>
      </form>
      <div id="work-summary" class="work-summary"></div>
      <div id="work-results" class="work-list"></div>
      <form id="periodic-task-form" class="work-periodic-form">
        <h3 class="full">Новая семестровая или годовая задача</h3>
        <label class="field full"><span>Название</span><input name="title" required></label>
        <label class="field"><span>Сотрудник</span><select name="ownerPersonId"></select></label>
        <label class="field"><span>Руководитель</span><select name="managerPersonId"></select></label>
        <label class="field"><span>Период</span><select name="periodKind"><option value="semester">Семестр</option><option value="academic_year">Учебный год</option><option value="calendar_year">Календарный год</option><option value="quarter">Квартал</option></select></label>
        <label class="field"><span>Обозначение периода</span><input name="periodKey" required placeholder="2026-1 или 2026/27"></label>
        <label class="field"><span>Срок</span><input name="dueDate" type="date" required></label>
        <label class="field"><span>Направление</span><select name="direction"><option value="organizational">Организация</option><option value="education">Образование</option><option value="science">Наука</option></select></label>
        <label class="field full"><span>Ожидаемый результат</span><textarea name="expectedResult" rows="2"></textarea></label>
        <div class="full"><button class="primary-button" type="submit">Создать задачу</button></div>
      </form>
    </section>`);
  }
  if (!q('#work-next-styles')) {
    const link = document.createElement('link'); link.id='work-next-styles'; link.rel='stylesheet'; link.href='/work-next.css'; document.head.append(link);
  }
}

function openWorkView() {
  qa('.nav-item,.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'work'));
  qa('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'work'));
  q('#page-title').textContent = 'Поручения';
  q('#page-subtitle').textContent = 'Основания, исполнители, сроки, отчёты и задачи сотрудников';
  q('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  loadWork();
}

function renderPeopleOptions() {
  const options = ['<option value="">Не назначен</option>', ...workState.people.map((person) => `<option value="${esc(person.id)}">${esc(person.display_name)}</option>`)].join('');
  qa('#periodic-task-form select[name="ownerPersonId"],#periodic-task-form select[name="managerPersonId"]').forEach((select) => { select.innerHTML = options; });
}

function renderWork(data) {
  q('#work-summary').innerHTML = `<span>Документы: ${data.items.filter((i)=>i.sourceKind==='directive').length}</span><span>Поручения: ${data.items.filter((i)=>i.sourceKind==='assignment').length}</span><span>Открыто: ${data.items.filter((i)=>!['completed','cancelled'].includes(i.status)).length}</span>`;
  q('#work-results').innerHTML = data.items.length ? data.items.map((item) => `<button type="button" class="work-card" data-work-kind="${esc(item.sourceKind)}" data-work-id="${esc(item.id)}">
    <div><strong>${esc(item.title)}</strong><div class="work-card-meta"><span class="work-pill">${esc(item.sourceKind === 'directive' ? item.subtype : 'поручение')}</span>${item.documentNumber ? `<span>№ ${esc(item.documentNumber)}</span>` : ''}${item.direction ? `<span>${esc(item.direction)}</span>` : ''}${item.executor ? `<span>${esc(item.executor)}</span>` : ''}</div></div>
    <div class="work-card-side"><time>${esc(item.eventDate || 'Без даты')}</time><span>${esc(item.status || '')}</span></div>
  </button>`).join('') : '<div class="empty-state">По выбранным условиям ничего не найдено.</div>';
}

async function loadWork() {
  const form = q('#work-search-form');
  const params = new URLSearchParams(new FormData(form));
  [...params].forEach(([key,value]) => { if (!value) params.delete(key); });
  const [data, people, documents] = await Promise.all([
    workApi(`/api/work/search?${params}`), workApi('/api/people'), workApi('/api/documents?limit=500')
  ]);
  workState.data = data; workState.people = people.items; workState.documents = documents.items;
  renderPeopleOptions(); renderWork(data);
}

function currentPersonId() {
  return window.kafedraAuthContext?.user?.person?.id || '';
}

function canControlResponsibility(responsibility) {
  const auth = window.kafedraAuthContext;
  if (!auth?.authEnabled) return true;
  if (['manager', 'admin'].includes(auth.role)) return true;
  return Boolean(currentPersonId() && responsibility?.controller?.person_id === currentPersonId());
}

function personSelect(name, selectedId, emptyLabel) {
  return `<select name="${esc(name)}"><option value="">${esc(emptyLabel)}</option>${workState.people.map((person) =>
    `<option value="${esc(person.id)}"${person.id === selectedId ? ' selected' : ''}>${esc(person.display_name)}</option>`
  ).join('')}</select>`;
}

function peopleChecks(name, selectedIds) {
  const selected = new Set(selectedIds || []);
  return `<div class="work-people-checks">${workState.people.map((person) => `<label><input type="checkbox" name="${esc(name)}" value="${esc(person.id)}"${selected.has(person.id) ? ' checked' : ''}><span>${esc(person.display_name)}</span></label>`).join('')}</div>`;
}

function roleNames(responsibility) {
  const primary = responsibility?.executor?.display_name || responsibility?.executor?.executor_raw || 'не назначен';
  const co = (responsibility?.coexecutors || []).map((item) => item.display_name || item.executor_raw).join(', ');
  const controller = responsibility?.controller?.display_name || responsibility?.controller?.executor_raw || 'не назначен';
  const observers = (responsibility?.observers || []).map((item) => item.display_name || item.executor_raw).join(', ');
  return { primary, co, controller, observers };
}

function responsibilityHistoryHtml(history) {
  if (!history?.length) return '<div class="work-history-empty">Изменений ответственности ещё не было.</div>';
  return `<ol class="work-history">${history.map((item) => `<li><strong>${esc(item.reason || 'Изменение ответственности')}</strong><span>${esc(String(item.createdAt || '').replace('T',' ').replace('Z',' UTC'))}</span></li>`).join('')}</ol>`;
}

function responsibilityEditor(a, responsibility) {
  if (!responsibility) return '';
  const names = roleNames(responsibility);
  const summary = `<div class="work-responsibility-summary"><span><b>Поручил:</b> ${esc(responsibility.delegatorRaw || 'не указан в основании')}</span><span><b>Ответственный:</b> ${esc(names.primary)}</span>${names.co ? `<span><b>Соисполнители:</b> ${esc(names.co)}</span>` : ''}<span><b>Контроль:</b> ${esc(names.controller)}</span>${names.observers ? `<span><b>Наблюдатели:</b> ${esc(names.observers)}</span>` : ''}</div>`;
  if (!canControlResponsibility(responsibility)) {
    return `<details class="work-responsibility"><summary>Ответственность</summary>${summary}${responsibilityHistoryHtml(responsibility.history)}</details>`;
  }
  return `<details class="work-responsibility"><summary>Ответственность и история</summary>${summary}
    <form data-responsibility-form>
      <div class="work-responsibility-grid">
        <label class="field"><span>Основной исполнитель</span>${personSelect('executorPersonId', responsibility.executor?.person_id || '', 'Не назначен')}</label>
        <label class="field"><span>Контролирующий</span>${personSelect('controllerPersonId', responsibility.controller?.person_id || '', 'Не назначен')}</label>
        <fieldset><legend>Соисполнители</legend>${peopleChecks('coexecutorPersonIds', (responsibility.coexecutors || []).map((item) => item.person_id))}</fieldset>
        <fieldset><legend>Наблюдатели</legend>${peopleChecks('observerPersonIds', (responsibility.observers || []).map((item) => item.person_id))}</fieldset>
        <label class="field full"><span>Причина изменения</span><input name="reason" required minlength="3" placeholder="Например: перераспределение нагрузки"></label>
      </div>
      <div class="work-responsibility-actions"><button class="secondary-button" type="submit">Сохранить ответственность</button><span data-responsibility-error role="alert"></span></div>
    </form>${responsibilityHistoryHtml(responsibility.history)}</details>`;
}

async function showDirective(id) {
  const item = await workApi(`/api/directives/${encodeURIComponent(id)}`);
  const responsibilityPairs = await Promise.all((item.assignments || []).map(async (assignment) => {
    try {
      return [assignment.id, await workApi(`/api/assignments/${encodeURIComponent(assignment.id)}/responsibility`)];
    } catch {
      return [assignment.id, null];
    }
  }));
  const responsibilities = Object.fromEntries(responsibilityPairs);
  const inspector = q('#ux-inspector'); const body = q('#ux-inspector-body');
  if (!inspector || !body) return;
  body.innerHTML = `<div class="work-inspector-grid"><section class="inspector-section"><div class="eyebrow">${esc(item.directive_kind)}</div><h2>${esc(item.title)}</h2><p>№ ${esc(item.document_number || 'не указан')} · ${esc(item.issued_at || 'дата не указана')}</p><p>${esc(item.issuer_raw || '')}</p><button class="secondary-button" type="button" data-inspector-document="${esc(item.source_document_id)}">Открыть оригинал</button></section>
  <section class="inspector-section"><h3>Поручения</h3>${item.assignments.map((a)=>assignmentHtml(a, responsibilities[a.id])).join('') || '<div class="empty-state">Поручений не найдено.</div>'}</section></div>`;
  inspector.classList.remove('hidden'); q('#sheet-backdrop')?.classList.remove('hidden');
}

function assignmentHtml(a, responsibility) {
  const names = roleNames(responsibility || {
    executor: a.executors.find((item) => item.role === 'executor'),
    coexecutors: a.executors.filter((item) => item.role === 'coexecutor'),
    controller: a.executors.find((item) => item.role === 'controller'),
    observers: a.executors.filter((item) => item.role === 'observer')
  });
  const docs = ['<option value="">Выберите отчётный документ</option>', ...workState.documents.map((d)=>`<option value="${esc(d.id)}">${esc(d.title)}</option>`)].join('');
  return `<article class="work-assignment" data-assignment-id="${esc(a.id)}" data-directive-id="${esc(a.directive_id || '')}"><header><strong>${esc(a.title)}</strong><span>${esc(a.due_date || 'без срока')}</span></header><div class="work-executors">Ответственный: ${esc(names.primary)}${names.co ? ` · соисполнители: ${esc(names.co)}` : ''} · состояние: ${esc(a.status)}</div><p>${esc(a.instruction_text)}</p>${responsibilityEditor(a, responsibility)}<form class="work-report-form" data-report-form><select name="documentId">${docs}</select><button class="secondary-button" type="submit">Приложить отчёт</button></form></article>`;
}

async function showAssignment(id) {
  const { items } = await workApi(`/api/assignments?limit=1000`);
  const item = items.find((entry)=>entry.id===id);
  if (item?.directive_id) return showDirective(item.directive_id);
}

document.addEventListener('click', (event) => {
  const workButton = event.target.closest('[data-view="work"]');
  if (workButton) { event.preventDefault(); event.stopPropagation(); openWorkView(); }
  const card = event.target.closest('[data-work-id]');
  if (card) (card.dataset.workKind === 'directive' ? showDirective(card.dataset.workId) : showAssignment(card.dataset.workId)).catch(()=>{});
}, true);

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'work-search-form') { event.preventDefault(); await loadWork(); }
  if (event.target.id === 'periodic-task-form') {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    await workApi('/api/periodic-tasks', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
    event.target.reset(); await loadWork();
  }
  const responsibilityForm = event.target.closest('[data-responsibility-form]');
  if (responsibilityForm) {
    event.preventDefault();
    const assignment = responsibilityForm.closest('[data-assignment-id]');
    const form = new FormData(responsibilityForm);
    const body = {
      executorPersonId: form.get('executorPersonId') || null,
      controllerPersonId: form.get('controllerPersonId') || null,
      coexecutorPersonIds: form.getAll('coexecutorPersonIds'),
      observerPersonIds: form.getAll('observerPersonIds'),
      reason: form.get('reason')
    };
    const error = q('[data-responsibility-error]', responsibilityForm);
    if (error) error.textContent = '';
    try {
      await workApi(`/api/assignments/${encodeURIComponent(assignment.dataset.assignmentId)}/responsibility`, {
        method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify(body)
      });
      await showDirective(assignment.dataset.directiveId);
      await loadWork();
    } catch (exception) {
      if (error) error.textContent = exception.message;
    }
  }
  const reportForm = event.target.closest('[data-report-form]');
  if (reportForm) {
    event.preventDefault();
    const assignmentId = reportForm.closest('[data-assignment-id]').dataset.assignmentId;
    const body = Object.fromEntries(new FormData(reportForm));
    if (!body.documentId) return;
    const updated = await workApi(`/api/assignments/${encodeURIComponent(assignmentId)}/report`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
    await showDirective(updated.directive_id);
  }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#work-search-form')) { clearTimeout(workState.timer); workState.timer=setTimeout(()=>loadWork().catch(()=>{}),250); }
});

window.loadWork = loadWork;
ensureWorkUi();
