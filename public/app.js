const state = {
  currentView: 'overview',
  calendarDate: new Date(),
  calendarItems: [],
  refreshTimer: null
};

const viewMeta = {
  overview: ['Обзор', 'Ближайшие сроки, новые документы и вопросы оператору'],
  documents: ['Документы', 'Единое хранилище оригиналов и результатов обработки'],
  calendar: ['Календарь', 'События, заседания, поручения и контрольные сроки'],
  review: ['Проверка данных', 'Только вопросы, которые действительно требуют решения'],
  search: ['Поиск', 'По документам, решениям, заседаниям и смысловым фрагментам']
};

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

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 4500);
}

function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  const [title, subtitle] = viewMeta[view];
  document.querySelector('#page-title').textContent = title;
  document.querySelector('#page-subtitle').textContent = subtitle;
  if (view === 'documents') loadDocuments();
  if (view === 'calendar') loadCalendar();
  if (view === 'review') loadReview();
}

function dateLabel(value) {
  if (!value) return 'Дата не указана';
  const date = new Date(`${value.length === 10 ? `${value}T00:00:00` : value}`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

async function loadHealth() {
  try {
    const health = await api('/api/system/health');
    const dot = document.querySelector('#health-dot');
    dot.className = `dot ${health.status === 'ok' ? 'ok' : 'error'}`;
    document.querySelector('#health-text').textContent = health.status === 'ok' ? `Система работает · схема ${health.schemaVersion}` : 'Требуется проверка системы';
  } catch {
    document.querySelector('#health-dot').className = 'dot error';
    document.querySelector('#health-text').textContent = 'Сервер недоступен';
  }
}

async function loadOverview() {
  const [overview, calendar, reviews] = await Promise.all([
    api('/api/overview'),
    api('/api/calendar?limit=8'),
    api('/api/review?status=open')
  ]);
  const metrics = [
    ['Документы', overview.documents],
    ['Заседания', overview.meetings],
    ['Нужна проверка', overview.reviewOpen],
    ['Предстоящие сроки', overview.upcoming],
    ['В обработке', overview.queuedJobs]
  ];
  document.querySelector('#overview-cards').innerHTML = metrics.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
  document.querySelector('#review-badge').textContent = overview.reviewOpen;
  document.querySelector('#review-badge').classList.toggle('hidden', overview.reviewOpen === 0);

  const calendarElement = document.querySelector('#overview-calendar');
  calendarElement.innerHTML = calendar.items.length
    ? calendar.items.slice(0, 8).map((item) => `<div class="list-row"><div class="list-date">${escapeHtml(dateLabel(item.starts_at))}</div><div><div class="list-title">${escapeHtml(item.title)}</div><div class="list-meta">${escapeHtml(item.category)} · ${escapeHtml(item.status)}</div></div></div>`).join('')
    : '<div class="empty-state">Событий пока нет.</div>';

  const reviewElement = document.querySelector('#overview-review');
  reviewElement.innerHTML = reviews.items.length
    ? reviews.items.slice(0, 6).map((item) => `<div class="list-row"><div class="list-date">Проверка</div><div><div class="list-title">${escapeHtml(item.title)}</div><div class="list-meta">${escapeHtml(item.proposed_action)}</div></div></div>`).join('')
    : '<div class="empty-state">Очередь проверки пуста.</div>';
}

async function loadDocuments() {
  const { items } = await api('/api/documents');
  const target = document.querySelector('#documents-table');
  if (!items.length) {
    target.innerHTML = '<div class="empty-state">Добавьте DOCX, PDF, ODT или текстовые документы. Протоколы будут разобраны автоматически.</div>';
    return;
  }
  target.innerHTML = `<table><thead><tr><th>Документ</th><th>Тип</th><th>Состояние</th><th>Формат</th><th>Размер</th><th>Добавлен</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><div class="list-meta">${escapeHtml(item.original_name)}</div></td><td>${escapeHtml(item.document_type)}</td><td><span class="status ${escapeHtml(item.processing_status)}">${escapeHtml(item.processing_status)}</span>${item.extraction_error ? `<div class="list-meta">${escapeHtml(item.extraction_error)}</div>` : ''}</td><td>${escapeHtml(item.detected_format)}</td><td>${new Intl.NumberFormat('ru-RU').format(item.size_bytes)} байт</td><td>${escapeHtml(dateLabel(item.created_at))}</td></tr>`).join('')}</tbody></table>`;
}

async function uploadFiles(files) {
  const progress = document.querySelector('#upload-progress');
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
  progress.textContent = 'Документы приняты. Обработка выполняется на сервере.';
  setTimeout(() => progress.classList.add('hidden'), 3000);
  await Promise.all([loadOverview(), loadDocuments()]);
}

function monthRange(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = new Date(first);
  const weekday = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - weekday);
  const end = new Date(last);
  const tail = 6 - ((last.getDay() + 6) % 7);
  end.setDate(last.getDate() + tail);
  return { start, end };
}

async function loadCalendar() {
  const { start, end } = monthRange(state.calendarDate);
  const from = localDateKey(start);
  const to = localDateKey(end);
  const { items } = await api(`/api/calendar?from=${from}&to=${to}&limit=2000`);
  state.calendarItems = items;
  renderCalendar();
}

function renderCalendar() {
  const { start, end } = monthRange(state.calendarDate);
  document.querySelector('#calendar-title').textContent = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(state.calendarDate);
  const days = [];
  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) days.push(new Date(current));
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const today = localDateKey(new Date());
  const html = weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`);
  for (const day of days) {
    const iso = localDateKey(day);
    const events = state.calendarItems.filter((item) => item.starts_at.slice(0, 10) === iso);
    const classes = ['calendar-day'];
    if (day.getMonth() !== state.calendarDate.getMonth()) classes.push('outside');
    if (iso === today) classes.push('today');
    html.push(`<div class="${classes.join(' ')}"><span class="day-number">${day.getDate()}</span>${events.slice(0, 4).map((event) => `<div class="calendar-event ${escapeHtml(event.importance)}" title="${escapeHtml(event.description || event.title)}">${escapeHtml(event.title)}</div>`).join('')}${events.length > 4 ? `<div class="list-meta">Ещё ${events.length - 4}</div>` : ''}</div>`);
  }
  document.querySelector('#calendar-grid').innerHTML = html.join('');
}

async function loadReview() {
  const { items } = await api('/api/review?status=open');
  const target = document.querySelector('#review-list');
  target.innerHTML = items.length
    ? items.map((item) => `<article class="review-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.explanation)}</p><p class="review-action">Действие: ${escapeHtml(item.proposed_action)}</p><button data-resolve-review="${escapeHtml(item.id)}">Отметить решённым</button></article>`).join('')
    : '<div class="empty-state">Все текущие вопросы разобраны.</div>';
}

async function performSearch(query) {
  const target = document.querySelector('#search-results');
  target.innerHTML = '<div class="empty-state">Поиск…</div>';
  const { items } = await api(`/api/search?q=${encodeURIComponent(query)}`);
  target.innerHTML = items.length
    ? items.map((item) => `<article class="search-result"><h3>${escapeHtml(item.title)}</h3><p>${safeSnippet(item.snippet)}</p><div class="list-meta">${escapeHtml(item.source_kind)}</div></article>`).join('')
    : '<div class="empty-state">Совпадений не найдено.</div>';
}

document.querySelector('#navigation').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});
document.body.addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-view]');
  if (open) setView(open.dataset.openView);
  const resolveButton = event.target.closest('[data-resolve-review]');
  if (resolveButton) {
    await api(`/api/review/${encodeURIComponent(resolveButton.dataset.resolveReview)}/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'acknowledged' })
    });
    await Promise.all([loadReview(), loadOverview()]);
  }
});
document.querySelector('#file-input').addEventListener('change', (event) => uploadFiles([...event.target.files]));
document.querySelector('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = document.querySelector('#search-input').value.trim();
  if (query) performSearch(query);
});
document.querySelector('#previous-month').addEventListener('click', () => { state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); loadCalendar(); });
document.querySelector('#next-month').addEventListener('click', () => { state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); loadCalendar(); });
document.querySelector('#today-month').addEventListener('click', () => { state.calendarDate = new Date(); loadCalendar(); });

async function refresh() {
  await Promise.allSettled([loadHealth(), loadOverview()]);
  if (state.currentView === 'documents') await loadDocuments().catch(() => {});
  if (state.currentView === 'review') await loadReview().catch(() => {});
}

refresh();
state.refreshTimer = setInterval(refresh, 15_000);
