const lifecycleBaseFetch = window.fetch.bind(window);

const lifecycleState = {
  documents: [],
  documentMode: 'active',
  documentQuery: '',
  plans: [],
  planMode: 'active',
  patchTimer: null,
  searchTimer: null
};

const $l = (selector, root = document) => root.querySelector(selector);
const $$l = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function requestUrl(input) {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function rebuiltInput(input, url) {
  return input instanceof Request
    ? new Request(url.toString(), input)
    : `${url.pathname}${url.search}${url.hash}`;
}

function schedulePatch() {
  clearTimeout(lifecycleState.patchTimer);
  lifecycleState.patchTimer = setTimeout(() => {
    ensureUi();
    patchDocuments();
    patchPlans();
  }, 30);
}

window.fetch = async function lifecycleAwareFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = requestUrl(input);
  let nextInput = input;
  if (method === 'GET' && url?.origin === window.location.origin) {
    if (url.pathname === '/api/documents') {
      url.searchParams.set('lifecycle', lifecycleState.documentMode);
      if (lifecycleState.documentQuery) url.searchParams.set('q', lifecycleState.documentQuery);
      else url.searchParams.delete('q');
      nextInput = rebuiltInput(input, url);
    }
    if (url.pathname === '/api/plans') {
      url.searchParams.set('status', lifecycleState.planMode);
      nextInput = rebuiltInput(input, url);
    }
  }

  const response = await lifecycleBaseFetch(nextInput, init);
  if (method === 'GET' && response.ok && url?.origin === window.location.origin) {
    if (url.pathname === '/api/documents') {
      response.clone().json().then((payload) => {
        lifecycleState.documents = payload.items || [];
        schedulePatch();
      }).catch(() => {});
    }
    if (url.pathname === '/api/plans') {
      response.clone().json().then((payload) => {
        lifecycleState.plans = payload.items || [];
        schedulePatch();
      }).catch(() => {});
    }
  }
  return response;
};

async function api(path, options = {}) {
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
    queued: 'Принят',
    extracting: 'Обрабатывается',
    processed: 'Готов',
    needs_review: 'Нужно проверить',
    failed: 'Ошибка обработки'
  }[value] || value || 'Сохранён';
}

function lifecycleLabel(item) {
  const archived = item.lifecycle_status === 'archived' || item.status === 'archived';
  if (!archived) return 'В работе';
  return item.replacement_document_id || item.replacement_plan_id ? 'Заменён' : 'Архив';
}

function dateLabel(value) {
  if (!value) return 'не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric'
  }).format(date);
}

function ensureUi() {
  if (!$l('#lifecycle-next-styles')) {
    const link = document.createElement('link');
    link.id = 'lifecycle-next-styles';
    link.rel = 'stylesheet';
    link.href = '/lifecycle-next.css';
    document.head.append(link);
  }

  const documentsPanel = $l('[data-view-panel="documents"]');
  if (documentsPanel && !$l('#document-purpose-guide', documentsPanel)) {
    $l('.section-heading', documentsPanel)?.insertAdjacentHTML('afterend', `
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
    $l('.plans-filterbar', plansPanel)?.insertAdjacentHTML('beforeend', `
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
  renderControls();
}

function renderControls() {
  $$l('[data-document-lifecycle]').forEach((button) => {
    const active = button.dataset.documentLifecycle === lifecycleState.documentMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const input = $l('#document-lifecycle-toolbar input');
  if (input && input.value !== lifecycleState.documentQuery) input.value = lifecycleState.documentQuery;
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
  const body = $l('#documents-table tbody');
  if (!body) return;
  [...body.querySelectorAll('tr')].forEach((row, index) => {
    const item = lifecycleState.documents[index];
    if (!item) return;
    row.dataset.documentId = item.id;
    row.classList.toggle('lifecycle-archived-row', item.lifecycle_status === 'archived');
    const cells = row.children;
    const title = $l('.document-title', row);
    if (title) {
      title.classList.add('document-open');
      title.tabIndex = 0;
      title.setAttribute('role', 'button');
      title.setAttribute('aria-label', `Открыть ${item.title}`);
    }
    if (cells[0] && !$l('.lifecycle-badge', cells[0])) {
      cells[0].insertAdjacentHTML('beforeend', `<span class="lifecycle-badge ${item.lifecycle_status === 'archived' ? 'archived' : 'active'}">${esc(lifecycleLabel(item))}</span>`);
    }
    if (cells[0] && item.replacement_title && !$l('.lifecycle-replacement-line', cells[0])) {
      cells[0].insertAdjacentHTML('beforeend', `<div class="lifecycle-replacement-line">Продолжение: ${esc(item.replacement_title)}</div>`);
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
        <button class="row-button" type="button" data-lifecycle-document-open="${esc(item.id)}">Открыть</button>
        <button class="row-button" type="button" data-lifecycle-document-edit="${esc(item.id)}">Изменить</button>
        ${item.lifecycle_status === 'archived'
          ? `<button class="row-button" type="button" data-lifecycle-document-restore="${esc(item.id)}">Восстановить</button>`
          : `<button class="row-button" type="button" data-lifecycle-document-archive="${esc(item.id)}">В архив</button>`}
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
      card.insertAdjacentHTML('afterbegin', `<span class="lifecycle-plan-badge ${plan.status === 'archived' ? 'archived' : 'active'}">${esc(lifecycleLabel(plan))}</span>`);
    }
  });

  const selectedId = $l('.plan-card.active[data-plan-id]')?.dataset.planId;
  const plan = selectedId ? planById(selectedId) : null;
  const detail = $l('#plan-detail');
  if (!plan || !detail) return;
  const actions = $l('.plan-detail-actions', detail);
  if (actions && !$l('[data-lifecycle-plan-edit]', actions)) {
    actions.insertAdjacentHTML('afterbegin', `
      <button class="secondary-button" type="button" data-lifecycle-plan-edit="${esc(plan.id)}">Переименовать</button>
      ${plan.status === 'archived'
        ? `<button class="secondary-button" type="button" data-lifecycle-plan-restore="${esc(plan.id)}">Восстановить</button>`
        : `<button class="secondary-button" type="button" data-lifecycle-plan-archive="${esc(plan.id)}">В архив</button>`}
    `);
  }
  if (plan.replacement && !$l('.lifecycle-replacement-banner', detail)) {
    $l('.plan-summary-strip', detail)?.insertAdjacentHTML('beforebegin', `
      <section class="lifecycle-replacement-banner">
        <div><strong>Этот план заменён</strong><span>Новая работа ведётся в плане «${esc(plan.replacement.title)}». Исторические пункты и отчёты остались здесь.</span></div>
        <button type="button" class="secondary-button" data-lifecycle-open-plan="${esc(plan.replacement.id)}">Открыть новый план</button>
      </section>
    `);
  }
}

function showModal(html) {
  ensureUi();
  $l('#lifecycle-modal').innerHTML = html;
  $l('#lifecycle-modal').classList.remove('hidden');
  $l('#lifecycle-modal-backdrop').classList.remove('hidden');
  document.body.classList.add('lifecycle-modal-open');
}

function closeModal() {
  $l('#lifecycle-modal')?.classList.add('hidden');
  $l('#lifecycle-modal-backdrop')?.classList.add('hidden');
  document.body.classList.remove('lifecycle-modal-open');
}

function notice(message) {
  const planNotice = $l('#plans-notice');
  if (planNotice) {
    $l('span', planNotice).textContent = message;
    $l('button', planNotice)?.classList.add('hidden');
    planNotice.classList.remove('hidden');
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => planNotice.classList.add('hidden'), 5000);
    return;
  }
  const toast = $l('#toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => toast.classList.add('hidden'), 5000);
  }
}

function typeOptions(selected) {
  const values = [
    ['unknown', 'Вид не определён'],
    ['department_plan', 'План кафедры'],
    ['faculty_plan', 'План факультета'],
    ['personal_plan', 'Личный план'],
    ['directive', 'Распоряжение'],
    ['order', 'Приказ'],
    ['decree', 'Указ'],
    ['department_protocol', 'Протокол кафедры'],
    ['report', 'Отчёт'],
    ['nir_report', 'Отчёт НИР'],
    ['article', 'Научный материал'],
    ['custom_document', 'Пользовательский документ'],
    ['other', 'Другой документ']
  ];
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

async function openDocumentEditor(id) {
  const item = await api(`/api/documents/${encodeURIComponent(id)}`);
  showModal(`
    <header class="lifecycle-modal-head"><div><span>Документ</span><h3>Название и вид</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header>
    <form id="lifecycle-document-edit-form" class="lifecycle-modal-body" data-document-id="${esc(item.id)}">
      <label class="field"><span>Название в системе</span><input name="title" value="${esc(item.title)}" required></label>
      <label class="field"><span>Для чего этот документ</span><select name="documentType">${typeOptions(item.document_type)}</select></label>
      <p class="lifecycle-helper">Исходное имя файла и его содержимое не изменятся.</p>
      <div class="lifecycle-modal-actions"><button class="secondary-button" type="button" data-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>
  `);
}

async function openPlanEditor(id) {
  const item = await api(`/api/plans/${encodeURIComponent(id)}`);
  showModal(`
    <header class="lifecycle-modal-head"><div><span>План</span><h3>Переименовать план</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header>
    <form id="lifecycle-plan-edit-form" class="lifecycle-modal-body" data-plan-id="${esc(item.id)}">
      <label class="field"><span>Название</span><input name="title" value="${esc(item.title)}" required></label>
      <p class="lifecycle-helper">Пункты, календарные записи и поручения сохранят свои связи.</p>
      <div class="lifecycle-modal-actions"><button class="secondary-button" type="button" data-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>
  `);
}

function impactRows(kind, impact) {
  const rows = kind === 'document' ? [
    ['Версии исходника', impact.versions],
    ['Планы', impact.plans],
    ['Пункты планов', impact.planItems],
    ['Календарные записи', impact.calendarItems],
    ['Поручения', impact.assignments],
    ['Активные поручения', impact.activeAssignments],
    ['Распоряжения', impact.directives],
    ['Заседания', impact.meetings],
    ['Шаблоны', Number(impact.extractionTemplates || 0) + Number(impact.planTemplates || 0)],
    ['Отчётные связи', impact.assignmentReports],
    ['Научные записи', impact.scientificRecords],
    ['Сопроводительные документы', impact.supportingDocuments]
  ] : [
    ['Пункты плана', impact.items],
    ['Выполнено пунктов', impact.completedItems],
    ['Календарные записи', impact.calendarItems],
    ['Поручения', impact.assignments],
    ['Активные поручения', impact.activeAssignments],
    ['Сопроводительные документы', impact.supportingDocuments],
    ['Вопросы заседаний', impact.agendaItems]
  ];
  return rows.filter(([, count]) => Number(count || 0) > 0)
    .map(([label, count]) => `<div><span>${esc(label)}</span><strong>${Number(count)}</strong></div>`).join('')
    || '<p class="lifecycle-helper">Связанных рабочих объектов пока нет.</p>';
}

async function openArchive(kind, id) {
  const collection = kind === 'document' ? 'documents' : 'plans';
  const impact = await api(`/api/${collection}/${encodeURIComponent(id)}/impact`);
  const source = kind === 'document' ? impact.document : impact.plan;
  const list = await api(kind === 'document'
    ? '/api/documents?lifecycle=active&limit=1000'
    : '/api/plans?status=active&limit=1000');
  const replacements = (list.items || []).filter((item) => item.id !== id);
  const fieldName = kind === 'document' ? 'replacementDocumentId' : 'replacementPlanId';
  showModal(`
    <header class="lifecycle-modal-head"><div><span>${kind === 'document' ? 'Документ' : 'План'}</span><h3>Убрать в архив</h3></div><button class="icon-button" type="button" data-lifecycle-close>×</button></header>
    <form id="lifecycle-archive-form" class="lifecycle-modal-body" data-kind="${kind}" data-id="${esc(id)}">
      <p>«${esc(source.title)}» исчезнет из рабочего списка, но останется в архиве со всей историей.</p>
      <section class="lifecycle-impact"><h4>Останутся связаны с исходным объектом</h4><div class="lifecycle-impact-grid">${impactRows(kind, impact)}</div></section>
      <label class="field"><span>${kind === 'document' ? 'Новый документ вместо этого' : 'Новый план вместо этого'} <small>необязательно</small></span><select name="${fieldName}">
        <option value="">Не назначать замену</option>
        ${replacements.map((item) => `<option value="${esc(item.id)}">${esc(item.title)}${item.period_key ? ` · ${esc(item.period_key)}` : ''}</option>`).join('')}
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
  $l('.nav-item[data-view="plans"]:not(.hidden), .mobile-tab[data-view="plans"]:not(.hidden)')?.click();
}

async function restore(kind, id) {
  const collection = kind === 'document' ? 'documents' : 'plans';
  await api(`/api/${collection}/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  if (kind === 'document') {
    lifecycleState.documentMode = 'active';
    refreshDocuments();
  } else {
    lifecycleState.planMode = 'active';
    refreshPlans();
  }
  notice(kind === 'document'
    ? 'Документ восстановлен и снова находится в работе.'
    : 'План восстановлен и снова находится в работе.');
}

async function waitForStandardInspector(document) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const inspector = $l('#ux-inspector');
    const title = $l('#ux-inspector-title')?.textContent?.trim();
    if (inspector && !inspector.classList.contains('hidden') && title === document.title) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function enhanceStandardInspector(id) {
  const document = await api(`/api/documents/${encodeURIComponent(id)}`);
  if (!(await waitForStandardInspector(document))) return;
  const body = $l('#ux-inspector-body');
  const actions = $l('#ux-inspector-actions');
  if (!body || !actions) return;

  $l('#lifecycle-document-inspector', body)?.remove();
  body.insertAdjacentHTML('beforeend', `
    <section id="lifecycle-document-inspector" class="inspector-section">
      <div class="inspector-section-head"><h3>Жизненный цикл</h3><span class="lifecycle-badge ${document.lifecycle_status === 'archived' ? 'archived' : 'active'}">${esc(lifecycleLabel(document))}</span></div>
      ${document.replacement ? `<div class="lifecycle-inspector-callout"><strong>Заменён документом «${esc(document.replacement.title)}»</strong><p>Старые планы, поручения, отчёты и доказательства продолжают ссылаться на этот исходник.</p><button class="secondary-button" type="button" data-lifecycle-document-open="${esc(document.replacement.id)}">Открыть продолжение</button></div>` : ''}
      ${document.lifecycle_status === 'archived' ? `<p><strong>Архив:</strong> ${esc(document.archive_reason || 'причина не указана')} · ${esc(dateLabel(document.archived_at))}</p>` : ''}
      <div class="source-note">Архивирование не удаляет файл, версии, извлечённые факты и историю изменений.</div>
    </section>
  `);

  $$l('[data-lifecycle-inspector-action]', actions).forEach((element) => element.remove());
  actions.insertAdjacentHTML('beforeend', `
    <button class="secondary-button" type="button" data-lifecycle-inspector-action data-lifecycle-document-edit="${esc(document.id)}">Переименовать</button>
    ${document.lifecycle_status === 'archived'
      ? `<button class="primary-button" type="button" data-lifecycle-inspector-action data-lifecycle-document-restore="${esc(document.id)}">Восстановить</button>`
      : `<button class="primary-button" type="button" data-lifecycle-inspector-action data-lifecycle-document-archive="${esc(document.id)}">В архив</button>`}
  `);
}

async function openDocumentThroughStandardInspector(id) {
  let title = $l(`#documents-table tr[data-document-id="${CSS.escape(id)}"] .document-open`);
  if (!title) {
    const document = await api(`/api/documents/${encodeURIComponent(id)}`);
    lifecycleState.documentMode = document.lifecycle_status === 'archived' ? 'archived' : 'active';
    refreshDocuments();
    for (let attempt = 0; attempt < 60 && !title; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      title = $l(`#documents-table tr[data-document-id="${CSS.escape(id)}"] .document-open`);
    }
  }
  if (!title) throw new Error('Не удалось открыть документ в текущем списке.');
  title.click();
}

const observer = new MutationObserver(schedulePatch);
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', (event) => {
  const mode = event.target.closest('[data-document-lifecycle]');
  if (mode) {
    lifecycleState.documentMode = mode.dataset.documentLifecycle;
    renderControls();
    refreshDocuments();
    return;
  }

  const ordinaryTitle = event.target.closest('.document-open');
  if (ordinaryTitle && !event.target.closest('[data-lifecycle-document-open]')) {
    const id = ordinaryTitle.closest('[data-document-id]')?.dataset.documentId;
    if (id) setTimeout(() => enhanceStandardInspector(id).catch(() => {}), 0);
    return;
  }

  const explicitOpen = event.target.closest('[data-lifecycle-document-open]');
  if (explicitOpen) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openDocumentThroughStandardInspector(explicitOpen.dataset.lifecycleDocumentOpen)
      .catch((error) => notice(error.message));
    return;
  }

  const documentEdit = event.target.closest('[data-lifecycle-document-edit]');
  if (documentEdit) {
    $l('#ux-inspector-close')?.click();
    openDocumentEditor(documentEdit.dataset.lifecycleDocumentEdit).catch((error) => notice(error.message));
    return;
  }
  const documentArchive = event.target.closest('[data-lifecycle-document-archive]');
  if (documentArchive) {
    $l('#ux-inspector-close')?.click();
    openArchive('document', documentArchive.dataset.lifecycleDocumentArchive).catch((error) => notice(error.message));
    return;
  }
  const documentRestore = event.target.closest('[data-lifecycle-document-restore]');
  if (documentRestore) {
    $l('#ux-inspector-close')?.click();
    restore('document', documentRestore.dataset.lifecycleDocumentRestore).catch((error) => notice(error.message));
    return;
  }

  const planEdit = event.target.closest('[data-lifecycle-plan-edit]');
  if (planEdit) return openPlanEditor(planEdit.dataset.lifecyclePlanEdit).catch((error) => notice(error.message));
  const planArchive = event.target.closest('[data-lifecycle-plan-archive]');
  if (planArchive) return openArchive('plan', planArchive.dataset.lifecyclePlanArchive).catch((error) => notice(error.message));
  const planRestore = event.target.closest('[data-lifecycle-plan-restore]');
  if (planRestore) return restore('plan', planRestore.dataset.lifecyclePlanRestore).catch((error) => notice(error.message));
  const openPlan = event.target.closest('[data-lifecycle-open-plan]');
  if (openPlan && typeof window.kafedraOpenPlan === 'function') return window.kafedraOpenPlan(openPlan.dataset.lifecycleOpenPlan);

  if (event.target.closest('[data-lifecycle-close]') || event.target === $l('#lifecycle-modal-backdrop')) closeModal();
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
    api(`/api/documents/${encodeURIComponent(form.dataset.documentId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: data.get('title'), documentType: data.get('documentType') })
    }).then(() => {
      closeModal();
      refreshDocuments();
      notice('Сведения о документе обновлены. Исходный файл не изменён.');
    }).catch((error) => notice(error.message));
  }

  if (event.target.id === 'lifecycle-plan-edit-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    api(`/api/plans/${encodeURIComponent(form.dataset.planId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: data.get('title') })
    }).then(() => {
      closeModal();
      refreshPlans();
      notice('План переименован. Все связанные объекты сохранены.');
    }).catch((error) => notice(error.message));
  }

  if (event.target.id === 'lifecycle-archive-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const kind = form.dataset.kind;
    const body = kind === 'document'
      ? { replacementDocumentId: data.get('replacementDocumentId') || null, reason: data.get('reason') || null }
      : { replacementPlanId: data.get('replacementPlanId') || null, reason: data.get('reason') || null };
    const collection = kind === 'document' ? 'documents' : 'plans';
    api(`/api/${collection}/${encodeURIComponent(form.dataset.id)}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(() => {
      closeModal();
      if (kind === 'document') {
        lifecycleState.documentMode = 'archived';
        refreshDocuments();
      } else {
        lifecycleState.planMode = 'archived';
        refreshPlans();
      }
      notice(kind === 'document'
        ? 'Документ перемещён в архив. Файл, версии и связи сохранены.'
        : 'План перемещён в архив. Пункты, календарь, поручения и отчёты сохранены.');
    }).catch((error) => notice(error.message));
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$l('#lifecycle-modal')?.classList.contains('hidden')) closeModal();
}, true);

ensureUi();
schedulePatch();
