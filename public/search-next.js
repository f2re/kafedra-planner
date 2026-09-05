const searchState = {
  timer: null,
  request: 0,
  controller: null,
  returnContext: null,
  returnPending: false,
  restoreAfterRender: null
};
const qs = (selector, root = document) => root.querySelector(selector);

const filterLabels = {
  kind: 'Вид', number: 'Номер', from: 'Дата с', to: 'Дата по', direction: 'Направление',
  person: 'Человек', role: 'Роль', status: 'Состояние', period: 'Период', report: 'Отчёт'
};

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

function ensureReturnAction() {
  if (qs('#search-return-action')) return;
  const openSearch = qs('#open-search');
  if (!openSearch) return;
  openSearch.insertAdjacentHTML('beforebegin', '<button id="search-return-action" class="secondary-button hidden" type="button">К поиску</button>');
}

function ensureUi() {
  const form = qs('#search-form');
  if (!form || qs('#search-filters')) return;
  form.insertAdjacentHTML('afterend', `<form id="search-filters" class="search-filters">
    <div class="search-filter-primary">
      <label class="search-type-filter"><span>Что искать</span><select name="sourceKind"><option value="">Везде</option><option value="document">Документы</option><option value="protocol">Протоколы и решения</option><option value="directive">Указы, приказы, распоряжения</option><option value="assignment">Поручения</option><option value="periodic_task">Периодические задачи</option><option value="plans">Планы и пункты</option><option value="science">Научные материалы</option></select></label>
      <div id="search-active-filters" class="search-active-filters" aria-label="Активные условия"></div>
      <span id="search-count" class="search-count"></span>
      <details id="search-more-filters" class="search-more-filters">
        <summary>Фильтры <span id="search-advanced-count"></span></summary>
        <div class="search-filter-grid">
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
        </div>
        <div class="search-filter-actions"><button type="button" class="secondary-button" data-search-reset>Сбросить условия</button></div>
      </details>
    </div>
  </form>`);
  renderActiveFilters();
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
    approved: 'Подтверждено', confirmed: 'Подтверждено', archived: 'Архив'
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
  const parts = [];
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

function routeAttributes(item) {
  if (!item.route?.kind || !item.route?.id) return '';
  return ` data-search-route-kind="${escapeHtml(item.route.kind)}" data-search-route-id="${escapeHtml(item.route.id)}" tabindex="0" role="button" aria-label="Открыть ${escapeHtml(item.title)}"`;
}

function resultKey(item) {
  return item.route?.kind && item.route?.id
    ? `${item.route.kind}:${item.route.id}`
    : `${item.source_kind}:${item.source_id}`;
}

function restorePosition() {
  const context = searchState.restoreAfterRender;
  if (!context) return;
  searchState.restoreAfterRender = null;
  requestAnimationFrame(() => {
    window.scrollTo({ top: Number(context.scrollY || 0), left: 0, behavior: 'auto' });
    const card = context.focusKey
      ? qs(`[data-search-result-key="${CSS.escape(context.focusKey)}"]`)
      : null;
    (card || qs('#search-input'))?.focus?.({ preventScroll: true });
  });
}

function render(payload) {
  const target = qs('#search-results');
  const count = qs('#search-count');
  if (count) count.textContent = payload.total ? `${payload.total}` : '';
  if (!payload.items?.length) {
    target.className = 'search-results empty-state';
    target.textContent = 'Совпадений не найдено. Сбросьте часть фильтров или измените формулировку.';
    restorePosition();
    return;
  }
  target.className = 'search-results';
  target.innerHTML = payload.items.map((item) => {
    const key = resultKey(item);
    const original = item.source_document_id
      ? `<a class="secondary-button search-original" href="/api/documents/${encodeURIComponent(item.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Оригинал</a>`
      : '';
    return `<article class="search-result search-result-next${item.overdue ? ' overdue' : ''}${item.route ? ' routable' : ''}" data-search-result-key="${escapeHtml(key)}"${routeAttributes(item)}>
      <div class="search-result-head"><div><span class="search-kind">${escapeHtml(sourceLabel(item.source_kind))}</span><h3>${escapeHtml(item.title)}</h3></div>${original}</div>
      <p>${safeSnippet(item.snippet || '')}</p>
      <div class="search-meta">${metaParts(item).map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>
      <div class="search-route-error hidden" role="status"></div>
    </article>`;
  }).join('');
  restorePosition();
}

function fieldDisplayValue(field) {
  if (field instanceof HTMLSelectElement) return field.selectedOptions[0]?.textContent?.trim() || field.value;
  return field.value;
}

function advancedFields() {
  return [...(qs('#search-filters')?.elements || [])].filter((field) => field?.name && field.name !== 'sourceKind');
}

function renderActiveFilters() {
  const target = qs('#search-active-filters');
  if (!target) return;
  const active = advancedFields().filter((field) => String(field.value || '').trim());
  target.innerHTML = active.map((field) => `<button type="button" class="search-filter-chip" data-search-clear-filter="${escapeHtml(field.name)}" title="Снять условие ${escapeHtml(filterLabels[field.name] || field.name)}"><span>${escapeHtml(filterLabels[field.name] || field.name)}:</span> ${escapeHtml(fieldDisplayValue(field))} <b aria-hidden="true">×</b></button>`).join('');
  const count = qs('#search-advanced-count');
  if (count) count.textContent = active.length ? `· ${active.length}` : '';
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
  renderActiveFilters();
  const params = activeFilters();
  const target = qs('#search-results');
  const sequence = ++searchState.request;
  searchState.controller?.abort();
  searchState.controller = null;
  if (!hasCriteria(params)) {
    renderEmptyPrompt();
    restorePosition();
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
  renderActiveFilters();
  searchState.timer = setTimeout(() => {
    searchState.timer = null;
    performSearch();
  }, 220);
}

function captureContext(card = null) {
  const form = qs('#search-filters');
  const fields = {};
  for (const field of form?.elements || []) if (field?.name) fields[field.name] = field.value;
  return {
    query: qs('#search-input')?.value || '',
    fields,
    advancedOpen: Boolean(qs('#search-more-filters')?.open),
    scrollY: window.scrollY,
    focusKey: card?.dataset.searchResultKey || null
  };
}

function updateReturnAction() {
  const button = qs('#search-return-action');
  if (!button) return;
  const currentView = document.querySelector('.nav-item.active[data-view], .mobile-tab.active[data-view]')?.dataset.view || '';
  button.classList.toggle('hidden', !searchState.returnPending || currentView === 'search');
}

function applyReturnContext() {
  const context = searchState.returnContext;
  if (!context) return;
  const query = qs('#search-input');
  if (query) query.value = context.query || '';
  const form = qs('#search-filters');
  for (const [key, value] of Object.entries(context.fields || {})) {
    const field = form?.elements.namedItem(key);
    if (field && 'value' in field) field.value = value;
  }
  const details = qs('#search-more-filters');
  if (details) details.open = Boolean(context.advancedOpen);
  searchState.restoreAfterRender = context;
  searchState.returnPending = false;
  updateReturnAction();
  renderActiveFilters();
  performSearch();
}

function returnToSearch() {
  if (typeof window.kafedraSetView === 'function') window.kafedraSetView('search');
  else qs('[data-view="search"]')?.click();
  applyReturnContext();
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
  qs('#search-more-filters')?.removeAttribute('open');
  searchState.returnContext = null;
  searchState.returnPending = false;
  updateReturnAction();
  renderActiveFilters();
  qs('#search-input')?.focus();
  renderEmptyPrompt();
}

function showRouteError(card, message) {
  const error = qs('.search-route-error', card);
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
  card.focus?.();
}

async function openResult(card) {
  if (!card?.dataset.searchRouteKind || !card.dataset.searchRouteId) return;
  searchState.returnContext = captureContext(card);
  searchState.returnPending = true;
  updateReturnAction();
  const route = { kind: card.dataset.searchRouteKind, id: card.dataset.searchRouteId };
  try {
    if (typeof window.kafedraOpenExactRoute !== 'function') throw new Error('Рабочая карточка ещё не готова.');
    const opened = await window.kafedraOpenExactRoute(route);
    if (!opened) throw new Error('Объект больше недоступен или находится в другом состоянии.');
    updateReturnAction();
  } catch (error) {
    searchState.returnPending = false;
    updateReturnAction();
    showRouteError(card, error?.message || 'Не удалось открыть рабочий объект.');
  }
}

function submitSearch(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  performSearch();
}

ensureStyles();
ensureUi();
ensureReturnAction();

qs('#search-form')?.addEventListener('submit', submitSearch, true);
qs('#search-filters')?.addEventListener('submit', submitSearch, true);
qs('#search-input')?.addEventListener('input', scheduleSearch);
qs('#search-filters')?.addEventListener('input', scheduleSearch);
qs('#search-filters')?.addEventListener('change', scheduleSearch);
qs('#search-return-action')?.addEventListener('click', returnToSearch);

qs('#search-results')?.addEventListener('click', (event) => {
  if (event.target.closest('a,button,input,select,textarea')) return;
  const card = event.target.closest('[data-search-route-kind][data-search-route-id]');
  if (card) openResult(card);
});
qs('#search-results')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('a,button,input,select,textarea')) return;
  const card = event.target.closest('[data-search-route-kind][data-search-route-id]');
  if (!card) return;
  event.preventDefault();
  openResult(card);
});

qs('#search-active-filters')?.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-search-clear-filter]');
  if (!chip) return;
  const field = qs('#search-filters')?.elements.namedItem(chip.dataset.searchClearFilter);
  if (field && 'value' in field) field.value = '';
  scheduleSearch();
});

const resetButton = qs('[data-search-reset]');
let resetPointer = null;
function releaseResetPointer(event) {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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

window.addEventListener('kafedra:view-changed', (event) => {
  updateReturnAction();
  if (event.detail?.view === 'search' && searchState.returnPending) applyReturnContext();
});
