const state = {
  currentView: 'calendar',
  calendarMode: localStorage.getItem('kafedra-calendar-mode') || 'month',
  calendarDate: new Date(),
  calendarItems: [],
  tasks: [],
  documents: [],
  templates: [],
  notifications: [],
  reviewItems: [],
  refreshTimer: null,
  calendarLoadSequence: 0,
  template: {
    step: 1,
    source: null,
    fields: [],
    selectedLine: null,
    preview: null
  }
};

const viewMeta = {
  calendar: ['Календарь', 'Все события, задачи и контрольные сроки'],
  plans: ['Планы', 'Рабочие планы, пункты, сроки и источники'],
  documents: ['Документы', 'Оригиналы, результаты обработки и создание шаблонов'],
  templates: ['Шаблоны', 'Один раз покажите поля — дальше система извлекает их сама'],
  review: ['Проверка данных', 'Только вопросы, которые требуют решения человека'],
  search: ['Поиск', 'Документы, решения, заседания и извлечённые поля']
};

const categoryLabels = {
  science: 'Наука',
  education: 'Образование',
  organizational: 'Организация',
  everyday: 'Повседневная'
};

const statusLabels = {
  queued: 'В очереди', extracting: 'Обработка', processed: 'Готово', needs_review: 'Нужна проверка', failed: 'Ошибка',
  open: 'Открыта', completed: 'Выполнено', confirmed: 'Подтверждено', proposed: 'Предложено', cancelled: 'Отменено'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeSnippet(value) {
  return escapeHtml(value)
    .replaceAll('&lt;mark&gt;', '<mark>')
    .replaceAll('&lt;/mark&gt;', '</mark>');
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseCalendarDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T09:00:00` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value, options = {}) {
  const date = parseCalendarDate(value);
  if (!date) return value || 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: options.short ? 'short' : 'long',
    ...(options.year === false ? {} : { year: 'numeric' })
  }).format(date);
}

function shortWeekday(date) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(date).replace('.', '');
}

function timeLabel(value) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return 'Весь день';
  const date = parseCalendarDate(value);
  return date ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date) : '';
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 4200);
}

function runCalendarLoad() {
  loadCalendar().catch((error) => toast(error.message || 'Не удалось обновить календарь.'));
}

function setView(view) {
  if (!viewMeta[view]) return;
  state.currentView = view;
  $$('.nav-item, .mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  const [title, subtitle] = viewMeta[view];
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#calendar-mode-switch').classList.toggle('hidden', view !== 'calendar');
  document.body.classList.remove('mobile-sidebar-open');
  if (view === 'calendar') runCalendarLoad();
  if (view === 'documents') loadDocuments();
  if (view === 'templates') loadTemplates();
  if (view === 'review') loadReview();
  if (view === 'search') requestAnimationFrame(() => $('#search-input').focus());
  window.dispatchEvent(new CustomEvent('kafedra:view-changed', { detail: { view } }));
}

window.kafedraSetView = setView;

function setCalendarMode(mode) {
  if (!['month', 'week', 'tasks'].includes(mode)) return;
  state.calendarMode = mode;
  localStorage.setItem('kafedra-calendar-mode', mode);
  $$('[data-calendar-mode]').forEach((button) => {
    const active = button.dataset.calendarMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#month-view').classList.toggle('hidden', mode !== 'month');
  $('#week-view').classList.toggle('hidden', mode !== 'week');
  $('#tasks-view').classList.toggle('hidden', mode !== 'tasks');
  $('#previous-period').disabled = mode === 'tasks';
  $('#next-period').disabled = mode === 'tasks';
  runCalendarLoad();
}

async function loadHealth() {
  try {
    const health = await api('/api/system/health');
    $('#health-dot').className = `dot ${health.status === 'ok' ? 'ok' : 'error'}`;
    $('#health-text').textContent = health.status === 'ok' ? `Система работает · схема ${health.schemaVersion}` : 'Требуется проверка';
  } catch {
    $('#health-dot').className = 'dot error';
    $('#health-text').textContent = 'Сервер недоступен';
  }
}

function monthRange(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  return { start, end };
}

function weekRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function eventsForDate(items, dateKey) {
  return items.filter((item) => String(item.starts_at).slice(0, 10) === dateKey);
}

function calendarEventHtml(event, className = 'calendar-event') {
  const kind = event.item_kind === 'task' || event.source_kind === 'decision' ? 'task' : 'event';
  return `<button class="${className} ${escapeHtml(event.category)} ${escapeHtml(event.importance)} ${kind} ${event.status === 'completed' ? 'completed' : ''}" type="button" data-calendar-item="${escapeHtml(event.id)}" title="${escapeHtml(event.description || event.title)}">${escapeHtml(event.title)}</button>`;
}

function setCalendarTitle(mode, displayDate, range = null) {
  if (mode === 'tasks') {
    $('#calendar-title').textContent = 'Задачи';
    return;
  }
  if (mode === 'week' && range) {
    $('#calendar-title').textContent = `${dateLabel(localDateKey(range.start), { short: true })} — ${dateLabel(localDateKey(range.end), { short: true })}`;
    return;
  }
  $('#calendar-title').textContent = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(displayDate);
}

async function loadCalendar() {
  const sequence = ++state.calendarLoadSequence;
  const mode = state.calendarMode;
  const displayDate = new Date(state.calendarDate);
  if (mode === 'tasks') {
    setCalendarTitle(mode, displayDate);
    const { items } = await api('/api/tasks?limit=2000');
    if (sequence !== state.calendarLoadSequence) return;
    state.tasks = items;
    renderTasks();
  } else {
    const range = mode === 'week' ? weekRange(displayDate) : monthRange(displayDate);
    setCalendarTitle(mode, displayDate, range);
    const { items } = await api(`/api/calendar?from=${localDateKey(range.start)}&to=${localDateKey(range.end)}&limit=2000`);
    if (sequence !== state.calendarLoadSequence) return;
    state.calendarItems = items;
    if (mode === 'week') renderWeek(range);
    else renderMonth(range);
  }
  if (sequence === state.calendarLoadSequence) await loadCalendarContext();
}

function renderMonth(range) {
  $('#calendar-title').textContent = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(state.calendarDate);
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const today = localDateKey(new Date());
  const parts = weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`);
  for (let current = new Date(range.start); current <= range.end; current.setDate(current.getDate() + 1)) {
    const day = new Date(current);
    const key = localDateKey(day);
    const events = eventsForDate(state.calendarItems, key);
    const classes = ['calendar-day'];
    if (day.getMonth() !== state.calendarDate.getMonth()) classes.push('outside');
    if (key === today) classes.push('today');
    parts.push(`<div class="${classes.join(' ')}" data-calendar-date="${key}">
      <div class="day-header"><span class="day-number">${day.getDate()}</span><button class="day-add" type="button" data-new-on-date="${key}" aria-label="Создать на ${escapeHtml(dateLabel(key))}">+</button></div>
      ${events.slice(0, 4).map((event) => calendarEventHtml(event)).join('')}
      ${events.length > 4 ? `<div class="more-events">Ещё ${events.length - 4}</div>` : ''}
    </div>`);
  }
  $('#month-view').innerHTML = `<div class="month-grid">${parts.join('')}</div>`;
}

function renderWeek(range) {
  const today = localDateKey(new Date());
  $('#calendar-title').textContent = `${dateLabel(localDateKey(range.start), { short: true })} — ${dateLabel(localDateKey(range.end), { short: true })}`;
  const columns = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(range.start);
    day.setDate(day.getDate() + offset);
    const key = localDateKey(day);
    const events = eventsForDate(state.calendarItems, key);
    columns.push(`<section class="week-day ${key === today ? 'today' : ''}" data-calendar-date="${key}">
      <header class="week-day-head"><strong>${day.getDate()}</strong><span>${escapeHtml(shortWeekday(day))}</span></header>
      <div class="week-events">
        ${events.length ? events.map((event) => `<button class="week-event" type="button" data-calendar-item="${escapeHtml(event.id)}"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(timeLabel(event.starts_at))} · ${escapeHtml(categoryLabels[event.category] || event.category)}</span></button>`).join('') : '<div class="empty-state">Нет записей</div>'}
        <button class="quiet-button" type="button" data-new-on-date="${key}">+ Добавить</button>
      </div>
    </section>`);
  }
  $('#week-view').innerHTML = `<div class="week-grid">${columns.join('')}</div>`;
}

function taskGroup(title, items, className = '') {
  if (!items.length) return '';
  return `<section class="task-group ${className}"><div class="task-group-title"><strong>${escapeHtml(title)}</strong><span class="count-pill">${items.length}</span></div>${items.map((item) => `<article class="task-row ${item.status === 'completed' ? 'completed' : ''}">
    <button class="task-check" type="button" data-complete-task="${escapeHtml(item.id)}" aria-label="${item.status === 'completed' ? 'Вернуть задачу' : 'Отметить задачу выполненной'}">${item.status === 'completed' ? '✓' : ''}</button>
    <button class="text-button task-copy" type="button" data-calendar-item="${escapeHtml(item.id)}"><span class="task-title">${escapeHtml(item.title)}</span><span class="task-meta">${escapeHtml(categoryLabels[item.category] || item.category)}${item.description ? ` · ${escapeHtml(item.description)}` : ''}</span></button>
    <time class="task-date">${escapeHtml(dateLabel(item.starts_at, { short: true, year: false }))}</time>
  </article>`).join('')}</section>`;
}

function renderTasks() {
  const today = localDateKey(new Date());
  const open = state.tasks.filter((item) => item.status !== 'completed' && item.status !== 'cancelled');
  const overdue = open.filter((item) => String(item.starts_at).slice(0, 10) < today);
  const todayItems = open.filter((item) => String(item.starts_at).slice(0, 10) === today);
  const upcoming = open.filter((item) => String(item.starts_at).slice(0, 10) > today);
  const completed = state.tasks.filter((item) => item.status === 'completed').slice(-20).reverse();
  $('#tasks-view').innerHTML = [
    taskGroup('Просрочено', overdue, 'overdue'),
    taskGroup('Сегодня', todayItems),
    taskGroup('Предстоящие', upcoming),
    taskGroup('Выполнено', completed)
  ].filter(Boolean).join('') || '<div class="empty-state">Задач пока нет. Создайте первую задачу кнопкой «Создать».</div>';
}

async function loadCalendarContext() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 7);
  const [calendar, reviews] = await Promise.all([
    api(`/api/calendar?from=${localDateKey(today)}&to=${localDateKey(end)}&limit=100`),
    api('/api/review?status=open')
  ]);
  state.reviewItems = reviews.items;
  renderCalendarContext(calendar.items, reviews.items);
  updateReviewBadge(reviews.items.length);
}

function compactItems(items, emptyText) {
  return items.length ? items.map((item) => `<div class="compact-item"><div class="compact-time">${escapeHtml(timeLabel(item.starts_at))}</div><div><div class="compact-title">${escapeHtml(item.title)}</div><div class="compact-meta">${escapeHtml(categoryLabels[item.category] || item.category)}</div></div></div>`).join('') : `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
}

function renderCalendarContext(items, reviews) {
  const today = localDateKey(new Date());
  const todayItems = items.filter((item) => String(item.starts_at).slice(0, 10) === today);
  $('#today-date').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date());
  $('#today-list').innerHTML = compactItems(todayItems, 'Сегодня ничего не запланировано.');
  $('#upcoming-list').innerHTML = compactItems(items.filter((item) => String(item.starts_at).slice(0, 10) > today).slice(0, 7), 'На ближайшие дни записей нет.');
  $('#upcoming-count').textContent = items.filter((item) => String(item.starts_at).slice(0, 10) > today).length;
  $('#calendar-attention').innerHTML = reviews.length ? reviews.slice(0, 3).map((item) => `<div class="compact-item"><div class="compact-time">Проверка</div><div><div class="compact-title">${escapeHtml(item.title)}</div><div class="compact-meta">${escapeHtml(item.proposed_action)}</div></div></div>`).join('') : '<div class="empty-state">Вопросов нет.</div>';
}

function openSheet(id) {
  $('#sheet-backdrop').classList.remove('hidden');
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSheets() {
  $('#sheet-backdrop').classList.add('hidden');
  $$('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  document.body.style.overflow = '';
}

function findCalendarItem(id) {
  return [...state.calendarItems, ...state.tasks].find((item) => item.id === id);
}

function openEventSheet(item = null, date = null) {
  $('#event-form').reset();
  $('#event-id').value = item?.id || '';
  $('#event-title').value = item?.title || '';
  $('#event-kind').value = item?.item_kind === 'task' || item?.source_kind === 'decision' ? 'task' : 'event';
  $('#event-date').value = String(item?.starts_at || date || localDateKey(new Date())).slice(0, 10);
  $('#event-category').value = item?.category || 'organizational';
  $('#event-importance').value = item?.importance || 'normal';
  $('#event-reminder').value = item?.reminder_minutes ?? '';
  $('#event-description').value = item?.description || '';
  $('#event-sheet-title').textContent = item ? (item.item_kind === 'task' ? 'Задача' : 'Событие') : 'Новая запись';
  openSheet('#event-sheet');
  requestAnimationFrame(() => $('#event-title').focus());
}

async function saveEvent(event) {
  event.preventDefault();
  const id = $('#event-id').value;
  const body = {
    title: $('#event-title').value.trim(),
    kind: $('#event-kind').value,
    startsAt: $('#event-date').value,
    category: $('#event-category').value,
    importance: $('#event-importance').value,
    reminderMinutes: $('#event-reminder').value === '' ? null : Number($('#event-reminder').value),
    description: $('#event-description').value.trim() || null,
    allDay: true
  };
  if (!body.title || !body.startsAt) return toast('Укажите название и дату.');
  if (id) await api(`/api/calendar/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  else await api('/api/calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  closeSheets();
  toast(id ? 'Изменения сохранены.' : body.kind === 'task' ? 'Задача добавлена.' : 'Событие добавлено.');
  await Promise.all([loadCalendar(), loadNotifications()]);
}

async function toggleTask(id) {
  const item = findCalendarItem(id);
  if (!item) return;
  await api(`/api/calendar/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: item.status === 'completed' ? 'open' : 'completed' })
  });
  await Promise.all([loadCalendar(), loadNotifications()]);
}

async function loadDocuments() {
  const { items } = await api('/api/documents');
  state.documents = items;
  renderDocuments();
  fillTemplateDocumentSelect();
}

function renderDocuments() {
  const target = $('#documents-table');
  if (!state.documents.length) {
    target.innerHTML = '<div class="empty-state">Добавьте DOCX, PDF, ODT или текстовый документ. После обработки его можно превратить в шаблон.</div>';
    return;
  }
  target.innerHTML = `<table><thead><tr><th>Документ</th><th>Тип</th><th>Состояние</th><th>Добавлен</th><th></th></tr></thead><tbody>${state.documents.map((item) => {
    const canTemplate = ['processed', 'needs_review'].includes(item.processing_status);
    return `<tr><td><div class="document-title">${escapeHtml(item.title)}</div><div class="list-meta">${escapeHtml(item.original_name)} · ${new Intl.NumberFormat('ru-RU').format(item.size_bytes)} байт</div></td><td>${escapeHtml(item.document_type)}</td><td><span class="status ${escapeHtml(item.processing_status)}">${escapeHtml(statusLabels[item.processing_status] || item.processing_status)}</span>${item.extraction_error ? `<div class="list-meta">${escapeHtml(item.extraction_error)}</div>` : ''}</td><td>${escapeHtml(dateLabel(item.created_at, { short: true }))}</td><td><div class="row-actions">${canTemplate ? `<button class="row-button" type="button" data-create-template="${escapeHtml(item.id)}">Создать шаблон</button>` : ''}</div></td></tr>`;
  }).join('')}</tbody></table>`;
}

async function uploadFiles(files) {
  if (!files.length) return;
  const progress = $('#upload-progress');
  progress.classList.remove('hidden');
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    progress.textContent = `Загрузка ${index + 1} из ${files.length}: ${file.name}`;
    try {
      await api('/api/documents', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'idempotency-key': `${file.name}:${file.size}:${file.lastModified}`
        },
        body: file
      });
    } catch (error) {
      toast(`${file.name}: ${error.message}`);
    }
  }
  progress.textContent = 'Документы приняты. Можно продолжать работу — обработка идёт на сервере.';
  setTimeout(() => progress.classList.add('hidden'), 3500);
  await loadDocuments();
}

async function loadTemplates() {
  const { items } = await api('/api/templates');
  state.templates = items;
  renderTemplates();
  if (!state.documents.length) await loadDocuments();
}

function renderTemplates() {
  const target = $('#templates-grid');
  target.innerHTML = state.templates.length ? state.templates.map((item) => `<article class="template-card">
    <div class="template-card-head"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.source_document_title || 'Исходный документ не указан')}</p></div><span class="status ${escapeHtml(item.status)}">${item.status === 'active' ? 'Активен' : escapeHtml(item.status)}</span></div>
    <div class="template-stats"><div class="template-stat"><strong>${item.fields?.length ?? item.field_count ?? 0}</strong><span>полей</span></div><div class="template-stat"><strong>${item.usage_count}</strong><span>применений</span></div><div class="template-stat"><strong>v${item.version}</strong><span>версия</span></div></div>
  </article>`).join('') : '<div class="empty-state">Шаблонов пока нет. Выберите обработанный документ и нажмите «Создать шаблон».</div>';
}

function fillTemplateDocumentSelect(preferredId = null) {
  const select = $('#template-document-select');
  const ready = state.documents.filter((item) => ['processed', 'needs_review'].includes(item.processing_status));
  select.innerHTML = ready.length ? ready.map((item) => `<option value="${escapeHtml(item.id)}" ${preferredId === item.id ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('') : '<option value="">Нет обработанных документов</option>';
}

function resetTemplateWizard(documentId = null) {
  state.template = { step: 1, source: null, fields: [], selectedLine: null, preview: null };
  $('#template-name').value = '';
  $('#template-document-type').value = 'custom_document';
  $('#matcher-filename').value = '';
  $('#matcher-phrases').value = '';
  $('#template-preview-result').innerHTML = 'Сначала выполните проверку.';
  $('#template-preview-result').className = 'template-preview-result empty-state';
  $('#template-document-preview').innerHTML = 'Текст появится здесь. Оригинальный файл не изменяется.';
  $('#template-document-preview').className = 'document-preview empty-state';
  fillTemplateDocumentSelect(documentId);
  renderTemplateFields();
  setWizardStep(1);
}

async function beginTemplateWizard(documentId = null) {
  if (!state.documents.length) await loadDocuments();
  resetTemplateWizard(documentId);
  openSheet('#template-sheet');
  if (documentId) await loadTemplateSource(documentId);
}

async function loadTemplateSource(documentId = $('#template-document-select').value) {
  if (!documentId) return toast('Сначала добавьте и обработайте документ.');
  const source = await api(`/api/templates/source?documentId=${encodeURIComponent(documentId)}`);
  state.template.source = source;
  state.template.fields = [];
  state.template.selectedLine = null;
  $('#template-document-select').value = documentId;
  $('#template-name').value = `${source.title} · шаблон`;
  $('#template-document-title').textContent = source.title;
  $('#template-selection-hint').textContent = 'Щёлкните строку, которую нужно извлекать';
  renderDocumentPreview(source.lines);
  renderTemplateFields();
  setWizardStep(2);
}

function renderDocumentPreview(lines) {
  const target = $('#template-document-preview');
  target.className = 'document-preview';
  target.innerHTML = lines.map((line) => `<div class="document-line" data-line-number="${line.number}"><span class="line-number">${line.number}</span><span class="line-text">${escapeHtml(line.text || ' ')}</span></div>`).join('');
}

function suggestAnchor(text) {
  const source = String(text || '').trim();
  const colon = source.search(/[:：]/);
  if (colon > 0 && colon < 80) return source.slice(0, colon + 1).trim();
  const dash = source.search(/\s[—–-]\s/);
  if (dash > 0 && dash < 80) return source.slice(0, dash).trim();
  return source.split(/\s+/).slice(0, 5).join(' ');
}

function selectTemplateLine(number) {
  const line = state.template.source?.lines.find((item) => item.number === Number(number));
  if (!line) return;
  state.template.selectedLine = line;
  $$('.document-line').forEach((element) => element.classList.toggle('selected', Number(element.dataset.lineNumber) === line.number));
  $('#selected-line-card').textContent = line.text || 'Пустая строка';
  $('#field-editor').classList.remove('hidden');
  const anchor = suggestAnchor(line.text);
  $('#field-anchor').value = anchor;
  $('#field-label').value = anchor.replace(/[:：—–-]+$/, '').trim();
  $('#field-strategy').value = line.text.includes(':') ? 'after_label' : 'line';
  $('#field-type').value = /дат|срок/i.test(anchor) ? 'date' : 'string';
  $('#field-required').checked = true;
  $('#end-anchor-field').classList.add('hidden');
  requestAnimationFrame(() => $('#field-label').focus());
}

function slugKey(value, index) {
  const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  const translit = [...String(value || '').toLocaleLowerCase('ru-RU')].map((char) => map[char] ?? char).join('');
  const key = translit.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return key || `field_${index + 1}`;
}

function addTemplateField() {
  if (!state.template.selectedLine) return toast('Щёлкните строку документа.');
  const label = $('#field-label').value.trim();
  const anchor = $('#field-anchor').value.trim();
  if (!label || !anchor) return toast('Назовите поле и укажите подпись.');
  const strategy = $('#field-strategy').value;
  state.template.fields.push({
    key: slugKey(label, state.template.fields.length),
    label,
    type: $('#field-type').value,
    strategy,
    anchor,
    endAnchor: strategy === 'between' ? $('#field-end-anchor').value.trim() : null,
    required: $('#field-required').checked,
    sample: state.template.selectedLine.text
  });
  renderTemplateFields();
  $('#field-editor').classList.add('hidden');
  $('.document-line.selected')?.classList.remove('selected');
  state.template.selectedLine = null;
  toast(`Поле «${label}» добавлено.`);
}

function renderTemplateFields() {
  $('#field-count').textContent = state.template.fields.length;
  $('#template-fields').innerHTML = state.template.fields.map((field, index) => `<div class="template-field"><div><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.anchor)} · ${escapeHtml(field.strategy)} · ${escapeHtml(field.type)}</span></div><button class="remove-field" type="button" data-remove-field="${index}" aria-label="Удалить поле">×</button></div>`).join('');
}

function setWizardStep(step) {
  state.template.step = Math.max(1, Math.min(3, Number(step)));
  $$('.wizard-step').forEach((button) => button.classList.toggle('active', Number(button.dataset.wizardStep) === state.template.step));
  $$('.wizard-panel').forEach((panel, index) => panel.classList.toggle('active', index + 1 === state.template.step));
  $('#wizard-back').disabled = state.template.step === 1;
  $('#wizard-next').classList.toggle('hidden', state.template.step === 3);
  $('#save-template').classList.toggle('hidden', state.template.step !== 3);
  if (state.template.step === 3 && !$('#matcher-phrases').value.trim()) {
    $('#matcher-phrases').value = [...new Set(state.template.fields.map((field) => field.anchor).filter(Boolean))].slice(0, 4).join('\n');
  }
}

function currentTemplatePayload() {
  return {
    documentVersionId: state.template.source?.version_id,
    name: $('#template-name').value.trim(),
    documentType: $('#template-document-type').value.trim() || 'custom_document',
    matcher: {
      filenameContains: $('#matcher-filename').value.trim(),
      requiredPhrases: $('#matcher-phrases').value.split('\n').map((value) => value.trim()).filter(Boolean)
    },
    fields: state.template.fields
  };
}

async function previewCurrentTemplate() {
  if (!state.template.source) return toast('Выберите документ.');
  if (!state.template.fields.length) return toast('Добавьте хотя бы одно поле.');
  const preview = await api('/api/templates/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentTemplatePayload())
  });
  state.template.preview = preview.result;
  renderTemplatePreview(preview.result);
  return preview.result;
}

function renderTemplatePreview(result) {
  const fieldMap = new Map(state.template.fields.map((field) => [field.key, field.label]));
  const values = Object.entries(result.values || {});
  const missing = result.missing || [];
  $('#template-preview-result').className = 'template-preview-result';
  $('#template-preview-result').innerHTML = `${values.map(([key, value]) => `<div class="preview-value"><strong>${escapeHtml(fieldMap.get(key) || key)}</strong><span>${escapeHtml(typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : value)}</span></div>`).join('')}${missing.map((item) => `<div class="preview-value preview-missing"><strong>${escapeHtml(item.label)}</strong><span>Не найдено</span></div>`).join('')}<div class="list-meta">Уверенность: ${Math.round((result.confidence || 0) * 100)}%</div>`;
}

async function saveCurrentTemplate() {
  const payload = currentTemplatePayload();
  if (!payload.name) return toast('Назовите шаблон.');
  if (!payload.fields.length) return toast('Добавьте хотя бы одно поле.');
  if (!state.template.preview) await previewCurrentTemplate();
  await api('/api/templates', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  closeSheets();
  toast('Шаблон сохранён. Следующие похожие документы будут обработаны автоматически.');
  await Promise.all([loadTemplates(), loadDocuments(), loadReview()]);
}

async function loadReview() {
  const { items } = await api('/api/review?status=open');
  state.reviewItems = items;
  updateReviewBadge(items.length);
  $('#review-list').innerHTML = items.length ? items.map((item) => `<article class="review-card"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.explanation)}</p><p class="review-action">Что сделать: ${escapeHtml(item.proposed_action)}</p></div><button class="secondary-button" type="button" data-resolve-review="${escapeHtml(item.id)}">Готово</button></article>`).join('') : '<div class="empty-state">Все текущие вопросы разобраны.</div>';
}

function updateReviewBadge(count) {
  $('#review-badge').textContent = count;
  $('#review-badge').classList.toggle('hidden', count === 0);
}

async function loadNotifications() {
  const data = await api('/api/notifications?limit=100');
  state.notifications = data.items;
  $('#notification-badge').textContent = data.unread;
  $('#notification-badge').classList.toggle('hidden', data.unread === 0);
  renderNotifications();
}

function renderNotifications() {
  $('#notification-list').innerHTML = state.notifications.length ? state.notifications.map((item) => `<article class="notification-item ${item.read ? 'read' : ''}"><span class="notification-dot"></span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p><time>${escapeHtml(dateLabel(item.notifyAt, { short: true }))}</time></div><div class="notification-actions">${!item.read ? `<button type="button" data-notification-action="read" data-notification-key="${escapeHtml(item.key)}" aria-label="Прочитано">✓</button>` : ''}<button type="button" data-notification-action="dismiss" data-notification-key="${escapeHtml(item.key)}" aria-label="Скрыть">×</button></div></article>`).join('') : '<div class="empty-state">Новых уведомлений нет.</div>';
}

async function changeNotification(key, action) {
  await api('/api/notifications/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, action }) });
  await loadNotifications();
}

async function performSearch(query) {
  const target = $('#search-results');
  target.innerHTML = '<div class="empty-state">Поиск…</div>';
  const { items } = await api(`/api/search?q=${encodeURIComponent(query)}`);
  target.innerHTML = items.length ? items.map((item) => `<article class="search-result"><h3>${escapeHtml(item.title)}</h3><p>${safeSnippet(item.snippet)}</p><div class="list-meta">Источник: ${escapeHtml(item.source_kind)}</div></article>`).join('') : '<div class="empty-state">Совпадений не найдено. Попробуйте другую формулировку.</div>';
}

async function refreshShell() {
  await Promise.allSettled([loadHealth(), loadNotifications(), loadReview()]);
}

$('#navigation').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});
$('.mobile-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});
$('#calendar-mode-switch').addEventListener('click', (event) => {
  const button = event.target.closest('[data-calendar-mode]');
  if (button) setCalendarMode(button.dataset.calendarMode);
});

document.body.addEventListener('click', async (event) => {
  const openView = event.target.closest('[data-open-view]');
  if (openView) setView(openView.dataset.openView);
  const newOnDate = event.target.closest('[data-new-on-date]');
  if (newOnDate) openEventSheet(null, newOnDate.dataset.newOnDate);
  const calendarButton = event.target.closest('[data-calendar-item]');
  if (calendarButton) openEventSheet(findCalendarItem(calendarButton.dataset.calendarItem));
  const taskButton = event.target.closest('[data-complete-task]');
  if (taskButton) await toggleTask(taskButton.dataset.completeTask);
  const createTemplateButton = event.target.closest('[data-create-template]');
  if (createTemplateButton) await beginTemplateWizard(createTemplateButton.dataset.createTemplate);
  const line = event.target.closest('[data-line-number]');
  if (line) selectTemplateLine(line.dataset.lineNumber);
  const removeField = event.target.closest('[data-remove-field]');
  if (removeField) {
    state.template.fields.splice(Number(removeField.dataset.removeField), 1);
    state.template.preview = null;
    renderTemplateFields();
  }
  const resolveButton = event.target.closest('[data-resolve-review]');
  if (resolveButton) {
    await api(`/api/review/${encodeURIComponent(resolveButton.dataset.resolveReview)}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'acknowledged' }) });
    await Promise.all([loadReview(), loadCalendarContext()]);
  }
  const notificationAction = event.target.closest('[data-notification-action]');
  if (notificationAction) await changeNotification(notificationAction.dataset.notificationKey, notificationAction.dataset.notificationAction);
  if (event.target.closest('[data-close-sheet]') || event.target === $('#sheet-backdrop')) closeSheets();
});

$('#event-form').addEventListener('submit', saveEvent);
$('#file-input').addEventListener('change', (event) => uploadFiles([...event.target.files]));
$('#create-button').addEventListener('click', () => openEventSheet());
$('#template-from-document').addEventListener('click', () => beginTemplateWizard());
$('#template-load-document').addEventListener('click', () => loadTemplateSource());
$('#add-template-field').addEventListener('click', addTemplateField);
$('#field-strategy').addEventListener('change', () => $('#end-anchor-field').classList.toggle('hidden', $('#field-strategy').value !== 'between'));
$('#wizard-back').addEventListener('click', () => setWizardStep(state.template.step - 1));
$('#wizard-next').addEventListener('click', async () => {
  if (state.template.step === 1 && !state.template.source) return loadTemplateSource();
  if (state.template.step === 2 && !state.template.fields.length) return toast('Добавьте хотя бы одно поле.');
  setWizardStep(state.template.step + 1);
  if (state.template.step === 3) await previewCurrentTemplate();
});
$('#preview-template').addEventListener('click', previewCurrentTemplate);
$('#save-template').addEventListener('click', saveCurrentTemplate);
$('#previous-period').addEventListener('click', () => {
  if (state.calendarMode === 'month') state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
  else state.calendarDate.setDate(state.calendarDate.getDate() - 7);
  runCalendarLoad();
});
$('#next-period').addEventListener('click', () => {
  if (state.calendarMode === 'month') state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
  else state.calendarDate.setDate(state.calendarDate.getDate() + 7);
  runCalendarLoad();
});
$('#today-period').addEventListener('click', () => { state.calendarDate = new Date(); runCalendarLoad(); });
$('#notification-button').addEventListener('click', () => {
  const popover = $('#notification-popover');
  const opening = popover.classList.contains('hidden');
  popover.classList.toggle('hidden', !opening);
  $('#notification-button').setAttribute('aria-expanded', String(opening));
});
$('#open-search').addEventListener('click', () => setView('search'));
$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = $('#search-input').value.trim();
  if (query) performSearch(query);
});
$('#collapse-sidebar').addEventListener('click', () => document.body.classList.add('sidebar-hidden'));
$('#show-sidebar').addEventListener('click', () => {
  if (window.matchMedia('(max-width: 720px)').matches) document.body.classList.toggle('mobile-sidebar-open');
  else document.body.classList.remove('sidebar-hidden');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('.sheet:not(.hidden)')) {
      $('#notification-popover').classList.add('hidden');
      if (state.currentView === 'search' && $('#search-input').value) $('#search-input').value = '';
    } else closeSheets();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault();
    setView('search');
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'n') {
    event.preventDefault();
    openEventSheet();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.popover-anchor')) {
    $('#notification-popover').classList.add('hidden');
    $('#notification-button').setAttribute('aria-expanded', 'false');
  }
});

setCalendarMode(state.calendarMode);
refreshShell();
state.refreshTimer = setInterval(refreshShell, 30_000);
