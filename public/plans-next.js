const plansState = {
  active: false,
  items: [],
  facets: { kinds: [], periods: [], directions: [] },
  selectedPlanId: null,
  selectedPlan: null,
  templates: [],
  uploadDocumentId: null,
  lastCalendarItem: null,
  filters: { q: '', kind: '', periodKey: '', direction: '', responsible: '' },
  generation: { plan: null, template: null, sourceYear: null, rows: [] },
  templateReview: null
};

const plansNativeFetch = window.fetch.bind(window);

window.fetch = async function plansObservedFetch(input, init = {}) {
  const response = await plansNativeFetch(input, init);
  try {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.origin);
    if (method === 'GET' && url.origin === window.location.origin && /^\/api\/calendar\/[^/]+$/.test(url.pathname)) {
      const clone = response.clone();
      clone.json().then((item) => {
        plansState.lastCalendarItem = item;
        setTimeout(patchPlanCalendarInspector, 0);
      }).catch(() => {});
    }
  } catch {}
  return response;
};

const $p = (selector, root = document) => root.querySelector(selector);
const $$p = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function planApi(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.code = data?.error?.code || null;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

function kindLabel(kind) {
  return {
    department: 'Кафедра',
    faculty: 'Факультет',
    personal: 'Личный',
    unit: 'Подразделение',
    organization: 'Организация'
  }[kind] || 'План';
}

function kindFullLabel(kind) {
  return {
    department: 'План кафедры',
    faculty: 'План факультета',
    personal: 'Личный план',
    unit: 'План подразделения',
    organization: 'План организации'
  }[kind] || 'План';
}

function directionLabel(value) {
  return {
    science: 'Наука',
    education: 'Образование',
    organizational: 'Организация',
    everyday: 'Повседневная'
  }[value] || value || 'Организация';
}

function dateShort(value) {
  if (!value) return 'Срок не задан';
  const date = new Date(`${String(value).slice(0, 10)}T09:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function ensurePlanStyles() {
  if ($p('#plans-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'plans-next-styles';
  link.rel = 'stylesheet';
  link.href = '/plans-next.css';
  document.head.append(link);
}

function ensurePlansUi() {
  ensurePlanStyles();
  const nav = $p('#navigation');
  if (nav && !$p('[data-view="plans"]', nav)) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'plans';
    button.innerHTML = '<span class="nav-icon" aria-hidden="true">▥</span><span>Планы</span>';
    nav.querySelector('[data-view="documents"]')?.before(button);
  }
  const mobile = $p('.mobile-tabs');
  if (mobile && !$p('[data-view="plans"]', mobile)) {
    const button = document.createElement('button');
    button.className = 'mobile-tab plans-mobile-tab';
    button.dataset.view = 'plans';
    button.innerHTML = '<span>▥</span>Планы';
    mobile.querySelector('[data-view="documents"]')?.before(button);
  }
  const workspace = $p('.workspace');
  if (workspace && !$p('[data-view-panel="plans"]')) {
    workspace.insertAdjacentHTML('beforeend', `
      <section class="view plans-view" data-view-panel="plans">
        <div class="plans-heading">
          <div>
            <h2>Планы работы</h2>
            <p>Загружайте готовые планы, исправляйте неоднозначные строки и формируйте новый DOCX по прошлому образцу.</p>
          </div>
          <div class="plans-heading-actions">
            <input id="plans-upload-input" type="file" accept=".docx,.odt,.xlsx,.ods,.pdf,.txt" hidden>
            <button id="plans-upload-button" class="secondary-button" type="button">Загрузить план</button>
            <button id="plans-generate-button" class="primary-button" type="button">Сформировать по образцу</button>
          </div>
        </div>
        <div class="plans-filterbar">
          <label class="plans-search"><span aria-hidden="true">⌕</span><input id="plans-q" type="search" placeholder="Мероприятие или текст"></label>
          <select id="plans-kind" aria-label="Вид плана">
            <option value="">Все виды</option>
            <option value="department">Кафедра</option>
            <option value="faculty">Факультет</option>
            <option value="personal">Личный</option>
            <option value="unit">Подразделение</option>
            <option value="organization">Организация</option>
          </select>
          <select id="plans-period" aria-label="Период"><option value="">Все годы</option></select>
          <select id="plans-direction" aria-label="Направление">
            <option value="">Все направления</option>
            <option value="education">Образование</option>
            <option value="science">Наука</option>
            <option value="organizational">Организация</option>
            <option value="everyday">Повседневная</option>
          </select>
          <input id="plans-responsible" type="search" placeholder="Ответственный" aria-label="Ответственный">
          <button id="plans-reset" class="quiet-button" type="button">Сбросить</button>
        </div>
        <div class="plans-layout">
          <section class="plans-list-panel" aria-label="Список планов">
            <div id="plans-list" class="plans-list"><div class="empty-state">Загрузка…</div></div>
          </section>
          <section id="plan-detail" class="plan-detail-panel"><div class="empty-state">Выберите план слева.</div></section>
        </div>
      </section>
    `);
  }
  if (!$p('#plans-modal-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="plans-modal-backdrop" class="plans-modal-backdrop hidden"></div>
      <section id="plan-item-modal" class="plans-modal hidden" role="dialog" aria-modal="true" aria-labelledby="plan-item-modal-title"></section>
      <section id="plan-generate-modal" class="plans-modal plans-generate-modal hidden" role="dialog" aria-modal="true" aria-labelledby="plan-generate-modal-title"></section>
      <section id="plan-template-modal" class="plans-modal hidden" role="dialog" aria-modal="true" aria-labelledby="plan-template-modal-title"></section>
      <div id="plans-notice" class="plans-notice hidden" role="status" aria-live="polite"><span></span><button type="button" class="hidden">Отменить</button></div>
    `);
  }
}

function activatePlansView(planId = null) {
  ensurePlansUi();
  plansState.active = true;
  $$p('.nav-item, .mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'plans'));
  $$p('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'plans'));
  if ($p('#page-title')) $p('#page-title').textContent = 'Планы';
  if ($p('#page-subtitle')) $p('#page-subtitle').textContent = 'Рабочие планы, пункты, сроки и источники';
  $p('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  if (planId) plansState.selectedPlanId = planId;
  loadPlans().catch((error) => showPlanNotice(error.message));
}

function deactivatePlansView() {
  plansState.active = false;
}

function queryString() {
  const params = new URLSearchParams({ limit: '500' });
  for (const [key, value] of Object.entries(plansState.filters)) if (value) params.set(key, value);
  return params.toString();
}

function fillFacetSelects() {
  const period = $p('#plans-period');
  if (!period) return;
  const selected = plansState.filters.periodKey;
  period.innerHTML = '<option value="">Все годы</option>' + (plansState.facets.periods || [])
    .map((item) => `<option value="${esc(item.value)}">${esc(item.value)} · ${item.count}</option>`).join('');
  period.value = selected;
}

async function loadPlans() {
  if (!plansState.active) return;
  const data = await planApi(`/api/plans?${queryString()}`);
  plansState.items = data.items || [];
  plansState.facets = data.facets || plansState.facets;
  fillFacetSelects();
  if (plansState.selectedPlanId && !plansState.items.some((item) => item.id === plansState.selectedPlanId)) {
    plansState.selectedPlanId = null;
    plansState.selectedPlan = null;
  }
  if (!plansState.selectedPlanId && plansState.items.length) plansState.selectedPlanId = plansState.items[0].id;
  renderPlanList();
  if (plansState.selectedPlanId) await loadPlanDetail(plansState.selectedPlanId);
  else renderPlanDetail(null);
}

function renderPlanList() {
  const target = $p('#plans-list');
  if (!target) return;
  target.innerHTML = plansState.items.length ? plansState.items.map((plan) => `
    <button class="plan-card ${plan.id === plansState.selectedPlanId ? 'active' : ''}" type="button" data-plan-id="${esc(plan.id)}">
      <span class="plan-card-kind">${esc(kindLabel(plan.plan_kind))}</span>
      <strong>${esc(plan.title)}</strong>
      <span class="plan-card-period">${esc(plan.period_key || 'Период не определён')}</span>
      <span class="plan-card-meta">${Number(plan.dated_item_count || 0)} из ${Number(plan.item_count || 0)} со сроком</span>
    </button>
  `).join('') : '<div class="empty-state">Планов по этим условиям нет.</div>';
}

async function loadPlanDetail(planId) {
  const plan = await planApi(`/api/plans/${encodeURIComponent(planId)}`);
  plansState.selectedPlanId = plan.id;
  plansState.selectedPlan = plan;
  renderPlanList();
  renderPlanDetail(plan);
}

function itemDateText(item) {
  if (item.due_date && item.starts_at) return `${dateShort(item.starts_at)} · контроль ${dateShort(item.due_date)}`;
  if (item.due_date) return `до ${dateShort(item.due_date)}`;
  if (item.starts_at && item.ends_at && item.starts_at !== item.ends_at) return `${dateShort(item.starts_at)} — ${dateShort(item.ends_at)}`;
  return item.starts_at ? dateShort(item.starts_at) : 'Срок требует уточнения';
}

function evidenceLabel(item) {
  const locator = item.evidence?.locator || {};
  if (locator.table && locator.row) return `таблица ${locator.table}, строка ${locator.row}`;
  if (locator.sheet && locator.row) return `${locator.sheet}, строка ${locator.row}`;
  if (locator.page) return `страница ${locator.page}${locator.line ? `, строка ${locator.line}` : ''}`;
  if (locator.line) return `строка ${locator.line}`;
  return 'исходный фрагмент сохранён';
}

function renderPlanDetail(plan) {
  const target = $p('#plan-detail');
  if (!target) return;
  if (!plan) {
    target.innerHTML = '<div class="empty-state">Выберите план слева или загрузите новый.</div>';
    return;
  }
  const isDocx = String(plan.source_original_name || '').toLowerCase().endsWith('.docx');
  target.innerHTML = `
    <header class="plan-detail-head">
      <div>
        <div class="plan-detail-kicker">${esc(kindFullLabel(plan.plan_kind))} · ${esc(plan.period_key || 'период не определён')}</div>
        <h3>${esc(plan.title)}</h3>
        <p>${plan.owner_name || plan.owner_raw ? `Владелец: ${esc(plan.owner_name || plan.owner_raw)}` : 'Общий план подразделения'}</p>
      </div>
      <div class="plan-detail-actions">
        <a class="secondary-button plan-link-button" href="/api/documents/${encodeURIComponent(plan.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Исходный документ</a>
        ${isDocx ? '<button class="secondary-button" type="button" data-plan-make-template>Сделать образцом</button>' : ''}
        <button class="primary-button" type="button" data-plan-generate-current>Сформировать новый</button>
      </div>
    </header>
    <div class="plan-summary-strip">
      <span><strong>${plan.items.length}</strong> пунктов</span>
      <span><strong>${plan.items.filter((item) => item.starts_at || item.due_date).length}</strong> со сроком</span>
      <span><strong>${plan.items.filter((item) => !item.starts_at && !item.due_date).length}</strong> требуют даты</span>
    </div>
    <div class="plan-items-table-wrap">
      <table class="plan-items-table">
        <thead><tr><th>№</th><th>Мероприятие</th><th>Срок</th><th>Ответственный</th><th>Направление</th><th></th></tr></thead>
        <tbody>
          ${plan.items.map((item) => `
            <tr class="${!item.starts_at && !item.due_date ? 'needs-date' : ''}" data-plan-item-row="${esc(item.id)}">
              <td>${esc(item.item_no || '—')}</td>
              <td><strong>${esc(item.title)}</strong>${item.expected_result ? `<small>Результат: ${esc(item.expected_result)}</small>` : ''}<small>Источник: ${esc(evidenceLabel(item))}</small></td>
              <td>${esc(itemDateText(item))}</td>
              <td>${esc(item.responsible_name || item.responsible_raw || 'Не указан')}</td>
              <td>${esc(directionLabel(item.direction))}</td>
              <td><button class="row-button" type="button" data-plan-edit-item="${esc(item.id)}">Исправить</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function showModal(id, html) {
  ensurePlansUi();
  $p(id).innerHTML = html;
  $p('#plans-modal-backdrop').classList.remove('hidden');
  $p(id).classList.remove('hidden');
  document.body.classList.add('plans-modal-open');
}

function closePlanModals() {
  $p('#plans-modal-backdrop')?.classList.add('hidden');
  $$p('.plans-modal').forEach((modal) => modal.classList.add('hidden'));
  document.body.classList.remove('plans-modal-open');
}

function showPlanNotice(message, undo = null) {
  const notice = $p('#plans-notice');
  if (!notice) return;
  $p('span', notice).textContent = message;
  const button = $p('button', notice);
  button.classList.toggle('hidden', !undo);
  button.onclick = undo ? async () => {
    button.disabled = true;
    try { await undo(); } finally { button.disabled = false; notice.classList.add('hidden'); }
  } : null;
  notice.classList.remove('hidden');
  clearTimeout(showPlanNotice.timer);
  showPlanNotice.timer = setTimeout(() => notice.classList.add('hidden'), undo ? 9000 : 4300);
}

function openItemEditor(itemId) {
  const plan = plansState.selectedPlan;
  const item = plan?.items.find((candidate) => candidate.id === itemId);
  if (!plan || !item) return;
  showModal('#plan-item-modal', `
    <header class="plans-modal-head"><div><span>Пункт плана</span><h3 id="plan-item-modal-title">Исправить сведения</h3></div><button class="icon-button" type="button" data-plans-close>×</button></header>
    <form id="plan-item-form" class="plans-modal-body">
      <input type="hidden" name="itemId" value="${esc(item.id)}">
      <label class="field"><span>Мероприятие</span><input name="title" value="${esc(item.title)}" required></label>
      <div class="plans-form-two">
        <label class="field"><span>Начало</span><input name="startsAt" type="date" value="${esc(item.starts_at || '')}"></label>
        <label class="field"><span>Окончание</span><input name="endsAt" type="date" value="${esc(item.ends_at || '')}"></label>
      </div>
      <label class="field"><span>Контрольный срок</span><input name="dueDate" type="date" value="${esc(item.due_date || '')}"></label>
      <label class="field"><span>Ответственный</span><input name="responsibleRaw" value="${esc(item.responsible_raw || '')}" placeholder="Точное ФИО из справочника или исходное значение"></label>
      <label class="field"><span>Направление</span><select name="direction">
        ${['organizational','education','science','everyday'].map((value) => `<option value="${value}" ${item.direction === value ? 'selected' : ''}>${esc(directionLabel(value))}</option>`).join('')}
      </select></label>
      <label class="field"><span>Ожидаемый результат</span><input name="expectedResult" value="${esc(item.expected_result || '')}"></label>
      <label class="field"><span>Почему исправлено</span><input name="reason" placeholder="Коротко, например: уточнено по строке исходника"></label>
      <div class="plans-evidence-note">Исходное доказательство не изменится: ${esc(evidenceLabel(item))}.</div>
      <div class="plans-modal-actions"><button class="secondary-button" type="button" data-plans-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>
  `);
}

async function saveItemCorrection(form) {
  const data = new FormData(form);
  const itemId = String(data.get('itemId'));
  const body = {
    title: String(data.get('title') || '').trim(),
    startsAt: data.get('startsAt') || null,
    endsAt: data.get('endsAt') || null,
    dueDate: data.get('dueDate') || null,
    responsibleRaw: data.get('responsibleRaw') || null,
    direction: data.get('direction'),
    expectedResult: data.get('expectedResult') || null,
    reason: data.get('reason') || null
  };
  await planApi(`/api/plans/${encodeURIComponent(plansState.selectedPlanId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  closePlanModals();
  await loadPlanDetail(plansState.selectedPlanId);
  showPlanNotice('Исправление сохранено. Исходные данные и доказательство оставлены в истории.', async () => {
    await planApi(`/api/plans/${encodeURIComponent(plansState.selectedPlanId)}/items/${encodeURIComponent(itemId)}/undo`, { method: 'POST' });
    await loadPlanDetail(plansState.selectedPlanId);
    showPlanNotice('Исправление отменено.');
  });
}

async function uploadPlan(file) {
  if (!file) return;
  showPlanNotice(`Загружается «${file.name}»…`);
  const response = await planApi('/api/documents', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-document-type': 'plan',
      'idempotency-key': `plan-ui:${file.name}:${file.size}:${file.lastModified}`
    },
    body: file
  });
  plansState.uploadDocumentId = response.documentId;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const document = await planApi(`/api/documents/${encodeURIComponent(response.documentId)}`);
    if (['processed', 'needs_review', 'failed'].includes(document.processing_status)) {
      if (document.processing_status === 'failed') throw new Error('Документ сохранён, но его обработка завершилась ошибкой.');
      const plans = await planApi('/api/plans?limit=500');
      const created = (plans.items || []).find((item) => item.source_document_id === response.documentId);
      if (created) plansState.selectedPlanId = created.id;
      await loadPlans();
      showPlanNotice(created ? 'План загружен и добавлен в календарь.' : 'Документ обработан. Проверьте вопросы распознавания.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await loadPlans();
  showPlanNotice('План принят. Обработка продолжается на сервере.');
}

async function listTemplates() {
  const data = await planApi('/api/plan-templates?limit=300');
  plansState.templates = data.items || [];
  return plansState.templates;
}

function templateConfigFromSelection(analysis, periodIndex, tableIndex, allowUnmapped) {
  const period = analysis.periodCandidates[periodIndex];
  const table = analysis.tableCandidates[tableIndex];
  if (!period || !table || !table.templateRow) throw new Error('Выберите распознанный год и таблицу с примером строки.');
  return {
    planKind: plansState.selectedPlan.plan_kind,
    periodKind: period.kind,
    periodAnchors: [{
      paragraphIndex: period.paragraphIndex,
      kind: period.kind,
      sourceYearStart: period.yearStart,
      sourceYearEnd: period.yearEnd,
      endDigits: period.endDigits,
      raw: period.raw,
      text: period.text
    }],
    tableIndex: table.tableIndex,
    headerRow: table.headerRow,
    templateRow: table.templateRow,
    dataStartRow: table.dataStartRow,
    dataEndRow: table.dataEndRow,
    columns: table.columns,
    clearColumns: table.clearColumns,
    allowUnmappedColumns: Boolean(allowUnmapped)
  };
}

function openTemplateReview(analysis) {
  plansState.templateReview = analysis;
  showModal('#plan-template-modal', `
    <header class="plans-modal-head"><div><span>Образец DOCX</span><h3 id="plan-template-modal-title">Уточните структуру</h3></div><button class="icon-button" type="button" data-plans-close>×</button></header>
    <form id="plan-template-review-form" class="plans-modal-body">
      <p class="plans-modal-copy">Система не будет угадывать неоднозначные места. Выберите подпись года и таблицу, которые действительно относятся к плану.</p>
      <label class="field"><span>Год в документе</span><select name="periodIndex">
        ${(analysis.periodCandidates || []).map((item, index) => `<option value="${index}">${esc(item.text)} · ${item.kind === 'academic' ? `${item.yearStart}/${String(item.yearEnd).slice(-2)}` : item.yearStart}</option>`).join('')}
      </select></label>
      <label class="field"><span>Таблица мероприятий</span><select name="tableIndex">
        ${(analysis.tableCandidates || []).map((item, index) => `<option value="${index}">Таблица ${item.tableIndex} · ${item.rowCount} строк · ${Object.keys(item.columns || {}).length} распознанных колонок</option>`).join('')}
      </select></label>
      <label class="check-field"><input type="checkbox" name="allowUnmapped"><span>Очистить непонятные колонки при формировании нового документа</span></label>
      <div class="plans-modal-actions"><button class="secondary-button" type="button" data-plans-close>Отмена</button><button class="primary-button" type="submit">Сохранить образец</button></div>
    </form>
  `);
}

async function ensureTemplateForCurrentPlan({ interactive = true } = {}) {
  const plan = plansState.selectedPlan;
  if (!plan) throw new Error('Сначала выберите план.');
  if (!String(plan.source_original_name || '').toLowerCase().endsWith('.docx')) {
    throw new Error('Для формирования по образцу нужен исходный DOCX.');
  }
  const templates = await listTemplates();
  const existing = templates.find((item) => item.source_document_id === plan.source_document_id);
  if (existing) return existing;
  const analysis = await planApi('/api/plan-templates/analyze', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documentId: plan.source_document_id, planKind: plan.plan_kind })
  });
  if (!analysis.ready) {
    if (interactive) openTemplateReview(analysis);
    return null;
  }
  return await planApi('/api/plan-templates', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      documentId: plan.source_document_id,
      name: `${kindFullLabel(plan.plan_kind)} · образец ${plan.period_key || ''}`.trim(),
      planKind: plan.plan_kind
    })
  });
}

function shiftIso(value, delta) {
  if (!value || !delta) return value || '';
  const match = String(value).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[1]) + delta}-${match[2]}-${match[3]}`;
}

function nextPeriod(plan) {
  if (plan.period_kind === 'academic' && plan.year_start) return `${Number(plan.year_start) + 1}/${String(Number(plan.year_end || plan.year_start + 1) + 1).slice(-2)}`;
  if (plan.year_start) return String(Number(plan.year_start) + 1);
  return plan.period_key || String(new Date().getFullYear() + 1);
}

function generationRows(plan, targetKey) {
  let targetStart = Number(String(targetKey).slice(0, 4));
  if (!Number.isInteger(targetStart)) targetStart = Number(plan.year_start || 0);
  const delta = targetStart && plan.year_start ? targetStart - Number(plan.year_start) : 0;
  return plan.items.map((item, index) => ({
    itemNo: item.item_no || String(index + 1),
    title: item.title,
    startsAt: shiftIso(item.starts_at, delta),
    endsAt: shiftIso(item.ends_at, delta),
    dueDate: shiftIso(item.due_date, delta),
    responsibleRaw: item.responsible_raw || '',
    expectedResult: item.expected_result || '',
    direction: item.direction || 'organizational'
  }));
}

function renderGenerationRows() {
  const target = $p('#plan-generation-rows');
  if (!target) return;
  target.innerHTML = plansState.generation.rows.map((item, index) => `
    <div class="generation-row" data-generation-row="${index}">
      <input class="generation-number" name="number" value="${esc(item.itemNo)}" aria-label="Номер">
      <input class="generation-title" name="title" value="${esc(item.title)}" aria-label="Мероприятие">
      <input name="startsAt" type="date" value="${esc(item.startsAt || '')}" aria-label="Дата">
      <input name="dueDate" type="date" value="${esc(item.dueDate || '')}" aria-label="Контрольный срок">
      <input name="responsibleRaw" value="${esc(item.responsibleRaw || '')}" aria-label="Ответственный">
      <button class="icon-button generation-remove" type="button" data-generation-remove="${index}" aria-label="Удалить строку">×</button>
    </div>
  `).join('');
}

async function openGeneration() {
  const plan = plansState.selectedPlan;
  if (!plan) throw new Error('Сначала выберите план.');
  const template = await ensureTemplateForCurrentPlan({ interactive: true });
  if (!template) return;
  const targetKey = nextPeriod(plan);
  plansState.generation = { plan, template, sourceYear: plan.year_start, rows: generationRows(plan, targetKey) };
  showModal('#plan-generate-modal', `
    <header class="plans-modal-head"><div><span>Новый план</span><h3 id="plan-generate-modal-title">Сформировать по образцу</h3></div><button class="icon-button" type="button" data-plans-close>×</button></header>
    <form id="plan-generation-form" class="plans-modal-body">
      <div class="plans-form-two">
        <label class="field"><span>Образец</span><select id="plan-generation-template" name="templateId">
          ${plansState.templates.concat([template]).filter((value, index, array) => array.findIndex((item) => item.id === value.id) === index).map((item) => `<option value="${esc(item.id)}" ${item.id === template.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
        </select></label>
        <label class="field"><span>${template.period_kind === 'academic' ? 'Учебный год' : 'Год'}</span><input id="plan-generation-period" name="periodKey" value="${esc(targetKey)}" placeholder="${template.period_kind === 'academic' ? '2027/28' : '2027'}" required></label>
      </div>
      <label class="field"><span>Название документа</span><input name="title" value="${esc(`${kindFullLabel(plan.plan_kind)} ${targetKey}`)}"></label>
      <div class="generation-toolbar"><strong>Пункты плана</strong><button class="secondary-button" type="button" data-generation-add>Добавить строку</button></div>
      <div class="generation-head"><span>№</span><span>Мероприятие</span><span>Дата</span><span>Контроль</span><span>Ответственный</span><span></span></div>
      <div id="plan-generation-rows" class="generation-rows"></div>
      <p class="plans-helper">Даты перенесены на следующий период автоматически. Проверьте их перед формированием.</p>
      <div class="plans-modal-actions"><button class="secondary-button" type="button" data-plans-close>Отмена</button><button class="primary-button" type="submit">Сформировать DOCX</button></div>
    </form>
  `);
  renderGenerationRows();
}

function collectGenerationRows() {
  return $$p('[data-generation-row]').map((row, index) => ({
    itemNo: $p('[name="number"]', row).value.trim() || String(index + 1),
    title: $p('[name="title"]', row).value.trim(),
    startsAt: $p('[name="startsAt"]', row).value || null,
    dueDate: $p('[name="dueDate"]', row).value || null,
    responsibleRaw: $p('[name="responsibleRaw"]', row).value.trim() || null,
    expectedResult: plansState.generation.rows[index]?.expectedResult || null,
    direction: plansState.generation.rows[index]?.direction || 'organizational'
  })).filter((item) => item.title);
}

async function digestKey(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function submitGeneration(form) {
  const data = new FormData(form);
  const templateId = String(data.get('templateId'));
  const template = plansState.templates.find((item) => item.id === templateId) || plansState.generation.template;
  const periodKey = String(data.get('periodKey') || '').trim();
  const items = collectGenerationRows();
  if (!items.length) throw new Error('Добавьте хотя бы один пункт.');
  const targetPeriod = { periodKind: template.period_kind, periodKey };
  const payload = {
    targetPeriod,
    title: String(data.get('title') || '').trim() || null,
    items
  };
  payload.idempotencyKey = `plans-ui:${await digestKey({ templateId, ...payload })}`;
  const generated = await planApi(`/api/plan-templates/${encodeURIComponent(templateId)}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  closePlanModals();
  showPlanNotice('DOCX сформирован. Система проверяет его и добавляет сроки в календарь.');
  if (generated.generated_document_id) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const document = await planApi(`/api/documents/${encodeURIComponent(generated.generated_document_id)}`);
      if (['processed', 'needs_review', 'failed'].includes(document.processing_status)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const list = await planApi(`/api/plans?periodKey=${encodeURIComponent(periodKey)}&limit=500`);
    const created = (list.items || []).find((item) => item.source_document_id === generated.generated_document_id);
    if (created) plansState.selectedPlanId = created.id;
  }
  await loadPlans();
}

async function saveTemplateReview(form) {
  const analysis = plansState.templateReview;
  const data = new FormData(form);
  const config = templateConfigFromSelection(
    analysis,
    Number(data.get('periodIndex')),
    Number(data.get('tableIndex')),
    data.get('allowUnmapped') === 'on'
  );
  const plan = plansState.selectedPlan;
  const template = await planApi('/api/plan-templates', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      documentId: plan.source_document_id,
      name: `${kindFullLabel(plan.plan_kind)} · образец ${plan.period_key || ''}`.trim(),
      planKind: plan.plan_kind,
      config
    })
  });
  closePlanModals();
  plansState.templates = await listTemplates();
  showPlanNotice('Образец сохранён. Исходный DOCX не изменён.');
  return template;
}

function patchPlanCalendarInspector() {
  const item = plansState.lastCalendarItem;
  const inspector = $p('#ux-inspector');
  if (!item || item.source_kind !== 'plan_item' || !inspector || inspector.classList.contains('hidden')) return;
  if ($p('#ux-inspector-title')?.textContent !== item.title) return;
  const facts = $$p('#ux-inspector-body .inspector-facts > div');
  const sourceRow = facts.find((row) => $p('dt', row)?.textContent?.trim() === 'Источник');
  if (sourceRow) $p('dd', sourceRow).textContent = item.origin_label || 'План работы';
  const actions = $p('#ux-inspector-actions');
  if (!actions || $p('[data-open-plan-source]', actions)) return;
  actions.insertAdjacentHTML('afterbegin', `
    <button type="button" class="secondary-button" data-open-plan-source="${esc(item.origin_id)}">Открыть план</button>
    ${item.source_document_id ? `<a class="secondary-button plan-link-button" href="/api/documents/${encodeURIComponent(item.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Исходный документ</a>` : ''}
  `);
}

function bindFilterState() {
  const debounce = (fn, delay = 250) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  };
  const delayed = debounce(() => {
    plansState.filters.q = $p('#plans-q')?.value.trim() || '';
    plansState.filters.responsible = $p('#plans-responsible')?.value.trim() || '';
    loadPlans().catch((error) => showPlanNotice(error.message));
  });
  $p('#plans-q')?.addEventListener('input', delayed);
  $p('#plans-responsible')?.addEventListener('input', delayed);
  for (const [selector, key] of [['#plans-kind','kind'],['#plans-period','periodKey'],['#plans-direction','direction']]) {
    $p(selector)?.addEventListener('change', (event) => {
      plansState.filters[key] = event.target.value;
      loadPlans().catch((error) => showPlanNotice(error.message));
    });
  }
}

document.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view="plans"]');
  if (view) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activatePlansView();
    return;
  }
  if (event.target.closest('[data-view]') && !event.target.closest('[data-view="plans"]')) deactivatePlansView();

  const planCard = event.target.closest('[data-plan-id]');
  if (planCard) {
    plansState.selectedPlanId = planCard.dataset.planId;
    loadPlanDetail(plansState.selectedPlanId).catch((error) => showPlanNotice(error.message));
    return;
  }
  const edit = event.target.closest('[data-plan-edit-item]');
  if (edit) return openItemEditor(edit.dataset.planEditItem);
  if (event.target.closest('[data-plans-close]') || event.target === $p('#plans-modal-backdrop')) return closePlanModals();

  if (event.target.closest('#plans-upload-button')) return $p('#plans-upload-input')?.click();
  if (event.target.closest('#plans-reset')) {
    plansState.filters = { q: '', kind: '', periodKey: '', direction: '', responsible: '' };
    for (const selector of ['#plans-q','#plans-kind','#plans-period','#plans-direction','#plans-responsible']) if ($p(selector)) $p(selector).value = '';
    return loadPlans().catch((error) => showPlanNotice(error.message));
  }
  if (event.target.closest('#plans-generate-button, [data-plan-generate-current]')) {
    openGeneration().catch((error) => showPlanNotice(error.message));
    return;
  }
  if (event.target.closest('[data-plan-make-template]')) {
    ensureTemplateForCurrentPlan({ interactive: true }).then((template) => {
      if (template) showPlanNotice('Образец готов для формирования новых планов.');
    }).catch((error) => showPlanNotice(error.message));
    return;
  }
  const openPlan = event.target.closest('[data-open-plan-source]');
  if (openPlan) {
    event.preventDefault();
    event.stopImmediatePropagation();
    $p('#ux-inspector-close')?.click();
    return activatePlansView(openPlan.dataset.openPlanSource);
  }
  const remove = event.target.closest('[data-generation-remove]');
  if (remove) {
    plansState.generation.rows.splice(Number(remove.dataset.generationRemove), 1);
    return renderGenerationRows();
  }
  if (event.target.closest('[data-generation-add]')) {
    plansState.generation.rows.push({
      itemNo: String(plansState.generation.rows.length + 1), title: '', startsAt: '', dueDate: '',
      responsibleRaw: '', expectedResult: '', direction: 'organizational'
    });
    return renderGenerationRows();
  }
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'plan-generation-period' && plansState.generation.plan) {
    plansState.generation.rows = generationRows(plansState.generation.plan, event.target.value.trim());
    renderGenerationRows();
  }
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id === 'plan-item-form') {
    event.preventDefault();
    saveItemCorrection(event.target).catch((error) => showPlanNotice(error.message));
  }
  if (event.target.id === 'plan-generation-form') {
    event.preventDefault();
    submitGeneration(event.target).catch((error) => showPlanNotice(error.message));
  }
  if (event.target.id === 'plan-template-review-form') {
    event.preventDefault();
    saveTemplateReview(event.target).catch((error) => showPlanNotice(error.message));
  }
}, true);

const plansObserver = new MutationObserver(() => {
  ensurePlansUi();
  patchPlanCalendarInspector();
});
plansObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

ensurePlansUi();
bindFilterState();
$p('#plans-upload-input')?.addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  uploadPlan(file).catch((error) => showPlanNotice(error.message));
  event.target.value = '';
});
window.kafedraOpenPlan = (planId) => activatePlansView(planId);
