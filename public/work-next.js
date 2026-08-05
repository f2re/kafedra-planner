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

async function showDirective(id) {
  const item = await workApi(`/api/directives/${encodeURIComponent(id)}`);
  const inspector = q('#ux-inspector'); const body = q('#ux-inspector-body');
  if (!inspector || !body) return;
  body.innerHTML = `<div class="work-inspector-grid"><section class="inspector-section"><div class="eyebrow">${esc(item.directive_kind)}</div><h2>${esc(item.title)}</h2><p>№ ${esc(item.document_number || 'не указан')} · ${esc(item.issued_at || 'дата не указана')}</p><p>${esc(item.issuer_raw || '')}</p><button class="secondary-button" type="button" data-inspector-document="${esc(item.source_document_id)}">Открыть оригинал</button></section>
  <section class="inspector-section"><h3>Поручения</h3>${item.assignments.map((a)=>assignmentHtml(a)).join('') || '<div class="empty-state">Поручений не найдено.</div>'}</section></div>`;
  inspector.classList.remove('hidden'); q('#sheet-backdrop')?.classList.remove('hidden');
}

function assignmentHtml(a) {
  const executors = a.executors.map((e)=>e.display_name || e.executor_raw).join(', ') || 'не назначен';
  const docs = ['<option value="">Выберите отчётный документ</option>', ...workState.documents.map((d)=>`<option value="${esc(d.id)}">${esc(d.title)}</option>`)].join('');
  return `<article class="work-assignment" data-assignment-id="${esc(a.id)}"><header><strong>${esc(a.title)}</strong><span>${esc(a.due_date || 'без срока')}</span></header><div class="work-executors">Исполнители: ${esc(executors)} · состояние: ${esc(a.status)}</div><p>${esc(a.instruction_text)}</p><form class="work-report-form" data-report-form><select name="documentId">${docs}</select><button class="secondary-button" type="submit">Приложить отчёт</button></form></article>`;
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
