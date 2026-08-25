const lifecycleNativeFetch = window.fetch.bind(window);

const lifecycleState = {
  documents: [],
  documentMode: 'active',
  documentQuery: '',
  plans: [],
  planMode: 'active',
  inspectedDocumentId: null,
  patchTimer: null,
  searchTimer: null
};

const $l = (selector, root = document) => root.querySelector(selector);
const $$l = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeLifecycle(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function lifecycleUrl(input) {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function rebuildInput(input, url) {
  if (input instanceof Request) return new Request(url.toString(), input);
  return `${url.pathname}${url.search}${url.hash}`;
}

function scheduleLifecyclePatch() {
  clearTimeout(lifecycleState.patchTimer);
  lifecycleState.patchTimer = setTimeout(() => {
    ensureLifecycleUi();
    patchDocuments();
    patchPlans();
  }, 30);
}

window.fetch = async function lifecycleFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = lifecycleUrl(input);
  let nextInput = input;
  if (method === 'GET' && url?.origin === window.location.origin) {
    if (url.pathname === '/api/documents') {
      url.searchParams.set('lifecycle', lifecycleState.documentMode);
      if (lifecycleState.documentQuery) url.searchParams.set('q', lifecycleState.documentQuery);
      else url.searchParams.delete('q');
      nextInput = rebuildInput(input, url);
    }
    if (url.pathname === '/api/plans') {
      url.searchParams.set('status', lifecycleState.planMode);
      nextInput = rebuildInput(input, url);
    }
  }
  const response = await lifecycleNativeFetch(nextInput, init);
  if (method === 'GET' && response.ok && url?.origin === window.location.origin) {
    if (url.pathname === '/api/documents') {
      response.clone().json().then((payload) => {
        lifecycleState.documents = payload.items || [];
        scheduleLifecyclePatch();
      }).catch(() => {});
    }
    if (url.pathname === '/api/plans') {
      response.clone().json().then((payload) => {
        lifecycleState.plans = payload.items || [];
        scheduleLifecyclePatch();
      }).catch(() => {});
    }
  }
  return response;
};

async function lifecycleApi(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function documentTypeLabel(value) {
  return {
    unknown: 'Вид не определён',
    plan: 'План работы',
    department_plan: 'План кафедры',
    faculty_plan: 'План факультета',
    personal_plan: 'Личный план',
    unit_plan: 'План подразделения',
    organization_plan: 'План организации',
    directive: 'Распоряжение',
    order: 'Приказ',
    decree: 'Указ',
    department_protocol: 'Протокол кафедры',
    protocol: 'Протокол',
    report: 'Отчёт',
    nir_report: 'Отчёт НИР',
    article: 'Научный материал',
    science: 'Научный материал',
    custom_document: 'Пользовательский документ',
    other: 'Другой документ'
  }[value] || 'Другой документ';
}

function processingLabel(value) {
  return {
    queued: 'Принят', extracting: 'Обрабатывается', processed: 'Готов',
    needs_review: 'Нужно проверить', failed: 'Ошибка обработки'
  }[value] || value || 'Сохранён';
}

function lifecycleLabel(item) {
  if ((item.lifecycle_status || 'active') !== 'archived') return 'В работе';
  return item.replacement_document_id || item.replacement_plan_id ? 'Заменён' : 'Архив';
}

function formatLifecycleBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} байт`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function lifecycleDate(value) {
  if (!value) return 'не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function ensureLifecycleUi() {
  if (!$l('#lifecycle-next-styles')) {
    const link = document.createElement('link');
    link.id = 'lifecycle-next-styles';
    link.rel = 'stylesheet';
    link.href = '/lifecycle-next.css';
    document.head.append(link);
  }

  const documentsPanel = $l('[data-view-panel="documents"]');
  if (documentsPanel && !$l('#document-purpose-guide', documentsPanel)) {
    const heading = $l('.section-heading', documentsPanel);
    heading?.insertAdjacentHTML('afterend', `
      <section id="document-purpose-guide" class="lifecycle-purpose-grid" aria-label="Как использовать документы">
        <article><span class="lifecycle-purpose-icon">①</span><div><strong>Основание</strong><p>Приказ или распоряжение превращается в поручения, исполнителей и сроки.</p><small>Пример: «Приказ № 17 о подготовке отчёта»</small></div></article>
        <article><span class="lifecycle-purpose-icon">②</span><div><strong>План</strong><p>План кафедры разбирается на мероприятия и контрольные даты.</p><small>Пример: «План работы на 2026/27 учебный год»</small></div></article>
        <article><span class="lifecycle-purpose-icon">③</span><div><strong>Результат</strong><p>Отчёт, справка или скан остаётся доказательством выполнения.</p><small>Пример: «Отчёт по НИР за 2026 год»</small></div></article>
      </section>
      <div id="document-lifecycle-toolbar" class="lifecycle-toolbar">
        <label class="lifecycle-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Название или имя файла" aria-label="Поиск документов"></label>
        <div class="lifecycle-segmented" role="group" aria-label="Состояние документов">
          <button type="button" data-document-lifecycle="active">В работе</button>
          <button type="button" data-document-lifecycle="archived">Архив</button>
        </div>
      </div>
    `);
  }

  const plansPanel = $l('[data-view-panel="plans"]');
  if (plansPanel && !$l('#plans-lifecycle-guide', plansPanel)) {
    $l('.plans-heading', plansPanel)?.insertAdjacentHTML('afterend', `
      <section id="plans-lifecycle-guide" class="lifecycle-plan-flow">
        <div><span>1</span><strong>Создайте или загрузите план</strong><small>Файл можно импортировать, новый план — собрать вручную.</small></div>
        <i aria-hidden="true">→</i>
        <div><span>2</span><strong>Проверьте мероприятия</strong><small>Исправьте даты, назначьте сотрудников и добавьте документы.</small></div>
        <i aria-hidden="true">→</i>
        <div><span>3</span><strong>Контролируйте выполнение</strong><small>Календарь и поручения сохраняют ссылку на исходный пункт.</small></div>
      </section>
    `);
    const filterbar = $l('.plans-filterbar', plansPanel);
    filterbar?.insertAdjacentHTML('beforeend', `
      <select id="plans-lifecycle-status" aria-label="Состояние планов">
        <option value="active">В работе</option>
        <option value="archived">Архив</option>
      </select>
    `);
  }

  if (!$l('#lifecycle-modal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="lifecycle-modal-backdrop" class="lifecycle-modal-backdrop hidden"></div>
      <section id="lifecycle-modal" class="lifecycle-modal hidden" role="dialog" aria-modal="true"></section>
    `);
  }
  renderLifecycleControls();
}

function renderLifecycleControls() {
  $$l('[data-document-lifecycle]').forEach((button) => {
    const active = button.dataset.documentLifecycle === lifecycleState.documentMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const query = $l('#document-lifecycle-toolbar input');
  if (query && query.value !== lifecycleState.documentQuery) query.value = lifecycleState.documentQuery;
  const planStatus = $l('#plans-lifecycle-status');
  if (planStatus) planStatus.value = lifecycleState.planMode;
}

function documentById(id) {
  return lifecycleState.documents.find((item) => item.id === id) || null;
}

function planById(id) {
  return lifecycleState.plans.find((item) => item.id === id) || null;
}

function patchDocuments() {
  const table = $l('#documents-table tbody');
  if (!table) return;
  const rows = [...table.querySelectorAll('tr')];
  rows.forEach((row, index) => {
    const item = lifecycleState.documents[index];
    if (!item) return;
    row.dataset.documentId = item.id;
    row.classList.toggle('lifecycle-archived-row', (item.lifecycle_status || 'active') === 'archived');
    const cells = row.children;
    if (cells[0]) {
      const title = $l('.document-title', cells[0]);
      if (title) {
        title.classList.add('document-open');
        title.tabIndex = 0;
        title.setAttribute('role', 'button');
      }
      if (!$l('.lifecycle-badge', cells[0])) {
        cells[0].insertAdjacentHTML('beforeend', `<span class="lifecycle-badge ${(item.lifecycle_status || 'active') === 'archived' ? 'archived' : 'active'}">${escapeLifecycle(lifecycleLabel(item))}</span>`);
      }
      if (item.replacement_title && !$l('.lifecycle-replacement-line', cells[0])) {
        cells[0].insertAdjacentHTML('beforeend', `<div class="lifecycle-replacement-line">Продолжение: ${escapeLifecycle(item.replacement_title)}</div>`);
      }
    }
    if (cells[1]) cells[1].textContent = documentTypeLabel(item.document_type);
    if (cells[2]) {
      const status = $l('.status', cells[2]);
      if (status) status.textContent = processingLabel(item.processing_status);
    }
    const actionCell = cells[cells.length - 1];
    if (actionCell && !$l('[data-lifecycle-document-open]', actionCell)) {
      const actions = $l('.row-actions', actionCell) || actionCell;
      actions.insertAdjacentHTML('afterbegin', `
        <button class="row-button" type="button" data-lifecycle-document-open="${escapeLifecycle(item.id)}">Открыть</button>
        <button class="row-button" type="button" data-lifecycle-document-edit="${escapeLifecycle(item.id)}">Изменить</button>
        ${(item.lifecycle_status || 'active') === 'archived'
          ? `<button class="row-button" type="button" data-lifecycle-document-restore="${escapeLifecycle(item.id)}">Восстановить</button>`
          : `<button class="row-button" type="button" data-lifecycle-document-archive="${escapeLifecycle(item.id)}">В архив</button>`}
      `);
    }
  });
}

function patchPlans() {
  $$l('.plan-card[data-plan-id]').forEach((card) => {
    const plan = planById(card.dataset.planId);
    if (!plan) return;
    card.classList.toggle('lifecycle-archived-card', plan.status === 'archived');
    if (!$l('.lifecycle-plan-badge', card)) {
      card.insertAdjacentHTML('afterbegin', `<span class="lifecycle-plan-badge ${plan.status === 'archived' ? 'archived' : 'active'}">${escapeLifecycle(lifecycleLabel(plan))}</span>`);
    }
  });
  const selectedId = $l('.plan-card.active[data-plan-id]')?.dataset.planId;
  if (!selectedId) return;
  const plan = planById(selectedId);
  const detail = $l('#plan-detail');
  if (!plan || !detail) return;
  const actions = $l('.plan-detail-actions', detail);
  if (actions && !$l('[data-lifecycle-plan-edit]', actions)) {
    actions.insertAdjacentHTML('afterbegin', `
      <button class="secondary-button" type="button" data-lifecycle-plan-edit="${escapeLifecycle(plan.id)}">Переименовать</button>
      ${plan.status === 'archived'
        ? `<button class="secondary-button" type="button" data-lifecycle-plan-restore="${escapeLifecycle(plan.id)}">Восстановить</button>`
        : `<button class="secondary-button" type="button" data-lifecycle-plan-archive="${escapeLifecycle(plan.id)}">В архив</button>`}
    `);
  }
  if (plan.replacement && !$l('.lifecycle-replacement-banner', detail)) {
    $l('.plan-summary-strip', detail)?.insertAdjacentHTML('beforebegin', `
      <section class="lifecycle-replacement-banner">
        <div><strong>Этот план заменён</strong><span>Новая работа ведётся в плане «${escapeLifecycle(plan.replacement.title)}». Исторические пункты и отчёты остались здесь.</span></div>
        <button type="button" class="secondary-button" data-lifecycle-open-plan="${escapeLifecycle(plan.replacement.id)}">Открыть новый план</button>
      </section>
    `);
  }
}

function openLifecycleModal(html) {
  ensureLifecycleUi();
  $l('#lifecycle-modal').innerHTML = html;
  $l('#lifecycle-modal').classList.remove('hidden');
  $l('#lifecycle-modal-backdrop').classList.remove('hidden');
  document.body.classList.add('lifecycle-modal-open');
}

function closeLifecycleModal() {
  $l('#lifecycle-modal')?.classList.add('hidden');
  $l('#lifecycle-modal-backdrop')?.classList.add('hidden');
  document.body.classList.remove('lifecycle-modal-open');
}

function lifecycleNotice(message) {
  const planNotice = $l('#plans-notice');
  if (planNotice) {
    $l('span', planNotice).textContent = message;
    $l('button', planNotice)?.classList.add('hidden');
    planNotice.classList.remove('hidden');
    clearTimeout(lifecycleNotice.timer);
    lifecycleNotice.timer = setTimeout(() => planNotice.classList.add('hidden'), 5000);
    return;
  }
  const toast = $l('#toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(lifecycleNotice.timer);
    lifecycleNotice.timer = setTimeout(() => toast.classList.add('hidden'), 5000);
  }
}

function openInspectorShell(title, eyebrow, body, actions) {
  const inspector = $l('#ux-inspector');
  if (!inspector) {
    openLifecycleModal(`<header class="lifecycle-modal-head"><div><span>${escapeLifecycle(eyebrow)}</span><h3>${escapeLifecycle(title)}</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header><div class="lifecycle-modal-body">${body}<div class="lifecycle-modal-actions">${actions}</div></div>`);
    return;
  }
  $l('#ux-inspector-title').textContent = title;
  $l('#ux-inspector-eyebrow').textContent = eyebrow;
  $l('#ux-inspector-body').innerHTML = body;
  $l('#ux-inspector-actions').innerHTML = actions;
  inspector.classList.remove('hidden');
  document.body.classList.add('inspector-open');
}

async function openDocumentInspector(documentId) {
  const document = await lifecycleApi(`/api/documents/${encodeURIComponent(documentId)}`);
  lifecycleState.inspectedDocumentId = document.id;
  const openReviews = (document.reviews || []).filter((item) => item.status === 'open');
  const replacement = document.replacement
    ? `<section class="lifecycle-inspector-callout"><strong>Заменён документом «${escapeLifecycle(document.replacement.title)}»</strong><p>Старые планы, поручения, отчёты и доказательства продолжают ссылаться на этот исходник. Замена служит только навигацией.</p><button class="secondary-button" type="button" data-lifecycle-document-open="${escapeLifecycle(document.replacement.id)}">Открыть продолжение</button></section>`
    : '';
  openInspectorShell(document.title, 'Документ', `
    <div class="document-inspector-summary">
      <span class="lifecycle-badge ${(document.lifecycle_status || 'active') === 'archived' ? 'archived' : 'active'}">${escapeLifecycle(lifecycleLabel(document))}</span>
      <strong>${escapeLifecycle(document.original_name)}</strong>
      <small>${escapeLifecycle(documentTypeLabel(document.document_type))} · ${escapeLifecycle(formatLifecycleBytes(document.size_bytes))}</small>
    </div>
    ${replacement}
    <dl class="inspector-facts">
      <div><dt>Обработка</dt><dd>${escapeLifecycle(processingLabel(document.processing_status))}</dd></div>
      <div><dt>Добавлен</dt><dd>${escapeLifecycle(lifecycleDate(document.uploaded_at || document.created_at))}</dd></div>
      <div><dt>Извлечений</dt><dd>${Number((document.templateExtractions || []).length)}</dd></div>
      <div><dt>Вопросов</dt><dd>${openReviews.length}</dd></div>
    </dl>
    ${(document.lifecycle_status || 'active') === 'archived' ? `<section class="inspector-section"><h3>Архивирование</h3><p>${escapeLifecycle(document.archive_reason || 'Причина не указана.')}</p><small>${escapeLifecycle(lifecycleDate(document.archived_at))}</small></section>` : ''}
    <section class="inspector-section"><h3>Что можно сделать</h3><p>Уточнить название и вид, открыть неизменяемый исходник, создать шаблон извлечения либо убрать ошибочно добавленную запись в архив.</p></section>
    <div class="source-note">Архивирование не удаляет файл, версии, извлечённые факты и историю изменений.</div>
  `, `
    <a class="secondary-button" href="${escapeLifecycle(document.originalUrl || `/api/documents/${encodeURIComponent(document.id)}/content?variant=original`)}" target="_blank" rel="noopener">Открыть исходник</a>
    ${['processed','needs_review'].includes(document.processing_status) ? `<button class="secondary-button" type="button" data-lifecycle-document-template="${escapeLifecycle(document.id)}">Создать шаблон</button>` : ''}
    <button class="secondary-button" type="button" data-lifecycle-document-edit="${escapeLifecycle(document.id)}">Переименовать</button>
    ${(document.lifecycle_status || 'active') === 'archived'
      ? `<button class="primary-button" type="button" data-lifecycle-document-restore="${escapeLifecycle(document.id)}">Восстановить</button>`
      : `<button class="primary-button" type="button" data-lifecycle-document-archive="${escapeLifecycle(document.id)}">В архив</button>`}
  `);
}

function documentTypeOptions(selected) {
  const values = [
    ['unknown','Вид не определён'], ['department_plan','План кафедры'], ['faculty_plan','План факультета'],
    ['personal_plan','Личный план'], ['directive','Распоряжение'], ['order','Приказ'], ['decree','Указ'],
    ['department_protocol','Протокол кафедры'], ['report','Отчёт'], ['nir_report','Отчёт НИР'],
    ['article','Научный материал'], ['custom_document','Пользовательский документ'], ['other','Другой документ']
  ];
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

async function openDocumentEditor(documentId) {
  const document = await lifecycleApi(`/api/documents/${encodeURIComponent(documentId)}`);
  openLifecycleModal(`
    <header class="lifecycle-modal-head"><div><span>Документ</span><h3>Название и вид</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header>
    <form id="lifecycle-document-edit-form" class="lifecycle-modal-body" data-document-id="${escapeLifecycle(document.id)}">
      <label class="field"><span>Название в системе</span><input name="title" value="${escapeLifecycle(document.title)}" required></label>
      <label class="field"><span>Для чего этот документ</span><select name="documentType">${documentTypeOptions(document.document_type)}</select></label>
      <p class="lifecycle-helper">Исходное имя файла и его содержимое не изменятся.</p>
      <div class="lifecycle-modal-actions"><button class="secondary-button" type="button" data-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>
  `);
}

async function openPlanEditor(planId) {
  const plan = await lifecycleApi(`/api/plans/${encodeURIComponent(planId)}`);
  openLifecycleModal(`
    <header class="lifecycle-modal-head"><div><span>План</span><h3>Переименовать план</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header>
    <form id="lifecycle-plan-edit-form" class="lifecycle-modal-body" data-plan-id="${escapeLifecycle(plan.id)}">
      <label class="field"><span>Название</span><input name="title" value="${escapeLifecycle(plan.title)}" required></label>
      <p class="lifecycle-helper">Пункты, календарные записи и поручения сохранят свои связи.</p>
      <div class="lifecycle-modal-actions"><button class="secondary-button" type="button" data-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>
  `);
}

function impactRows(kind, impact) {
  const rows = kind === 'document' ? [
    ['Версии исходника', impact.versions], ['Планы', impact.plans], ['Пункты планов', impact.planItems],
    ['Календарные записи', impact.calendarItems], ['Поручения', impact.assignments], ['Активные поручения', impact.activeAssignments],
    ['Распоряжения', impact.directives], ['Заседания', impact.meetings], ['Шаблоны', Number(impact.extractionTemplates || 0) + Number(impact.planTemplates || 0)],
    ['Отчётные связи', impact.assignmentReports], ['Научные записи', impact.scientificRecords], ['Сопроводительные документы', impact.supportingDocuments]
  ] : [
    ['Пункты плана', impact.items], ['Выполнено пунктов', impact.completedItems], ['Календарные записи', impact.calendarItems],
    ['Поручения', impact.assignments], ['Активные поручения', impact.activeAssignments],
    ['Сопроводительные документы', impact.supportingDocuments], ['Вопросы заседаний', impact.agendaItems]
  ];
  return rows.filter(([, count]) => Number(count || 0) > 0)
    .map(([label, count]) => `<div><span>${escapeLifecycle(label)}</span><strong>${Number(count)}</strong></div>`).join('')
    || '<p class="lifecycle-helper">Связанных рабочих объектов пока нет.</p>';
}

async function openArchive(kind, id) {
  const impact = await lifecycleApi(`/api/${kind === 'document' ? 'documents' : 'plans'}/${encodeURIComponent(id)}/impact`);
  const source = kind === 'document' ? impact.document : impact.plan;
  const list = await lifecycleApi(kind === 'document'
    ? '/api/documents?lifecycle=active&limit=1000'
    : '/api/plans?status=active&limit=1000');
  const replacements = (list.items || []).filter((item) => item.id !== id);
  const fieldName = kind === 'document' ? 'replacementDocumentId' : 'replacementPlanId';
  openLifecycleModal(`
    <header class="lifecycle-modal-head"><div><span>${kind === 'document' ? 'Документ' : 'План'}</span><h3>Убрать в архив</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header>
    <form id="lifecycle-archive-form" class="lifecycle-modal-body" data-kind="${kind}" data-id="${escapeLifecycle(id)}">
      <p>«${escapeLifecycle(source.title)}» исчезнет из рабочего списка, но останется в архиве со всей историей.</p>
      <section class="lifecycle-impact"><h4>Останутся связаны с исходным объектом</h4><div class="lifecycle-impact-grid">${impactRows(kind, impact)}</div></section>
      <label class="field"><span>${kind === 'document' ? 'Новый документ вместо этого' : 'Новый план вместо этого'} <small>необязательно</small></span><select name="${fieldName}">
        <option value="">Не назначать замену</option>
        ${replacements.map((item) => `<option value="${escapeLifecycle(item.id)}">${escapeLifecycle(item.title)}${item.period_key ? ` · ${escapeLifecycle(item.period_key)}` : ''}</option>`).join('')}
      </select></label>
      <label class="field"><span>Причина</span><textarea name="reason" rows="3" placeholder="Например: загружен ошибочно или заменён утверждённой версией"></textarea></label>
      <div class="lifecycle-warning"><strong>Связи не переносятся молча.</strong><span>Замена создаёт переход к новому объекту. Старые пункты, сроки, отчёты и доказательства сохраняют прежний источник.</span></div>
      <div class="lifecycle-modal-actions"><button class="secondary-button" type="button" data-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Переместить в архив</button></div>
    </form>
  `);
}

function refreshDocuments() {
  if (typeof window.kafedraSetView === 'function') window.kafedraSetView('documents');
}

function refreshPlans() {
  const trigger = $l('.nav-item[data-view="plans"]:not(.hidden), .mobile-tab[data-view="plans"]:not(.hidden)');
  trigger?.click();
}

async function restoreLifecycle(kind, id) {
  await lifecycleApi(`/api/${kind === 'document' ? 'documents' : 'plans'}/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  if (kind === 'document') {
    lifecycleState.documentMode = 'active';
    refreshDocuments();
  } else {
    lifecycleState.planMode = 'active';
    refreshPlans();
  }
  lifecycleNotice(kind === 'document' ? 'Документ восстановлен и снова находится в работе.' : 'План восстановлен и снова находится в работе.');
}

const lifecycleObserver = new MutationObserver(scheduleLifecyclePatch);
lifecycleObserver.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', (event) => {
  const documentMode = event.target.closest('[data-document-lifecycle]');
  if (documentMode) {
    lifecycleState.documentMode = documentMode.dataset.documentLifecycle;
    renderLifecycleControls();
    refreshDocuments();
    return;
  }
  const documentOpen = event.target.closest('[data-lifecycle-document-open], .document-open');
  if (documentOpen) {
    const id = documentOpen.dataset.lifecycleDocumentOpen || documentOpen.closest('[data-document-id]')?.dataset.documentId;
    if (id) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openDocumentInspector(id).catch((error) => lifecycleNotice(error.message));
    }
    return;
  }
  const documentEdit = event.target.closest('[data-lifecycle-document-edit]');
  if (documentEdit) return openDocumentEditor(documentEdit.dataset.lifecycleDocumentEdit).catch((error) => lifecycleNotice(error.message));
  const documentArchive = event.target.closest('[data-lifecycle-document-archive]');
  if (documentArchive) return openArchive('document', documentArchive.dataset.lifecycleDocumentArchive).catch((error) => lifecycleNotice(error.message));
  const documentRestore = event.target.closest('[data-lifecycle-document-restore]');
  if (documentRestore) return restoreLifecycle('document', documentRestore.dataset.lifecycleDocumentRestore).catch((error) => lifecycleNotice(error.message));
  const documentTemplate = event.target.closest('[data-lifecycle-document-template]');
  if (documentTemplate) {
    $l('#ux-inspector-close')?.click();
    const existing = $l(`[data-create-template="${CSS.escape(documentTemplate.dataset.lifecycleDocumentTemplate)}"]`);
    existing?.click();
    return;
  }

  const planEdit = event.target.closest('[data-lifecycle-plan-edit]');
  if (planEdit) return openPlanEditor(planEdit.dataset.lifecyclePlanEdit).catch((error) => lifecycleNotice(error.message));
  const planArchive = event.target.closest('[data-lifecycle-plan-archive]');
  if (planArchive) return openArchive('plan', planArchive.dataset.lifecyclePlanArchive).catch((error) => lifecycleNotice(error.message));
  const planRestore = event.target.closest('[data-lifecycle-plan-restore]');
  if (planRestore) return restoreLifecycle('plan', planRestore.dataset.lifecyclePlanRestore).catch((error) => lifecycleNotice(error.message));
  const openPlan = event.target.closest('[data-lifecycle-open-plan]');
  if (openPlan && typeof window.kafedraOpenPlan === 'function') return window.kafedraOpenPlan(openPlan.dataset.lifecycleOpenPlan);

  if (event.target.closest('[data-lifecycle-close]') || event.target === $l('#lifecycle-modal-backdrop')) closeLifecycleModal();
}, true);

document.addEventListener('input', (event) => {
  if (!event.target.closest('#document-lifecycle-toolbar')) return;
  clearTimeout(lifecycleState.searchTimer);
  lifecycleState.searchTimer = setTimeout(() => {
    lifecycleState.documentQuery = event.target.value.trim();
    refreshDocuments();
  }, 250);
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'plans-lifecycle-status') {
    lifecycleState.planMode = event.target.value;
    refreshPlans();
  }
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id === 'lifecycle-document-edit-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    lifecycleApi(`/api/documents/${encodeURIComponent(form.dataset.documentId)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: data.get('title'), documentType: data.get('documentType') })
    }).then(() => {
      closeLifecycleModal();
      refreshDocuments();
      lifecycleNotice('Сведения о документе обновлены. Исходный файл не изменён.');
    }).catch((error) => lifecycleNotice(error.message));
  }
  if (event.target.id === 'lifecycle-plan-edit-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    lifecycleApi(`/api/plans/${encodeURIComponent(form.dataset.planId)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: data.get('title') })
    }).then(() => {
      closeLifecycleModal();
      refreshPlans();
      lifecycleNotice('План переименован. Все связанные объекты сохранены.');
    }).catch((error) => lifecycleNotice(error.message));
  }
  if (event.target.id === 'lifecycle-archive-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const kind = form.dataset.kind;
    const body = kind === 'document'
      ? { replacementDocumentId: data.get('replacementDocumentId') || null, reason: data.get('reason') || null }
      : { replacementPlanId: data.get('replacementPlanId') || null, reason: data.get('reason') || null };
    lifecycleApi(`/api/${kind === 'document' ? 'documents' : 'plans'}/${encodeURIComponent(form.dataset.id)}/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then(() => {
      closeLifecycleModal();
      if (kind === 'document') {
        lifecycleState.documentMode = 'archived';
        refreshDocuments();
      } else {
        lifecycleState.planMode = 'archived';
        refreshPlans();
      }
      lifecycleNotice(kind === 'document'
        ? 'Документ перемещён в архив. Файл, версии и связи сохранены.'
        : 'План перемещён в архив. Пункты, календарь, поручения и отчёты сохранены.');
    }).catch((error) => lifecycleNotice(error.message));
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$l('#lifecycle-modal')?.classList.contains('hidden')) closeLifecycleModal();
}, true);

ensureLifecycleUi();
scheduleLifecyclePatch();
