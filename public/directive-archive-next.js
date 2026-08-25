const directiveArchiveState = {
  active: false,
  items: [],
  facets: { kinds: [], directions: [], years: [] },
  stats: { withMaterials: 0, withoutMaterials: 0, dated: 0 },
  selectedId: null,
  selected: null,
  mode: 'list',
  calendarDate: new Date(),
  filters: { q: '', from: '', to: '', kind: '', direction: '', report: '' },
  timer: null,
  request: 0
};

const $d = (selector, root = document) => root.querySelector(selector);
const $$d = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function headerValue(value) {
  return encodeURIComponent(String(value ?? '').slice(0, 1800));
}

function dateLabel(value, short = false) {
  if (!value) return 'Дата не указана';
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T09:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' }).format(date);
}

function directionLabel(value) {
  return {
    science: 'Наука', education: 'Образование', organizational: 'Организация',
    personnel: 'Кадры', safety: 'Безопасность', finance: 'Финансы', digital: 'Цифровизация'
  }[value] || value || 'Организация';
}

function materialLabel(value) {
  return {
    report: 'Отчёт', scan: 'Скан', act: 'Акт', photo: 'Фото', letter: 'Письмо',
    certificate: 'Справка', presentation: 'Презентация', other: 'Материал'
  }[value] || value || 'Материал';
}

function directiveKind(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Распоряжение';
  const lower = raw.toLocaleLowerCase('ru-RU');
  if (lower === 'directive') return 'Распоряжение';
  if (lower === 'order') return 'Приказ';
  if (lower === 'decree') return 'Указ';
  return raw;
}

function directiveLabel(item) {
  return `${directiveKind(item.directive_kind)}${item.document_number ? ` № ${item.document_number}` : ''}`;
}

async function api(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function notice(message) {
  const node = $d('#directive-notice');
  if (!node) return;
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => node.classList.add('hidden'), 4200);
}

function ensureUi() {
  if (!$d('#directive-archive-styles')) {
    const link = document.createElement('link');
    link.id = 'directive-archive-styles';
    link.rel = 'stylesheet';
    link.href = '/directive-archive-next.css';
    document.head.append(link);
  }
  const nav = $d('#navigation');
  if (nav && !$d('#navigation [data-view="directive-archive"]')) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'directive-archive';
    button.innerHTML = '<span class="nav-icon" aria-hidden="true">⌑</span><span>Распоряжения</span>';
    nav.querySelector('[data-view="documents"]')?.before(button);
  }
  const mobile = $d('.mobile-tabs');
  if (mobile && !$d('.mobile-tabs [data-view="directive-archive"]')) {
    const button = document.createElement('button');
    button.className = 'mobile-tab directive-mobile-tab';
    button.dataset.view = 'directive-archive';
    button.innerHTML = '<span>⌑</span>Распоряжения';
    mobile.querySelector('[data-view="documents"]')?.before(button);
  }
  const workspace = $d('.workspace');
  if (workspace && !$d('[data-view-panel="directive-archive"]')) {
    workspace.insertAdjacentHTML('beforeend', `
      <section class="view directive-archive-view" data-view-panel="directive-archive">
        <div class="directive-archive-heading">
          <div><h2>Распоряжения и отчётные материалы</h2><p>Исходное распоряжение, реквизиты, поручения, отчёты, сканы, акты и фотографии в одном деле.</p></div>
          <div class="directive-archive-actions"><button id="directive-add" class="primary-button" type="button">Добавить распоряжение</button></div>
        </div>
        <div class="directive-archive-toolbar">
          <label class="directive-archive-search"><span aria-hidden="true">⌕</span><input id="directive-q" type="search" placeholder="Номер, название, отчёт, текст материала…" aria-label="Поиск"></label>
          <input id="directive-from" type="date" aria-label="Дата с">
          <input id="directive-to" type="date" aria-label="Дата по">
          <select id="directive-kind" aria-label="Вид документа"><option value="">Все виды</option></select>
          <select id="directive-report" aria-label="Отчётные материалы"><option value="">Все материалы</option><option value="with">Есть материалы</option><option value="without">Нет материалов</option></select>
          <button id="directive-reset" class="quiet-button" type="button">Сбросить</button>
        </div>
        <div class="directive-archive-stats">
          <div class="directive-stat"><strong id="directive-stat-total">0</strong><span>распоряжений найдено</span></div>
          <div class="directive-stat"><strong id="directive-stat-with">0</strong><span>с отчётными материалами</span></div>
          <div class="directive-stat"><strong id="directive-stat-without">0</strong><span>пока без материалов</span></div>
        </div>
        <div class="directive-archive-segmented" role="tablist" aria-label="Представление архива">
          <button type="button" class="active" data-directive-mode="list" role="tab" aria-selected="true">Список</button>
          <button type="button" data-directive-mode="calendar" role="tab" aria-selected="false">Календарь</button>
        </div>
        <div id="directive-archive-content" class="directive-archive-layout">
          <section class="directive-list-panel"><div id="directive-list" class="directive-list"><div class="directive-empty">Загрузка…</div></div></section>
          <section id="directive-detail" class="directive-detail-panel"><div class="directive-empty">Выберите распоряжение слева.</div></section>
        </div>
      </section>`);
  }
  if (!$d('#directive-modal-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="directive-modal-backdrop" class="directive-modal-backdrop hidden"></div>
      <section id="directive-modal" class="directive-modal hidden" role="dialog" aria-modal="true"></section>
      <div id="directive-notice" class="directive-notice hidden" role="status" aria-live="polite"></div>`);
  }
}

function activate(id = null) {
  ensureUi();
  directiveArchiveState.active = true;
  if (id) directiveArchiveState.selectedId = id;
  $$d('.nav-item, .mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'directive-archive'));
  $$d('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'directive-archive'));
  if ($d('#page-title')) $d('#page-title').textContent = 'Распоряжения';
  if ($d('#page-subtitle')) $d('#page-subtitle').textContent = 'Документы-основания, отчёты, сканы, даты и быстрый поиск';
  $d('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  loadArchive().catch((error) => notice(error.message));
}

function archiveQuery() {
  const params = new URLSearchParams({ limit: '1000' });
  for (const [key, value] of Object.entries(directiveArchiveState.filters)) if (value) params.set(key, value);
  return params.toString();
}

async function loadArchive() {
  if (!directiveArchiveState.active) return;
  const seq = ++directiveArchiveState.request;
  const payload = await api(`/api/directive-archive?${archiveQuery()}`);
  if (seq !== directiveArchiveState.request || !directiveArchiveState.active) return;
  directiveArchiveState.items = payload.items || [];
  directiveArchiveState.facets = payload.facets || directiveArchiveState.facets;
  directiveArchiveState.stats = payload.stats || directiveArchiveState.stats;
  const kind = $d('#directive-kind');
  if (kind) {
    const selected = directiveArchiveState.filters.kind;
    kind.innerHTML = '<option value="">Все виды</option>' + directiveArchiveState.facets.kinds.map((value) => `<option value="${esc(value)}">${esc(directiveKind(value))}</option>`).join('');
    kind.value = selected;
  }
  if ($d('#directive-stat-total')) $d('#directive-stat-total').textContent = String(directiveArchiveState.items.length);
  if ($d('#directive-stat-with')) $d('#directive-stat-with').textContent = String(directiveArchiveState.stats.withMaterials || 0);
  if ($d('#directive-stat-without')) $d('#directive-stat-without').textContent = String(directiveArchiveState.stats.withoutMaterials || 0);
  if (directiveArchiveState.selectedId && !directiveArchiveState.items.some((item) => item.id === directiveArchiveState.selectedId)) directiveArchiveState.selectedId = null;
  if (!directiveArchiveState.selectedId && directiveArchiveState.items.length) directiveArchiveState.selectedId = directiveArchiveState.items[0].id;
  if (directiveArchiveState.mode === 'calendar') renderCalendar(); else renderList();
  if (directiveArchiveState.selectedId) await loadDetail(directiveArchiveState.selectedId);
  else renderDetail(null);
}

function renderList() {
  const content = $d('#directive-archive-content');
  if (!content) return;
  if (!$d('#directive-list')) content.innerHTML = '<section class="directive-list-panel"><div id="directive-list" class="directive-list"></div></section><section id="directive-detail" class="directive-detail-panel"></section>';
  const list = $d('#directive-list');
  list.innerHTML = directiveArchiveState.items.length ? directiveArchiveState.items.map((item) => `
    <button type="button" class="directive-row${item.id === directiveArchiveState.selectedId ? ' active' : ''}" data-directive-id="${esc(item.id)}">
      <div class="directive-row-top"><span class="directive-row-number">${esc(directiveLabel(item))}</span><span class="directive-row-date">${esc(dateLabel(item.issued_at, true))}</span></div>
      <h3>${esc(item.title)}</h3>
      <div class="directive-row-bottom"><span>${esc(directionLabel(item.direction))}</span><span class="directive-material-pill${item.material_count ? '' : ' empty'}">${item.material_count ? `${item.material_count} мат.` : 'нет материалов'}</span></div>
    </button>`).join('') : '<div class="directive-empty">Ничего не найдено.</div>';
}

async function loadDetail(id) {
  const payload = await api(`/api/directive-archive/${encodeURIComponent(id)}`);
  if (!directiveArchiveState.active || directiveArchiveState.selectedId !== id) return;
  directiveArchiveState.selected = payload.item;
  if (directiveArchiveState.mode === 'list') renderList();
  renderDetail(payload.item);
}

function materialCard(material) {
  const title = material.title || material.document_title || material.original_name || 'Отчётный материал';
  return `<article class="directive-material"><div class="directive-material-head"><div><h4>${esc(title)}</h4><div class="directive-material-meta">${esc(materialLabel(material.material_kind))} · ${esc(dateLabel(material.material_date || String(material.created_at || '').slice(0, 10), true))}</div></div><div class="directive-material-actions">${material.content_url ? `<a class="secondary-button directive-file-link" href="${esc(material.content_url)}" target="_blank" rel="noopener">Открыть</a>` : ''}${material.origin === 'directive' ? `<button type="button" class="quiet-button" data-directive-material-remove="${esc(material.id)}">Убрать</button>` : ''}</div></div>${material.note ? `<p>${esc(material.note)}</p>` : ''}</article>`;
}

function renderDetail(item) {
  const target = $d('#directive-detail');
  if (!target) return;
  if (!item) { target.innerHTML = '<div class="directive-empty">Выберите распоряжение.</div>'; return; }
  const materials = item.materials || [];
  const assignments = item.assignments || [];
  target.innerHTML = `
    <div class="directive-detail-head"><div><div class="directive-eyebrow">${esc(directiveLabel(item))}</div><h2>${esc(item.title)}</h2><div class="directive-detail-subtitle">${esc(dateLabel(item.issued_at))}</div></div><div class="directive-detail-actions"><button type="button" class="secondary-button" data-directive-edit>Изменить</button><a class="primary-button directive-file-link" href="${esc(item.source_content_url)}" target="_blank" rel="noopener">Исходник</a></div></div>
    <div class="directive-facts"><div class="directive-fact"><span>Номер</span><strong>${esc(item.document_number || '—')}</strong></div><div class="directive-fact"><span>Дата</span><strong>${esc(dateLabel(item.issued_at, true))}</strong></div><div class="directive-fact"><span>Направление</span><strong>${esc(directionLabel(item.direction))}</strong></div><div class="directive-fact"><span>Материалы</span><strong>${materials.length}</strong></div></div>
    ${item.summary ? `<section class="directive-section"><div class="directive-section-title"><h3>О чём документ</h3></div><div class="directive-summary">${esc(item.summary)}</div></section>` : ''}
    <section class="directive-section"><div class="directive-section-title"><h3>Отчётные материалы <span class="count-pill">${materials.length}</span></h3><button type="button" class="primary-button" data-directive-add-material>Добавить материал</button></div><div class="directive-material-list">${materials.length ? materials.map(materialCard).join('') : '<div class="directive-empty">Отчётных материалов пока нет. Можно приложить отчёт, скан, акт, фото, письмо или другой файл.</div>'}</div></section>
    <section class="directive-section"><div class="directive-section-title"><h3>Поручения <span class="count-pill">${assignments.length}</span></h3></div><div class="directive-assignment-list">${assignments.length ? assignments.map((a) => `<article class="directive-assignment"><h4>${a.source_item_no ? `${esc(a.source_item_no)}. ` : ''}${esc(a.title)}</h4><div class="directive-assignment-meta">${a.due_date ? `Срок: ${esc(dateLabel(a.due_date, true))}` : 'Срок не задан'}</div></article>`).join('') : '<div class="directive-empty">В документе нет выделенных поручений.</div>'}</div></section>`;
}

function calendarKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function renderCalendar() {
  const content = $d('#directive-archive-content');
  if (!content) return;
  const month = directiveArchiveState.calendarDate;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const byDate = new Map();
  for (const item of directiveArchiveState.items) {
    if (!item.issued_at) continue;
    const key = String(item.issued_at).slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  }
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = calendarKey(date); const entries = byDate.get(key) || [];
    cells.push(`<div class="directive-calendar-day${date.getMonth() !== month.getMonth() ? ' other-month' : ''}"><span class="directive-calendar-number">${date.getDate()}</span>${entries.slice(0, 3).map((item) => `<button type="button" class="directive-calendar-entry" data-directive-id="${esc(item.id)}">${esc(item.document_number ? `№ ${item.document_number}` : directiveKind(item.directive_kind))} · ${esc(item.title)}</button>`).join('')}</div>`);
  }
  content.innerHTML = `<section class="directive-calendar-panel"><div class="directive-calendar-head"><div class="directive-archive-actions"><button class="icon-button" type="button" data-directive-month="prev">‹</button><button class="secondary-button" type="button" data-directive-month="today">Сегодня</button><button class="icon-button" type="button" data-directive-month="next">›</button></div><h3>${esc(new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(month))}</h3></div><div class="directive-calendar-weekdays"><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div></div><div class="directive-calendar-grid">${cells.join('')}</div></section><section id="directive-detail" class="directive-detail-panel"></section>`;
  renderDetail(directiveArchiveState.selected);
}

function showModal(html) { const modal = $d('#directive-modal'); modal.innerHTML = html; $d('#directive-modal-backdrop').classList.remove('hidden'); modal.classList.remove('hidden'); }
function closeModal() { $d('#directive-modal-backdrop')?.classList.add('hidden'); $d('#directive-modal')?.classList.add('hidden'); }

function openCreate() {
  showModal(`<header><h2>Добавить распоряжение</h2><button class="icon-button" type="button" data-directive-modal-close>×</button></header><form id="directive-create-form" class="directive-form"><label class="full"><span>Исходный файл *</span><input name="file" type="file" required></label><label><span>Номер *</span><input name="number" required></label><label><span>Дата *</span><input name="issuedAt" type="date" required></label><label class="full"><span>Название *</span><input name="title" required></label><label><span>Вид</span><select name="kind"><option>Распоряжение</option><option>Приказ</option><option>Указ</option></select></label><label><span>Направление</span><select name="direction"><option value="organizational">Организация</option><option value="education">Образование</option><option value="science">Наука</option></select></label><label class="full"><span>Краткое содержание</span><textarea name="summary" rows="4"></textarea></label></form><footer><button class="secondary-button" type="button" data-directive-modal-close>Отмена</button><button class="primary-button" type="submit" form="directive-create-form">Сохранить распоряжение</button></footer>`);
}

function openMaterial() {
  const item = directiveArchiveState.selected; if (!item) return;
  showModal(`<header><h2>Добавить отчётный материал</h2><button class="icon-button" type="button" data-directive-modal-close>×</button></header><form id="directive-material-form" class="directive-form"><label class="full"><span>Файл *</span><input name="file" type="file" required></label><label><span>Вид материала</span><select name="kind"><option value="report">Отчёт</option><option value="scan">Скан</option><option value="act">Акт</option><option value="photo">Фото</option><option value="other">Другое</option></select></label><label><span>Дата материала</span><input name="materialDate" type="date"></label><label class="full"><span>Название</span><input name="title"></label><label class="full"><span>Комментарий</span><textarea name="note" rows="4"></textarea></label></form><footer><button class="secondary-button" type="button" data-directive-modal-close>Отмена</button><button class="primary-button" type="submit" form="directive-material-form">Прикрепить материал</button></footer>`);
}

async function submitCreate(form) {
  const data = new FormData(form); const file = data.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Выберите файл распоряжения.');
  const result = await api('/api/directive-archive', { method:'POST', headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-directive-number':headerValue(data.get('number')),'x-directive-date':headerValue(data.get('issuedAt')),'x-directive-title':headerValue(data.get('title')),'x-directive-kind':headerValue(data.get('kind')),'x-directive-direction':headerValue(data.get('direction')),'x-directive-summary':headerValue(data.get('summary')),'idempotency-key':`directive-archive:${file.name}:${file.size}:${file.lastModified}:${data.get('number')}`}, body:file });
  directiveArchiveState.selectedId = result.item.id; closeModal(); await loadArchive();
}

async function submitMaterial(form) {
  const item = directiveArchiveState.selected; const data = new FormData(form); const file = data.get('file');
  if (!item || !(file instanceof File) || !file.size) throw new Error('Выберите файл отчётного материала.');
  const title = String(data.get('title') || '').trim() || file.name.replace(/\.[^.]+$/u,'');
  await api(`/api/directive-archive/${encodeURIComponent(item.id)}/materials`, { method:'POST', headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-material-kind':headerValue(data.get('kind')),'x-material-date':headerValue(data.get('materialDate')),'x-material-title':headerValue(title),'x-material-note':headerValue(data.get('note')),'idempotency-key':`directive-material:${item.id}:${file.name}:${file.size}:${file.lastModified}`}, body:file });
  closeModal(); await loadArchive();
}

function scheduleReload() { clearTimeout(directiveArchiveState.timer); directiveArchiveState.timer = setTimeout(() => loadArchive().catch((e)=>notice(e.message)),220); }

ensureUi();
for (const [selector,key] of [['#directive-from','from'],['#directive-to','to'],['#directive-kind','kind'],['#directive-report','report']]) $d(selector)?.addEventListener('change',(e)=>{directiveArchiveState.filters[key]=e.target.value;scheduleReload();});
$d('#directive-q')?.addEventListener('input',(e)=>{directiveArchiveState.filters.q=e.target.value.trim();scheduleReload();});

document.addEventListener('click',(event)=>{
  const archiveView = event.target.closest('[data-view="directive-archive"]');
  if (archiveView) { event.preventDefault(); event.stopImmediatePropagation(); activate(); return; }
  if (event.target.closest('[data-view]')) directiveArchiveState.active = false;
  const row = event.target.closest('[data-directive-id]'); if (row) { directiveArchiveState.selectedId=row.dataset.directiveId; loadDetail(directiveArchiveState.selectedId).catch((e)=>notice(e.message)); return; }
  const mode = event.target.closest('[data-directive-mode]'); if (mode) { directiveArchiveState.mode=mode.dataset.directiveMode; $$d('[data-directive-mode]').forEach((b)=>b.classList.toggle('active',b===mode)); if (directiveArchiveState.mode==='calendar') renderCalendar(); else { $d('#directive-archive-content').innerHTML='<section class="directive-list-panel"><div id="directive-list" class="directive-list"></div></section><section id="directive-detail" class="directive-detail-panel"></section>'; renderList(); renderDetail(directiveArchiveState.selected); } return; }
  if (event.target.closest('#directive-add')) return openCreate();
  if (event.target.closest('[data-directive-add-material]')) return openMaterial();
  if (event.target.closest('[data-directive-modal-close]') || event.target===$d('#directive-modal-backdrop')) return closeModal();
  const remove = event.target.closest('[data-directive-material-remove]'); if (remove && directiveArchiveState.selected) api(`/api/directive-archive/${encodeURIComponent(directiveArchiveState.selected.id)}/materials/${encodeURIComponent(remove.dataset.directiveMaterialRemove)}`,{method:'DELETE'}).then(loadArchive).catch((e)=>notice(e.message));
  const month = event.target.closest('[data-directive-month]'); if (month) { const a=month.dataset.directiveMonth; directiveArchiveState.calendarDate=a==='today'?new Date():new Date(directiveArchiveState.calendarDate.getFullYear(),directiveArchiveState.calendarDate.getMonth()+(a==='next'?1:-1),1); renderCalendar(); }
  if (event.target.closest('#directive-reset')) { directiveArchiveState.filters={q:'',from:'',to:'',kind:'',direction:'',report:''}; ['#directive-q','#directive-from','#directive-to','#directive-kind','#directive-report'].forEach((s)=>{const n=$d(s);if(n)n.value='';}); loadArchive().catch((e)=>notice(e.message)); }
},true);

document.addEventListener('submit',(event)=>{
  if (event.target.id==='directive-create-form') { event.preventDefault(); submitCreate(event.target).catch((e)=>notice(e.message)); }
  if (event.target.id==='directive-material-form') { event.preventDefault(); submitMaterial(event.target).catch((e)=>notice(e.message)); }
},true);

window.kafedraOpenDirectiveArchive = (id) => activate(id);
