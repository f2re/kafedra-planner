import {
  ACTIONS,
  ACTION_GROUPS,
  rankActions,
  recommendActions
} from '/action-registry.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const terminalDocumentStatuses = new Set(['processed', 'needs_review', 'failed']);
const localFrequencyKey = 'kafedra-action-center-frequency-v1';

const state = {
  open: false,
  context: {},
  query: '',
  uploadRequestedType: 'auto',
  uploadActionId: 'document.upload',
  returnFocus: null,
  bypassCreate: false,
  sessionFrequency: new Map(),
  uploadToken: 0
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function visible(element) {
  return Boolean(element && element.getClientRects().length && !element.hidden);
}

function currentView() {
  return $('.nav-item.active[data-view], .mobile-tab.active[data-view]')?.dataset.view || 'calendar';
}

function currentMonth() {
  return new Date().getMonth() + 1;
}

function readLocalFrequency() {
  try {
    const parsed = JSON.parse(localStorage.getItem(localFrequencyKey) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalFrequency(actionId) {
  try {
    const values = readLocalFrequency();
    values[actionId] = Number(values[actionId] || 0) + 1;
    localStorage.setItem(localFrequencyKey, JSON.stringify(values));
  } catch {}
}

function preferenceFrequency() {
  const values = {};
  const rows = window.kafedraUiPreferences?.ranking?.('action.center.action') || [];
  for (const row of rows) {
    if (typeof row === 'string') values[row] = Math.max(1, Number(values[row] || 0));
    else if (row?.value) values[row.value] = Number(row.count || 1);
  }
  for (const [id, count] of Object.entries(readLocalFrequency())) {
    values[id] = Math.max(Number(values[id] || 0), Number(count || 0));
  }
  for (const [id, count] of state.sessionFrequency) {
    values[id] = Math.max(Number(values[id] || 0), Number(count || 0));
  }
  return values;
}

function ensureStyles() {
  if ($('#action-center-styles')) return;
  const link = document.createElement('link');
  link.id = 'action-center-styles';
  link.rel = 'stylesheet';
  link.href = '/action-center.css';
  document.head.append(link);
}

function ensureUi() {
  ensureStyles();
  if ($('#action-center')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="action-center-backdrop" class="action-center-backdrop hidden"></div>
    <section id="action-center" class="action-center hidden" role="dialog" aria-modal="true" aria-labelledby="action-center-title">
      <header class="action-center-head">
        <div>
          <div class="eyebrow">Добавить</div>
          <h2 id="action-center-title">Что нужно сделать?</h2>
        </div>
        <button class="icon-button" type="button" data-action-center-close aria-label="Закрыть">×</button>
      </header>
      <label class="action-center-search">
        <span aria-hidden="true">⌕</span>
        <input id="action-center-search" type="search" autocomplete="off" placeholder="Задача, план, протокол, документ…">
        <kbd>Esc</kbd>
      </label>
      <section class="action-center-recommended" aria-labelledby="action-center-recommended-title">
        <div class="action-center-section-title"><strong id="action-center-recommended-title">Рекомендуется</strong><span>Контекст важнее частоты</span></div>
        <div id="action-center-recommendations" class="action-center-recommendations"></div>
      </section>
      <label id="action-center-dropzone" class="action-center-dropzone" tabindex="0">
        <input id="action-center-file" type="file" hidden accept=".pdf,.doc,.docx,.odt,.xls,.xlsx,.ods,.csv,.txt,.md,.json,.xml,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp">
        <span class="action-center-drop-icon" aria-hidden="true">⇧</span>
        <span><strong>Перетащите любой документ</strong><small>PDF, Word, Excel, ODS или скан. Назначение определится автоматически.</small></span>
        <span class="secondary-button">Выбрать файл</span>
      </label>
      <div id="action-center-status" class="action-center-status hidden" role="status" aria-live="polite"></div>
      <div id="action-center-groups" class="action-center-groups"></div>
    </section>
  `);
}

function actionButton(action, className = 'action-center-action') {
  return `<button class="${className}" type="button" data-action-id="${esc(action.id)}" ${action.available === false ? 'disabled' : ''}>
    <span><strong>${esc(action.label)}</strong><small>${esc(action.detail)}</small></span>
    <span aria-hidden="true">›</span>
  </button>`;
}

function recommendationPlaceholder() {
  return '<div class="action-center-recommendation action-center-recommendation-placeholder" aria-hidden="true"><span><strong>Нет совпадения</strong><small>Измените запрос или выберите действие ниже</small></span></div>';
}

function actionAvailable() {
  return true;
}

function rankingOptions() {
  return {
    query: state.query,
    frequencies: preferenceFrequency(),
    available: actionAvailable,
    context: {
      ...state.context,
      view: state.context.view || currentView(),
      month: state.context.month || currentMonth()
    }
  };
}

function render() {
  const recommendations = recommendActions(rankingOptions());
  const recommendationTarget = $('#action-center-recommendations');
  if (recommendationTarget) {
    const slots = recommendations.map((action) => actionButton(action, 'action-center-recommendation'));
    while (slots.length < 3) slots.push(recommendationPlaceholder());
    recommendationTarget.innerHTML = slots.join('');
  }

  const ranked = rankActions(ACTIONS, rankingOptions());
  const groupTarget = $('#action-center-groups');
  if (!groupTarget) return;
  groupTarget.innerHTML = ACTION_GROUPS.map((group) => {
    const actions = ranked.filter((action) => action.group === group.id);
    return `<section class="action-center-group" data-action-group="${esc(group.id)}">
      <h3>${esc(group.label)}</h3>
      <div>${actions.length
        ? actions.map((action) => actionButton(action)).join('')
        : '<p class="action-center-empty">Нет совпадений</p>'}</div>
    </section>`;
  }).join('');
}

function setStatus(message, tone = 'progress') {
  const target = $('#action-center-status');
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
  target.classList.toggle('hidden', !message);
}

function openCenter(context = {}) {
  ensureUi();
  if (!state.open) {
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  state.context = { ...context, view: context.view || currentView(), month: currentMonth() };
  state.query = '';
  state.uploadRequestedType = 'auto';
  state.uploadActionId = 'document.upload';
  state.open = true;
  $('#action-center-search').value = '';
  setStatus('');
  render();
  $('#action-center-backdrop').classList.remove('hidden');
  $('#action-center').classList.remove('hidden');
  document.body.classList.add('action-center-open');
  queueMicrotask(() => $('#action-center-search')?.focus());
}

function closeCenter({ restoreFocus = true } = {}) {
  if (!state.open) return;
  state.open = false;
  state.uploadToken += 1;
  $('#action-center-backdrop')?.classList.add('hidden');
  $('#action-center')?.classList.add('hidden');
  document.body.classList.remove('action-center-open');
  if (restoreFocus) state.returnFocus?.focus?.();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(selector, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const element = $(selector);
    if (element) return element;
    await delay(40);
  }
  return null;
}

function hasView(view) {
  const escaped = CSS.escape(view);
  return Boolean($(`[data-view-panel="${escaped}"]`) || $(`[data-view="${escaped}"]`));
}

function openView(view) {
  if (!hasView(view)) return false;
  if (typeof window.kafedraSetView === 'function') {
    window.kafedraSetView(view);
    return true;
  }
  const button = $(`[data-view="${CSS.escape(view)}"]`);
  if (!button) return false;
  button.click();
  return true;
}

async function openFirstExistingView(views, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const view of views) {
      if (openView(view)) return view;
    }
    await delay(50);
  }
  return null;
}

function buttonByText(patterns, root = document) {
  const requested = patterns.map((value) => value instanceof RegExp ? value : new RegExp(value, 'iu'));
  return $$('button, [role="button"], label.file-button', root)
    .find((element) => visible(element) && requested.some((pattern) => pattern.test(element.textContent || '')));
}

async function clickFirst(selectors, patterns = [], timeout = 5000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of list.filter(Boolean)) {
      const element = $(selector);
      if (visible(element) && !element.disabled) {
        element.click();
        return true;
      }
    }
    const byText = buttonByText(patterns);
    if (byText && !byText.disabled) {
      byText.click();
      return true;
    }
    await delay(50);
  }
  return false;
}

async function recordAction(actionId) {
  const next = Number(state.sessionFrequency.get(actionId) || 0) + 1;
  state.sessionFrequency.set(actionId, next);
  let persisted = false;
  try {
    const response = await fetch('/api/ui-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        interactionId: `action-center:${actionId}:${crypto.randomUUID?.() || Date.now()}`,
        choices: [{ key: 'action.center.action', value: actionId }]
      })
    });
    const payload = await response.json().catch(() => ({}));
    const rows = payload?.preferences?.['action.center.action'];
    persisted = response.ok && Array.isArray(rows) && rows.some((row) => row?.value === actionId);
  } catch {}
  if (!persisted) writeLocalFrequency(actionId);
}

async function openCalendarForm(kind) {
  const button = $('#create-button');
  if (!button) throw new Error('Форма календаря недоступна.');
  const contextDate = state.context.date || '';
  closeCenter({ restoreFocus: false });
  state.bypassCreate = true;
  try {
    button.click();
  } finally {
    state.bypassCreate = false;
  }
  const sheet = await waitFor('#event-sheet:not(.hidden)');
  if (!sheet) throw new Error('Не удалось открыть форму календаря.');
  const kindInput = $('#event-kind');
  if (kindInput) {
    kindInput.value = kind;
    kindInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (contextDate) {
    const date = $('#event-date');
    if (date) {
      date.value = contextDate;
      date.dataset.uiPreferenceExplicitDate = '1';
      date.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  $('#event-title')?.focus();
}

function requestUpload(requestedType, actionId) {
  state.uploadRequestedType = requestedType;
  state.uploadActionId = actionId;
  $('#action-center-file')?.click();
}

async function triggerManualPlanCreate() {
  await openFirstExistingView(['plans']);
  if (typeof window.kafedraOpenManualPlanCreate === 'function') {
    await window.kafedraOpenManualPlanCreate();
    return true;
  }
  if (await clickFirst('[data-manual-create-plan]', ['Создать план'], 1500)) return true;
  if (!await waitFor('#manual-plan-backdrop', 3500)) return false;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.hidden = true;
  trigger.dataset.manualCreatePlan = '1';
  document.body.append(trigger);
  trigger.click();
  trigger.remove();
  return Boolean(await waitFor('#manual-plan-modal:not(.hidden)', 3500));
}

async function launchExisting(actionId) {
  switch (actionId) {
    case 'calendar.task':
      await openCalendarForm('task');
      return;
    case 'calendar.event':
      await openCalendarForm('event');
      return;
    case 'document.upload':
      requestUpload('auto', actionId);
      return 'pending-upload';
    case 'plan.upload':
      requestUpload('plan', actionId);
      return 'pending-upload';
    case 'directive.upload':
      requestUpload('directive', actionId);
      return 'pending-upload';
    case 'meeting.upload':
      requestUpload('protocol', actionId);
      return 'pending-upload';
    case 'academic.import':
      closeCenter({ restoreFocus: false });
      if (typeof window.kafedraAcademicPerformance?.beginImport === 'function') {
        window.kafedraAcademicPerformance.beginImport();
      } else {
        await openFirstExistingView(['academic-performance']);
        if (!await clickFirst('[data-academic-import-open]', ['Загрузить ведомость'], 4500)) {
          throw new Error('Импорт ведомости недоступен.');
        }
      }
      if (!await waitFor('[data-academic-modal]:not(.hidden)', 4500)) {
        throw new Error('Не удалось открыть импорт ведомости.');
      }
      return;
    case 'science.import':
      requestUpload('science', actionId);
      return 'pending-upload';
    case 'plan.create':
      closeCenter({ restoreFocus: false });
      if (!await triggerManualPlanCreate()) throw new Error('Форма создания плана недоступна.');
      return;
    case 'plan.item':
      closeCenter({ restoreFocus: false });
      await openFirstExistingView(['plans']);
      if (!await clickFirst('[data-manual-add-item]', ['Добавить пункт'], 3500)) {
        throw new Error('Сначала откройте или создайте ручной план.');
      }
      return;
    case 'work.periodic':
      closeCenter({ restoreFocus: false });
      await openFirstExistingView(['work']);
      if (!await clickFirst(
        ['[data-periodic-create]', '[data-new-periodic-task]', '#periodic-task-create', '#periodic-create-button'],
        ['Периодическая задача', 'Создать периодическую'],
        4500
      )) throw new Error('Форма периодической задачи недоступна.');
      return;
    case 'meeting.create':
      closeCenter({ restoreFocus: false });
      await openFirstExistingView(['meetings']);
      if (!await clickFirst(
        ['[data-meeting-create]', '[data-create-meeting]', '#meeting-create-button', '#create-meeting'],
        ['Создать заседание', 'Новое заседание'],
        4500
      )) throw new Error('Форма заседания недоступна.');
      return;
    case 'template.create':
      closeCenter({ restoreFocus: false });
      await openFirstExistingView(['templates']);
      if (!await clickFirst('#template-from-document', ['Создать из документа'], 2500)) {
        throw new Error('Редактор шаблона недоступен.');
      }
      return;
    case 'review.open':
      closeCenter({ restoreFocus: false });
      if (!await openFirstExistingView(['review'])) throw new Error('Раздел проверки недоступен.');
      return;
    case 'science.report':
      closeCenter({ restoreFocus: false });
      if (!await openFirstExistingView(['reports-science', 'science', 'reports'])) {
        throw new Error('Раздел отчётов недоступен.');
      }
      await clickFirst(
        ['[data-science-report-create]', '#science-report-create'],
        ['Сформировать отчёт', 'Новый отчёт'],
        1200
      );
      return;
    default:
      throw new Error('Действие пока недоступно.');
  }
}

async function executeAction(actionId) {
  try {
    const outcome = await launchExisting(actionId);
    if (outcome !== 'pending-upload') await recordAction(actionId);
  } catch (error) {
    if (!state.open) openCenter(state.context);
    setStatus(error?.message || 'Не удалось выполнить действие.', 'error');
  }
}

function runResult(document) {
  return (document.extractionRuns || []).find((run) => run?.result && typeof run.result === 'object')?.result || null;
}

function documentRoute(document) {
  const result = runResult(document) || {};
  if (result.plan?.id) return { kind: 'plan', id: result.plan.id };
  if (result.protocol?.id) return { kind: 'meeting', id: result.protocol.id };
  if (document.meetings?.[0]?.id) return { kind: 'meeting', id: document.meetings[0].id };
  if (result.directive?.id) return { kind: 'directive', id: result.directive.id };
  if (result.science?.id) return { kind: 'science', id: result.science.id };
  if (document.processing_status === 'needs_review' || document.reviews?.some((item) => item.status === 'open')) {
    return { kind: 'review', id: document.id };
  }
  return { kind: 'document', id: document.id };
}

async function callGlobal(names, id) {
  for (const name of names) {
    if (typeof window[name] === 'function') {
      await window[name](id);
      return true;
    }
  }
  return false;
}

function elementWithDatasetValue(id) {
  for (const element of $$('button, [role="button"], article, tr, [data-id]')) {
    if (Object.values(element.dataset || {}).some((value) => value === id)) {
      return element.matches('button, [role="button"]') ? element : element.querySelector('button, [role="button"]') || element;
    }
  }
  return null;
}

async function clickDatasetValue(id, timeout = 4500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const element = elementWithDatasetValue(id);
    if (visible(element)) {
      element.click();
      return true;
    }
    await delay(60);
  }
  return false;
}

async function openExactRoute(route) {
  if (!route?.id) return false;
  if (route.kind === 'plan') {
    if (await callGlobal(['kafedraOpenPlan'], route.id)) return true;
    await openFirstExistingView(['plans']);
    return clickDatasetValue(route.id);
  }
  if (route.kind === 'meeting') {
    if (await callGlobal(['kafedraOpenMeeting', 'kafedraOpenMeetingById'], route.id)) return true;
    await openFirstExistingView(['meetings']);
    return clickDatasetValue(route.id);
  }
  if (route.kind === 'assignment') {
    if (await callGlobal(['kafedraOpenStandaloneAssignment', 'kafedraOpenAssignment'], route.id)) return true;
    await openFirstExistingView(['work']);
    return clickDatasetValue(route.id);
  }
  if (route.kind === 'periodic_task') {
    await openFirstExistingView(['work']);
    return clickDatasetValue(route.id);
  }
  if (route.kind === 'directive') {
    if (await callGlobal(['kafedraOpenDirective', 'kafedraOpenWorkItem', 'kafedraOpenDirectiveArchive'], route.id)) return true;
    await openFirstExistingView(['work']);
    return clickDatasetValue(route.id);
  }
  if (route.kind === 'science') {
    if (await callGlobal(['kafedraOpenScientificItem', 'kafedraOpenScienceItem'], route.id)) return true;
    await openFirstExistingView(['reports-science', 'science', 'reports']);
    return clickDatasetValue(route.id);
  }
  if (route.kind === 'review') {
    return Boolean(await openFirstExistingView(['review']));
  }
  if (await callGlobal(['kafedraOpenDocument'], route.id)) return true;
  await openFirstExistingView(['documents']);
  return await clickDatasetValue(route.id, 1400) || hasView('documents');
}

async function routeDocument(document) {
  const route = documentRoute(document);
  const opened = await openExactRoute(route);
  if (!opened) {
    await openFirstExistingView(document.processing_status === 'needs_review'
      ? ['review', 'documents']
      : ['documents', 'review']);
  }
  closeCenter({ restoreFocus: false });
}

async function uploadFile(file) {
  if (!(file instanceof File) || !file.size) return;
  const token = ++state.uploadToken;
  setStatus(`Сохраняем «${file.name}»…`);
  const response = await fetch('/api/documents', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-document-type': state.uploadRequestedType || 'auto',
      'idempotency-key': `action-center:${state.uploadRequestedType}:${file.name}:${file.size}:${file.lastModified}`
    },
    body: file
  });
  const accepted = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(accepted?.error?.message || `Не удалось сохранить файл: HTTP ${response.status}`);
  await recordAction(state.uploadActionId);
  setStatus('Документ сохранён. Определяем назначение…');

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && token === state.uploadToken) {
    const currentResponse = await fetch(`/api/documents/${encodeURIComponent(accepted.documentId)}`);
    const document = await currentResponse.json().catch(() => ({}));
    if (!currentResponse.ok) throw new Error(document?.error?.message || 'Не удалось получить состояние документа.');
    if (terminalDocumentStatuses.has(document.processing_status)) {
      if (document.processing_status === 'failed') {
        setStatus('Исходный файл сохранён, но автоматическая обработка завершилась ошибкой. Открываем документ.', 'error');
        await delay(350);
      } else if (document.processing_status === 'needs_review') {
        setStatus('Документ разобран. Открываем результат и вопросы, которые требуют уточнения.', 'warning');
      } else {
        setStatus('Готово. Открываем созданный объект.', 'success');
      }
      await routeDocument(document);
      return;
    }
    await delay(350);
  }
  if (token === state.uploadToken) {
    setStatus('Документ сохранён. Обработка продолжается; он доступен в разделе «Документы».', 'warning');
  }
}

function handleFile(file) {
  uploadFile(file).catch((error) => setStatus(error?.message || 'Не удалось загрузить документ.', 'error'));
}

function trapFocus(event) {
  if (!state.open || event.key !== 'Tab') return;
  const root = $('#action-center');
  const focusable = $$('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter(visible);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

ensureUi();
const createButton = $('#create-button');
if (createButton) {
  createButton.textContent = '+ Добавить';
  createButton.setAttribute('aria-haspopup', 'dialog');
  createButton.setAttribute('aria-controls', 'action-center');
}

document.addEventListener('click', (event) => {
  const create = event.target.closest('#create-button');
  if (create && !state.bypassCreate) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openCenter();
    return;
  }
  const onDate = event.target.closest('[data-new-on-date]');
  if (onDate && !state.bypassCreate) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openCenter({ date: onDate.dataset.newOnDate, view: 'calendar' });
    return;
  }
  if (event.target.closest('[data-action-center-close]') || event.target === $('#action-center-backdrop')) {
    closeCenter();
    return;
  }
  const action = event.target.closest('[data-action-id]');
  if (action) executeAction(action.dataset.actionId);
}, true);

document.addEventListener('input', (event) => {
  if (event.target.id !== 'action-center-search') return;
  state.query = event.target.value;
  render();
});

document.addEventListener('change', (event) => {
  if (event.target.id !== 'action-center-file') return;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) handleFile(file);
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'n') {
    event.preventDefault();
    event.stopImmediatePropagation();
    openCenter();
    return;
  }
  if (event.key === 'Escape' && state.open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCenter();
    return;
  }
  trapFocus(event);
}, true);

const dropzone = $('#action-center-dropzone');
for (const eventName of ['dragenter', 'dragover']) {
  dropzone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropzone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragging');
  });
}
dropzone?.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});
dropzone?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    requestUpload('auto', 'document.upload');
  }
});

window.kafedraOpenActionCenter = openCenter;
window.kafedraOpenExactRoute = openExactRoute;
window.dispatchEvent(new CustomEvent('kafedra:action-center-ready'));
