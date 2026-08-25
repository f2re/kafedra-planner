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

function dEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function dHeader(value) {
  return encodeURIComponent(String(value ?? '').slice(0, 1800));
}

function dDate(value, options = {}) {
  if (!value) return 'Дата не указана';
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T09:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: options.short ? 'short' : 'long', year: options.year === false ? undefined : 'numeric'
  }).format(date);
}

function dBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} байт`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function dKind(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Распоряжение';
  const lower = raw.toLocaleLowerCase('ru-RU');
  if (lower === 'directive') return 'Распоряжение';
  if (lower === 'order') return 'Приказ';
  if (lower === 'decree') return 'Указ';
  return raw;
}

function dDirection(value) {
  return {
    science: 'Наука', education: 'Образование', organizational: 'Организация',
    personnel: 'Кадры', safety: 'Безопасность', finance: 'Финансы', digital: 'Цифровизация'
  }[value] || value || 'Организация';
}

function dMaterialKind(value) {
  return {
    report: 'Отчёт', scan: 'Скан', act: 'Акт', photo: 'Фото', letter: 'Письмо',
    certificate: 'Справка', presentation: 'Презентация', other: 'Материал'
  }[value] || value || 'Материал';
}

async function dApi(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

function dNotice(message) {
  const box = $d('#directive-notice');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(dNotice.timer);
  dNotice.timer = setTimeout(() => box.classList.add('hidden'), 4400);
}

function ensureDirectiveArchiveUi() {
  if (!$d('#directive-archive-styles')) {
    const link = document.createElement('link');
    link.id = 'directive-archive-styles';
    link.rel = 'stylesheet';
    link.href = '/directive-archive-next.css';
    document.head.append(link);
  }

  const nav = $d('#navigation');
  if (nav && !$d('[data-view="directive-archive"]', nav)) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'directive-archive';
    button.innerHTML = '<span class="nav-icon" aria-hidden="true">⌑</span><span>Распоряжения</span>';
    nav.querySelector('[data-view="documents"]')?.before(button);
  }

  const mobile = $d('.mobile-tabs');
  if (mobile && !$d('[data-view="directive-archive"]', mobile)) {
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
          <div>
            <h2>Распоряжения и отчётные материалы</h2>
            <p>Единое дело: исходное распоряжение, реквизиты, поручения, отчёты, сканы, акты и фотографии. Оригиналы файлов сохраняются без изменений.</p>
          </div>
          <div class="directive-archive-actions">
            <button id="directive-add" class="primary-button" type="button">Добавить распоряжение</button>
          </div>
        </div>

        <div class="directive-archive-toolbar">
          <label class="directive-archive-search"><span aria-hidden="true">⌕</span><input id="directive-q" type="search" placeholder="Номер, название, отчёт, текст материала…" aria-label="Поиск"></label>
          <input id="directive-from" type="date" aria-label="Дата с" title="Дата с">
          <input id="directive-to" type="date" aria-label="Дата по" title="Дата по">
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
      </section>
    `);
  }

  if (!$d('#directive-modal-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="directive-modal-backdrop" class="directive-modal-backdrop hidden"></div>
      <section id="directive-modal" class="directive-modal hidden" role="dialog" aria-modal="true"></section>
      <div id="directive-notice" class="directive-notice hidden" role="status" aria-live="polite"></div>
    `);
  }
}

function setDirectiveViewChrome() {
  $$d('.nav-item, .mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'directive-archive'));
  $$d('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'directive-archive'));
  if ($d('#page-title')) $d('#page-title').textContent = 'Распоряжения';
  if ($d('#page-subtitle')) $d('#page-subtitle').textContent = 'Документы-основания, отчёты, сканы, даты и быстрый поиск';
  $d('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  window.dispatchEvent(new CustomEvent('kafedra:view-changed', { detail: { view: 'directive-archive' } }));
}

function activateDirectiveArchive(directiveId = null) {
  ensureDirectiveArchiveUi();
  directiveArchiveState.active = true;
  if (directiveId) directiveArchiveState.selectedId = directiveId;
  setDirectiveViewChrome();
  loadDirectiveArchive().catch((error) => dNotice(error.message));
}

function deactivateDirectiveArchive() {
  directiveArchiveState.active = false;
}

function archiveQuery() {
  const params = new URLSearchParams({ limit: '1000' });
  for (const [key, value] of Object.entries(directiveArchiveState.filters)) if (value) params.set(key, value);
  return params.toString();
}

function fillDirectiveFacets() {
  const select = $d('#directive-kind');
  if (!select) return;
  const selected = directiveArchiveState.filters.kind;
  select.innerHTML = '<option value="">Все виды</option>' + (directiveArchiveState.facets.kinds || [])
    .map((value) => `<option value="${dEscape(value)}">${dEscape(dKind(value))}</option>`).join('');
  select.value = selected;
}

async function loadDirectiveArchive() {
  if (!directiveArchiveState.active) return;
  const request = ++directiveArchiveState.request;
  const payload = await dApi(`/api/directive-archive?${archiveQuery()}`);
  if (request !== directiveArchiveState.request || !directiveArchiveState.active) return;
  directiveArchiveState.items = payload.items || [];
  directiveArchiveState.facets = payload.facets || directiveArchiveState.facets;
  directiveArchiveState.stats = payload.stats || directiveArchiveState.stats;
  fillDirectiveFacets();
  renderDirectiveStats();

  if (directiveArchiveState.selectedId && !directiveArchiveState.items.some((item) => item.id === directiveArchiveState.selectedId)) {
    directiveArchiveState.selectedId = null;
    directiveArchiveState.selected = null;
  }
  if (!directiveArchiveState.selectedId && directiveArchiveState.items.length) directiveArchiveState.selectedId = directiveArchiveState.items[0].id;

  if (directiveArchiveState.mode === 'calendar') renderDirectiveCalendar();
  else renderDirectiveList();
  if (directiveArchiveState.selectedId) await loadDirectiveDetail(directiveArchiveState.selectedId);
  else renderDirectiveDetail(null);
}

function renderDirectiveStats() {
  if ($d('#directive-stat-total')) $d('#directive-stat-total').textContent = String(directiveArchiveState.items.length);
  if ($d('#directive-stat-with')) $d('#directive-stat-with').textContent = String(directiveArchiveState.stats.withMaterials || 0);
  if ($d('#directive-stat-without')) $d('#directive-stat-without').textContent = String(directiveArchiveState.stats.withoutMaterials || 0);
}

function directiveLabel(item) {
  const kind = dKind(item.directive_kind);
  return `${kind}${item.document_number ? ` № ${item.document_number}` : ''}`;
}

function renderDirectiveList() {
  const content = $d('#directive-archive-content');
  if (content) content.className = 'directive-archive-layout';
  let listPanel = $d('#directive-list')?.closest('.directive-list-panel');
  let detail = $d('#directive-detail');
  if (!listPanel || !detail) {
    content.innerHTML = '<section class="directive-list-panel"><div id="directive-list" class="directive-list"></div></section><section id="directive-detail" class="directive-detail-panel"></section>';
    listPanel = $d('#directive-list')?.closest('.directive-list-panel');
    detail = $d('#directive-detail');
  }
  listPanel.classList.remove('hidden');
  detail.classList.remove('hidden');
  const target = $d('#directive-list');
  if (!directiveArchiveState.items.length) {
    target.innerHTML = '<div class="directive-empty">Ничего не найдено. Измените фильтры или добавьте распоряжение.</div>';
    return;
  }
  target.innerHTML = directiveArchiveState.items.map((item) => `
    <button type="button" class="directive-row${item.id === directiveArchiveState.selectedId ? ' active' : ''}" data-directive-id="${dEscape(item.id)}">
      <div class="directive-row-top"><span class="directive-row-number">${dEscape(directiveLabel(item))}</span><span class="directive-row-date">${dEscape(dDate(item.issued_at, { short: true }))}</span></div>
      <h3>${dEscape(item.title)}</h3>
      <div class="directive-row-bottom">
        <span>${dEscape(dDirection(item.direction))}</span>
        <span class="directive-material-pill${item.material_count ? '' : ' empty'}">${item.material_count ? `${item.material_count} мат.` : 'нет материалов'}</span>
      </div>
    </button>
  `).join('');
}

async function loadDirectiveDetail(id) {
  if (!id || !directiveArchiveState.active) return;
  const payload = await dApi(`/api/directive-archive/${encodeURIComponent(id)}`);
  if (!directiveArchiveState.active || directiveArchiveState.selectedId !== id) return;
  directiveArchiveState.selected = payload.item;
  renderDirectiveDetail(payload.item);
  if (directiveArchiveState.mode === 'list') renderDirectiveList();
}

function materialCard(material) {
  const direct = material.origin === 'directive';
  const title = material.title || material.document_title || material.original_name || 'Отчётный материал';
  const assignment = material.assignment_title ? ` · ${material.assignment_title}` : '';
  return `
    <article class="directive-material">
      <div class="directive-material-head">
        <div><h4>${dEscape(title)}</h4><div class="directive-material-meta">${dEscape(dMaterialKind(material.material_kind))} · ${dEscape(dDate(material.material_date || String(material.created_at || '').slice(0, 10), { short: true }))}${dEscape(assignment)}</div></div>
        <div class="directive-material-actions">
          ${material.content_url ? `<a class="secondary-button directive-file-link" href="${dEscape(material.content_url)}" target="_blank" rel="noopener">Открыть</a>` : ''}
          ${direct ? `<button type="button" class="quiet-button" data-directive-material-remove="${dEscape(material.id)}">Убрать</button>` : ''}
        </div>
      </div>
      <div class="directive-material-meta">${dEscape(material.original_name || '')}${material.size_bytes != null ? ` · ${dEscape(dBytes(material.size_bytes))}` : ''}</div>
      ${material.note ? `<p>${dEscape(material.note)}</p>` : ''}
    </article>
  `;
}

function assignmentCard(item) {
  const due = item.due_date ? `Срок: ${dDate(item.due_date, { short: true })}` : 'Срок не задан';
  const reports = Number(item.report_count || 0);
  return `
    <article class="directive-assignment">
      <div class="directive-assignment-head"><div><h4>${item.source_item_no ? `${dEscape(item.source_item_no)}. ` : ''}${dEscape(item.title)}</h4><div class="directive-assignment-meta">${dEscape(due)} · ${reports ? `материалов: ${reports}` : 'материалов нет'}</div></div><span>${dEscape(item.status || '')}</span></div>
      ${item.instruction_text && item.instruction_text !== item.title ? `<p>${dEscape(item.instruction_text)}</p>` : ''}
    </article>
  `;
}

function renderDirectiveDetail(item) {
  const target = $d('#directive-detail');
  if (!target) return;
  if (!item) {
    target.innerHTML = '<div class="directive-empty">Выберите распоряжение.</div>';
    return;
  }
  const materials = item.materials || [];
  const assignments = item.assignments || [];
  target.innerHTML = `
    <div class="directive-detail-head">
      <div>
        <div class="directive-eyebrow">${dEscape(directiveLabel(item))}</div>
        <h2>${dEscape(item.title)}</h2>
        <div class="directive-detail-subtitle">${dEscape(dDate(item.issued_at))}${item.issuer_raw ? ` · ${dEscape(item.issuer_raw)}` : ''}</div>
      </div>
      <div class="directive-detail-actions">
        <button type="button" class="secondary-button" data-directive-edit>Изменить</button>
        <a class="primary-button directive-file-link" href="${dEscape(item.source_content_url)}" target="_blank" rel="noopener">Исходник</a>
      </div>
    </div>
    <div class="directive-facts">
      <div class="directive-fact"><span>Номер</span><strong>${dEscape(item.document_number || '—')}</strong></div>
      <div class="directive-fact"><span>Дата</span><strong>${dEscape(dDate(item.issued_at, { short: true }))}</strong></div>
      <div class="directive-fact"><span>Направление</span><strong>${dEscape(dDirection(item.direction))}</strong></div>
      <div class="directive-fact"><span>Материалы</span><strong>${materials.length}</strong></div>
    </div>
    ${item.summary ? `<section class="directive-section"><div class="directive-section-title"><h3>О чём документ</h3></div><div class="directive-summary">${dEscape(item.summary)}</div></section>` : ''}
    <section class="directive-section">
      <div class="directive-section-title"><h3>Отчётные материалы <span class="count-pill">${materials.length}</span></h3><button type="button" class="primary-button" data-directive-add-material>Добавить материал</button></div>
      <div class="directive-material-list">${materials.length ? materials.map(materialCard).join('') : '<div class="directive-empty">Отчётных материалов пока нет. Можно приложить отчёт, скан, акт, фото, письмо или другой файл.</div>'}</div>
    </section>
    <section class="directive-section">
      <div class="directive-section-title"><h3>Поручения <span class="count-pill">${assignments.length}</span></h3></div>
      <div class="directive-assignment-list">${assignments.length ? assignments.map(assignmentCard).join('') : '<div class="directive-empty">В документе нет выделенных поручений. Это не мешает хранить отчётные материалы по распоряжению целиком.</div>'}</div>
    </section>
  `;
}

function startOfCalendar(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return start;
}

function calendarKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderDirectiveCalendar() {
  const content = $d('#directive-archive-content');
  if (!content) return;
  content.className = 'directive-archive-layout';
  const month = directiveArchiveState.calendarDate;
  const start = startOfCalendar(month);
  const today = calendarKey(new Date());
  const title = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(month);
  const byDate = new Map();
  for (const item of directiveArchiveState.items) {
    if (!item.issued_at) continue;
    const key = String(item.issued_at).slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  }
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = calendarKey(date);
    const entries = byDate.get(key) || [];
    const other = date.getMonth() !== month.getMonth();
    cells.push(`<div class="directive-calendar-day${other ? ' other-month' : ''}${key === today ? ' today' : ''}">
      <span class="directive-calendar-number">${date.getDate()}</span>
      ${entries.slice(0, 3).map((item) => `<button type="button" class="directive-calendar-entry" data-directive-id="${dEscape(item.id)}" title="${dEscape(item.title)}">${dEscape(item.document_number ? `№ ${item.document_number}` : dKind(item.directive_kind))} · ${dEscape(item.title)}</button>`).join('')}
      ${entries.length > 3 ? `<div class="directive-calendar-more">ещё ${entries.length - 3}</div>` : ''}
    </div>`);
  }
  content.innerHTML = `
    <section class="directive-calendar-panel">
      <div class="directive-calendar-head"><div class="directive-archive-actions"><button class="icon-button" type="button" data-directive-month="prev">‹</button><button class="secondary-button" type="button" data-directive-month="today">Сегодня</button><button class="icon-button" type="button" data-directive-month="next">›</button></div><h3>${dEscape(title)}</h3><span>${directiveArchiveState.items.length} документов</span></div>
      <div class="directive-calendar-weekdays"><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div></div>
      <div class="directive-calendar-grid">${cells.join('')}</div>
    </section>
    <section id="directive-detail" class="directive-detail-panel">${directiveArchiveState.selected ? '' : '<div class="directive-empty">Нажмите распоряжение в календаре.</div>'}</section>
  `;
  if (directiveArchiveState.selected) renderDirectiveDetail(directiveArchiveState.selected);
}

function closeDirectiveModal() {
  $d('#directive-modal-backdrop')?.classList.add('hidden');
  $d('#directive-modal')?.classList.add('hidden');
  if ($d('#directive-modal')) $d('#directive-modal').innerHTML = '';
}

function showDirectiveModal(html) {
  const modal = $d('#directive-modal');
  modal.innerHTML = html;
  $d('#directive-modal-backdrop')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus());
}

function directiveFormValues(item = null) {
  return {
    number: item?.document_number || '', issuedAt: item?.issued_at || '', title: item?.title || '',
    kind: item?.directive_kind || 'Распоряжение', direction: item?.direction || 'organizational',
    issuer: item?.issuer_raw || '', summary: item?.summary || ''
  };
}

function openAddDirective() {
  const values = directiveFormValues();
  showDirectiveModal(`
    <header><div><div class="directive-eyebrow">Новое дело</div><h2>Добавить распоряжение</h2></div><button class="icon-button" type="button" data-directive-modal-close>×</button></header>
    <form id="directive-create-form" class="directive-form">
      <label class="full"><span>Исходный файл *</span><input name="file" type="file" required accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.tif,.tiff,.txt"><small>PDF, Word, скан или фотография. Оригинал будет сохранён как отдельный документ.</small></label>
      <label><span>Номер *</span><input name="number" required placeholder="Например, 47-р"></label>
      <label><span>Дата *</span><input name="issuedAt" type="date" required></label>
      <label class="full"><span>Название *</span><input name="title" required placeholder="О проведении…"></label>
      <label><span>Вид</span><select name="kind"><option>Распоряжение</option><option>Приказ</option><option>Указ</option><option>Поручение</option><option>Иной документ</option></select></label>
      <label><span>Направление</span><select name="direction"><option value="organizational">Организация</option><option value="education">Образование</option><option value="science">Наука</option><option value="personnel">Кадры</option><option value="safety">Безопасность</option><option value="finance">Финансы</option><option value="digital">Цифровизация</option></select></label>
      <label class="full"><span>Кем издано</span><input name="issuer" placeholder="Организация, должность или ФИО"></label>
      <label class="full"><span>Краткое содержание</span><textarea name="summary" rows="4" maxlength="1500" placeholder="Коротко, чтобы затем проще находить документ"></textarea></label>
    </form>
    <footer><button class="secondary-button" type="button" data-directive-modal-close>Отмена</button><button class="primary-button" type="submit" form="directive-create-form">Сохранить распоряжение</button></footer>
  `);
  $d('#directive-create-form [name="kind"]').value = values.kind;
  $d('#directive-create-form [name="direction"]').value = values.direction;
}

function openEditDirective() {
  const item = directiveArchiveState.selected;
  if (!item) return;
  const values = directiveFormValues(item);
  showDirectiveModal(`
    <header><div><div class="directive-eyebrow">Реквизиты</div><h2>Изменить распоряжение</h2></div><button class="icon-button" type="button" data-directive-modal-close>×</button></header>
    <form id="directive-edit-form" class="directive-form">
      <label><span>Номер *</span><input name="number" required value="${dEscape(values.number)}"></label>
      <label><span>Дата *</span><input name="issuedAt" type="date" required value="${dEscape(values.issuedAt)}"></label>
      <label class="full"><span>Название *</span><input name="title" required value="${dEscape(values.title)}"></label>
      <label><span>Вид</span><input name="kind" value="${dEscape(values.kind)}"></label>
      <label><span>Направление</span><select name="direction"><option value="organizational">Организация</option><option value="education">Образование</option><option value="science">Наука</option><option value="personnel">Кадры</option><option value="safety">Безопасность</option><option value="finance">Финансы</option><option value="digital">Цифровизация</option></select></label>
      <label class="full"><span>Кем издано</span><input name="issuer" value="${dEscape(values.issuer)}"></label>
      <label class="full"><span>Краткое содержание</span><textarea name="summary" rows="4" maxlength="1500">${dEscape(values.summary)}</textarea></label>
    </form>
    <footer><button class="secondary-button" type="button" data-directive-modal-close>Отмена</button><button class="primary-button" type="submit" form="directive-edit-form">Сохранить изменения</button></footer>
  `);
  $d('#directive-edit-form [name="direction"]').value = values.direction;
}

function openAddMaterial() {
  const item = directiveArchiveState.selected;
  if (!item) return;
  const assignments = item.assignments || [];
  showDirectiveModal(`
    <header><div><div class="directive-eyebrow">${dEscape(directiveLabel(item))}</div><h2>Добавить отчётный материал</h2></div><button class="icon-button" type="button" data-directive-modal-close>×</button></header>
    <form id="directive-material-form" class="directive-form">
      <label class="full"><span>Файл *</span><input name="file" type="file" required><small>Подойдёт отчёт, скан, акт, фото, презентация, таблица или любой другой подтверждающий файл.</small></label>
      <label><span>Вид материала</span><select name="kind"><option value="report">Отчёт</option><option value="scan">Скан</option><option value="act">Акт</option><option value="photo">Фото</option><option value="letter">Письмо</option><option value="certificate">Справка</option><option value="presentation">Презентация</option><option value="other">Другое</option></select></label>
      <label><span>Дата материала</span><input name="materialDate" type="date"></label>
      <label class="full"><span>Название</span><input name="title" placeholder="Например, Отчёт о выполнении пункта 2"></label>
      <label class="full"><span>Связать с конкретным поручением</span><select name="assignmentId"><option value="">Со всем распоряжением</option>${assignments.map((assignment) => `<option value="${dEscape(assignment.id)}">${assignment.source_item_no ? `${dEscape(assignment.source_item_no)}. ` : ''}${dEscape(assignment.title)}</option>`).join('')}</select></label>
      <label class="full"><span>Комментарий</span><textarea name="note" rows="4" maxlength="1500" placeholder="Что подтверждает этот файл, особенности, номер акта и т. п."></textarea></label>
    </form>
    <footer><button class="secondary-button" type="button" data-directive-modal-close>Отмена</button><button class="primary-button" type="submit" form="directive-material-form">Прикрепить материал</button></footer>
  `);
}

async function submitDirectiveCreate(form) {
  const data = new FormData(form);
  const file = data.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Выберите файл распоряжения.');
  const response = await dApi('/api/directive-archive', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-directive-number': dHeader(data.get('number')),
      'x-directive-date': dHeader(data.get('issuedAt')),
      'x-directive-title': dHeader(data.get('title')),
      'x-directive-kind': dHeader(data.get('kind')),
      'x-directive-direction': dHeader(data.get('direction')),
      'x-directive-issuer': dHeader(data.get('issuer')),
      'x-directive-summary': dHeader(data.get('summary')),
      'idempotency-key': `directive-archive:${file.name}:${file.size}:${file.lastModified}:${data.get('number')}`
    },
    body: file
  });
  directiveArchiveState.selectedId = response.item.id;
  closeDirectiveModal();
  dNotice('Распоряжение сохранено. Файл обрабатывается, но уже доступен в архиве и календаре.');
  await loadDirectiveArchive();
}

async function submitDirectiveEdit(form) {
  const item = directiveArchiveState.selected;
  if (!item) return;
  const data = new FormData(form);
  await dApi(`/api/directive-archive/${encodeURIComponent(item.id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      documentNumber: String(data.get('number') || '').trim(),
      issuedAt: String(data.get('issuedAt') || '').trim(),
      title: String(data.get('title') || '').trim(),
      directiveKind: String(data.get('kind') || '').trim(),
      direction: String(data.get('direction') || '').trim(),
      issuerRaw: String(data.get('issuer') || '').trim(),
      summary: String(data.get('summary') || '').trim()
    })
  });
  closeDirectiveModal();
  dNotice('Реквизиты обновлены. Дата в календаре синхронизирована.');
  await loadDirectiveArchive();
}

async function submitDirectiveMaterial(form) {
  const item = directiveArchiveState.selected;
  if (!item) return;
  const data = new FormData(form);
  const file = data.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Выберите файл отчётного материала.');
  const title = String(data.get('title') || '').trim() || file.name.replace(/\.[^.]+$/u, '');
  await dApi(`/api/directive-archive/${encodeURIComponent(item.id)}/materials`, {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-material-kind': dHeader(data.get('kind')),
      'x-material-date': dHeader(data.get('materialDate')),
      'x-material-title': dHeader(title),
      'x-material-note': dHeader(data.get('note')),
      'x-assignment-id': dHeader(data.get('assignmentId')),
      'idempotency-key': `directive-material:${item.id}:${file.name}:${file.size}:${file.lastModified}`
    },
    body: file
  });
  closeDirectiveModal();
  dNotice('Материал приложен к распоряжению. Его можно открыть из карточки и найти через поиск.');
  await loadDirectiveArchive();
}

async function removeDirectiveMaterial(materialId) {
  const item = directiveArchiveState.selected;
  if (!item) return;
  await dApi(`/api/directive-archive/${encodeURIComponent(item.id)}/materials/${encodeURIComponent(materialId)}`, { method: 'DELETE' });
  dNotice('Связь материала с распоряжением удалена. Сам исходный документ не уничтожен.');
  await loadDirectiveArchive();
}

function setDirectiveMode(mode) {
  if (!['list', 'calendar'].includes(mode)) return;
  directiveArchiveState.mode = mode;
  $$d('[data-directive-mode]').forEach((button) => {
    const active = button.dataset.directiveMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (mode === 'calendar') renderDirectiveCalendar();
  else {
    const content = $d('#directive-archive-content');
    if (content) content.innerHTML = '<section class="directive-list-panel"><div id="directive-list" class="directive-list"></div></section><section id="directive-detail" class="directive-detail-panel"></section>';
    renderDirectiveList();
    renderDirectiveDetail(directiveArchiveState.selected);
  }
}

function scheduleDirectiveReload() {
  clearTimeout(directiveArchiveState.timer);
  directiveArchiveState.timer = setTimeout(() => loadDirectiveArchive().catch((error) => dNotice(error.message)), 220);
}

ensureDirectiveArchiveUi();

for (const [selector, key] of [['#directive-from', 'from'], ['#directive-to', 'to'], ['#directive-kind', 'kind'], ['#directive-report', 'report']]) {
  $d(selector)?.addEventListener('change', (event) => {
    directiveArchiveState.filters[key] = event.target.value;
    scheduleDirectiveReload();
  });
}
$d('#directive-q')?.addEventListener('input', (event) => {
  directiveArchiveState.filters.q = event.target.value.trim();
  scheduleDirectiveReload();
});

document.addEventListener('click', (event) => {
  const archiveView = event.target.closest('[data-view="directive-archive"]');
  if (archiveView) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activateDirectiveArchive();
    return;
  }
  if (event.target.closest('[data-view]') && !archiveView) deactivateDirectiveArchive();

  const row = event.target.closest('[data-directive-id]');
  if (row) {
    directiveArchiveState.selectedId = row.dataset.directiveId;
    loadDirectiveDetail(directiveArchiveState.selectedId).catch((error) => dNotice(error.message));
    return;
  }
  const mode = event.target.closest('[data-directive-mode]');
  if (mode) return setDirectiveMode(mode.dataset.directiveMode);
  if (event.target.closest('#directive-add')) return openAddDirective();
  if (event.target.closest('[data-directive-edit]')) return openEditDirective();
  if (event.target.closest('[data-directive-add-material]')) return openAddMaterial();
  if (event.target.closest('[data-directive-modal-close]') || event.target === $d('#directive-modal-backdrop')) return closeDirectiveModal();
  const remove = event.target.closest('[data-directive-material-remove]');
  if (remove) return removeDirectiveMaterial(remove.dataset.directiveMaterialRemove).catch((error) => dNotice(error.message));
  const month = event.target.closest('[data-directive-month]');
  if (month) {
    const action = month.dataset.directiveMonth;
    if (action === 'today') directiveArchiveState.calendarDate = new Date();
    else directiveArchiveState.calendarDate = new Date(
      directiveArchiveState.calendarDate.getFullYear(),
      directiveArchiveState.calendarDate.getMonth() + (action === 'next' ? 1 : -1), 1
    );
    return renderDirectiveCalendar();
  }
  if (event.target.closest('#directive-reset')) {
    directiveArchiveState.filters = { q: '', from: '', to: '', kind: '', direction: '', report: '' };
    for (const selector of ['#directive-q', '#directive-from', '#directive-to', '#directive-kind', '#directive-report']) {
      const field = $d(selector);
      if (field) field.value = '';
    }
    return loadDirectiveArchive().catch((error) => dNotice(error.message));
  }
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id === 'directive-create-form') {
    event.preventDefault();
    submitDirectiveCreate(event.target).catch((error) => dNotice(error.message));
  }
  if (event.target.id === 'directive-edit-form') {
    event.preventDefault();
    submitDirectiveEdit(event.target).catch((error) => dNotice(error.message));
  }
  if (event.target.id === 'directive-material-form') {
    event.preventDefault();
    submitDirectiveMaterial(event.target).catch((error) => dNotice(error.message));
  }
}, true);

window.addEventListener('kafedra:view-changed', (event) => {
  if (event.detail?.view !== 'directive-archive') directiveArchiveState.active = false;
});

window.kafedraOpenDirectiveArchive = (directiveId) => activateDirectiveArchive(directiveId);
