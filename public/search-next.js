const searchState = { timer: null, request: 0, controller: null };
const qs = (selector, root = document) => root.querySelector(selector);

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
  const query = qs('#search-input')?.value.trim() || '';
  if (query) params.set('q', query);
  for (const [key, value] of new FormData(form)) if (String(value).trim()) params.set(key, String(value).trim());
  params.set('limit', '100');
  return params;
}

function hasCriteria(params) {
  return [...params.keys()].some((key) => key !== 'limit');
}

function renderEmptyPrompt() {
  const target = qs('#search-results');
  const count = qs('#search-count');
  if (count) count.textContent = '';
  if (target) {
    target.className = 'search-results empty-state';
    target.textContent = 'Введите текст или выберите один из фильтров.';
  }
}

function cancelPendingSearch() {
  clearTimeout(searchState.timer);
  searchState.timer = null;
  searchState.controller?.abort();
  searchState.controller = null;
}

async function performSearch() {
  clearTimeout(searchState.timer);
  searchState.timer = null;
  const params = activeFilters();
  const target = qs('#search-results');
  const sequence = ++searchState.request;
  searchState.controller?.abort();
  searchState.controller = null;
  if (!hasCriteria(params)) {
    renderEmptyPrompt();
    return;
  }

  const controller = new AbortController();
  searchState.controller = controller;
  target.className = 'search-results empty-state';
  target.textContent = 'Поиск…';
  try {
    const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (sequence !== searchState.request || controller.signal.aborted) return;
    if (!response.ok) {
      target.textContent = payload?.error?.message || `Ошибка поиска (${response.status})`;
      return;
    }
    render(payload);
  } catch (error) {
    if (sequence !== searchState.request || controller.signal.aborted || error?.name === 'AbortError') return;
    target.className = 'search-results empty-state';
    target.textContent = 'Не удалось выполнить поиск. Проверьте соединение и повторите.';
    const count = qs('#search-count');
    if (count) count.textContent = '';
  } finally {
    if (searchState.controller === controller) searchState.controller = null;
  }
}

function scheduleSearch() {
  cancelPendingSearch();
  ++searchState.request;
  searchState.timer = setTimeout(() => {
    searchState.timer = null;
    performSearch();
  }, 220);
}

function resetSearch() {
  cancelPendingSearch();
  ++searchState.request;
  const query = qs('#search-input');
  if (query) query.value = '';
  const filters = qs('#search-filters');
  filters?.reset();
  if (filters) {
    for (const field of filters.querySelectorAll('input,select,textarea')) {
      if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) field.checked = false;
      else field.value = '';
    }
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  renderEmptyPrompt();
}

function submitSearch(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  performSearch();
}

ensureStyles();
ensureUi();

qs('#search-form')?.addEventListener('submit', submitSearch, true);
qs('#search-filters')?.addEventListener('submit', submitSearch, true);
qs('#search-input')?.addEventListener('input', scheduleSearch);
qs('#search-filters')?.addEventListener('input', scheduleSearch);
qs('#search-filters')?.addEventListener('change', scheduleSearch);
const resetButton = qs('[data-search-reset]');
let resetPointer = null;

function releaseResetPointer(event) {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  resetPointer = null;
}

resetButton?.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  resetPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  event.currentTarget.setPointerCapture?.(event.pointerId);
});
resetButton?.addEventListener('pointermove', (event) => {
  if (!resetPointer || resetPointer.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - resetPointer.x, event.clientY - resetPointer.y) > 12) resetPointer.moved = true;
});
resetButton?.addEventListener('pointerup', (event) => {
  if (!resetPointer || resetPointer.pointerId !== event.pointerId) return;
  const shouldReset = !resetPointer.moved;
  releaseResetPointer(event);
  if (shouldReset) resetSearch();
});
resetButton?.addEventListener('pointercancel', (event) => {
  if (resetPointer?.pointerId === event.pointerId) releaseResetPointer(event);
});
resetButton?.addEventListener('lostpointercapture', (event) => {
  if (resetPointer?.pointerId === event.pointerId) resetPointer = null;
});
resetButton?.addEventListener('click', (event) => {
  if (event.detail === 0 || !window.PointerEvent) resetSearch();
});
