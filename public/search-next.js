const searchState = { timer: null, request: 0 };
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function safeSnippet(value) {
  return escapeHtml(value)
    .replaceAll('&lt;mark&gt;', '<mark>')
    .replaceAll('&lt;/mark&gt;', '</mark>');
}

function ensureStyles() {
  if (qs('#search-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'search-next-styles'; link.rel = 'stylesheet'; link.href = '/search-next.css';
  document.head.append(link);
}

function ensureUi() {
  const form = qs('#search-form');
  if (!form || qs('#search-filters')) return;
  form.insertAdjacentHTML('afterend', `<form id="search-filters" class="search-filters">
    <label><span>Что искать</span><select name="sourceKind"><option value="">Везде</option><option value="document">Документы</option><option value="protocol">Протоколы и решения</option><option value="directive">Указы, приказы, распоряжения</option><option value="assignment">Поручения</option><option value="periodic_task">Периодические задачи</option><option value="plans">Планы и пункты</option><option value="science">Научные материалы</option></select></label>
    <label><span>Вид</span><input name="kind" placeholder="Приказ, статья, личный план…"></label>
    <label><span>Номер</span><input name="number" placeholder="Например, 47-р"></label>
    <label><span>Дата с</span><input name="from" type="date"></label>
    <label><span>Дата по</span><input name="to" type="date"></label>
    <label><span>Направление</span><select name="direction"><option value="">Любое</option><option value="science">Наука</option><option value="education">Образование</option><option value="organizational">Организация</option><option value="personnel">Кадры</option><option value="safety">Безопасность</option><option value="finance">Финансы</option><option value="digital">Цифровизация</option></select></label>
    <label><span>Человек</span><input name="person" placeholder="Фамилия или ФИО"></label>
    <label><span>Роль человека</span><select name="role"><option value="">Любая</option><option value="executor">Исполнитель</option><option value="controller">Контролирующий</option><option value="observer">Наблюдатель</option></select></label>
    <label><span>Состояние</span><select name="status"><option value="">Любое</option><option value="open">Открыто</option><option value="overdue">Просрочено</option><option value="submitted">Отчёт представлен</option><option value="rework">На доработке</option><option value="completed">Выполнено</option><option value="proposed">Предложено</option><option value="active">Действует</option></select></label>
    <label><span>Период</span><input name="period" placeholder="2026, 2026/27, семестр…"></label>
    <label><span>Отчёт</span><select name="report"><option value="">Не важно</option><option value="with">Есть отчёт</option><option value="without">Нет отчёта</option><option value="submitted">На проверке</option><option value="confirmed">Подтверждён</option></select></label>
    <div class="search-filter-actions"><button type="button" class="secondary-button" data-search-reset>Сбросить</button><span id="search-count"></span></div>
  </form>`);
}

function sourceLabel(kind) {
  return {
    document: 'Документ', meeting: 'Протокол', decision: 'Решение', directive: 'Основание',
    assignment: 'Поручение', periodic_task: 'Периодическая задача', plan: 'План',
    plan_item: 'Пункт плана', scientific_item: 'Научный материал', template_extraction: 'Извлечение'
  }[kind] || kind || 'Материал';
}

function statusLabel(value, overdue) {
  if (overdue) return 'Просрочено';
  return {
    open: 'Открыто', submitted: 'Отчёт представлен', rework: 'На доработке', completed: 'Выполнено',
    cancelled: 'Отменено', proposed: 'Предложено', processed: 'Обработано', active: 'Действует',
    approved: 'Подтверждено', confirmed: 'Подтверждено'
  }[value] || value || '';
}

function reportLabel(value) {
  return {
    none: 'без отчёта', attached: 'отчёт приложен', submitted: 'отчёт на проверке',
    rework: 'отчёт на доработке', confirmed: 'отчёт подтверждён', required: 'требуется отчёт',
    not_required: 'отчёт не требуется'
  }[value] || '';
}

function metaParts(item) {
  const parts = [sourceLabel(item.source_kind)];
  if (item.kind && item.kind !== item.source_kind) parts.push(item.kind);
  if (item.number) parts.push(`№ ${item.number}`);
  if (item.event_date) parts.push(item.event_date);
  if (item.period) parts.push(item.period);
  if (item.direction) parts.push(item.direction);
  if (item.executor) parts.push(`Исполнитель: ${item.executor}`);
  if (item.controller) parts.push(`Контроль: ${item.controller}`);
  if (item.status || item.overdue) parts.push(statusLabel(item.status, item.overdue));
  if (item.report_state) parts.push(reportLabel(item.report_state));
  return parts.filter(Boolean);
}

function render(payload) {
  const target = qs('#search-results');
  const count = qs('#search-count');
  if (count) count.textContent = payload.total ? `Найдено: ${payload.total}` : '';
  if (!payload.items?.length) {
    target.className = 'search-results empty-state';
    target.textContent = 'Совпадений не найдено. Сбросьте часть фильтров или измените формулировку.';
    return;
  }
  target.className = 'search-results';
  target.innerHTML = payload.items.map((item) => `<article class="search-result search-result-next${item.overdue ? ' overdue' : ''}">
    <div class="search-result-head"><div><span class="search-kind">${escapeHtml(sourceLabel(item.source_kind))}</span><h3>${escapeHtml(item.title)}</h3></div>${item.source_document_id ? `<a class="secondary-button" href="/api/documents/${encodeURIComponent(item.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Оригинал</a>` : ''}</div>
    <p>${safeSnippet(item.snippet || '')}</p>
    <div class="search-meta">${metaParts(item).map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>
  </article>`).join('');
}

function activeFilters() {
  const form = qs('#search-filters');
  const params = new URLSearchParams();
  const q = qs('#search-input')?.value.trim() || '';
  if (q) params.set('q', q);
  for (const [key, value] of new FormData(form)) if (String(value).trim()) params.set(key, String(value).trim());
  params.set('limit', '100');
  return params;
}

function hasCriteria(params) {
  return [...params.keys()].some((key) => key !== 'limit');
}

async function performSearch() {
  const params = activeFilters();
  const target = qs('#search-results');
  if (!hasCriteria(params)) {
    qs('#search-count').textContent = '';
    target.className = 'search-results empty-state';
    target.textContent = 'Введите текст или выберите один из фильтров.';
    return;
  }
  const sequence = ++searchState.request;
  target.className = 'search-results empty-state';
  target.textContent = 'Поиск…';
  const response = await fetch(`/api/search?${params}`);
  const payload = await response.json().catch(() => ({}));
  if (sequence !== searchState.request) return;
  if (!response.ok) {
    target.textContent = payload?.error?.message || `Ошибка поиска (${response.status})`;
    return;
  }
  render(payload);
}

function scheduleSearch() {
  clearTimeout(searchState.timer);
  searchState.timer = setTimeout(() => performSearch().catch(() => {}), 220);
}

ensureStyles();
ensureUi();

qs('#search-form')?.addEventListener('submit', (event) => {
  event.preventDefault(); event.stopImmediatePropagation();
  performSearch().catch(() => {});
}, true);
qs('#search-input')?.addEventListener('input', scheduleSearch);
qs('#search-filters')?.addEventListener('input', scheduleSearch);
qs('#search-filters')?.addEventListener('change', () => performSearch().catch(() => {}));
qs('[data-search-reset]')?.addEventListener('click', () => {
  qs('#search-form')?.reset(); qs('#search-filters')?.reset(); performSearch().catch(() => {});
});
