const manualState = {
  selectedPlanId: null,
  selectedPlan: null,
  people: [],
  templates: [],
  calendarPlans: [],
  patchToken: 0
};

const $m = (selector, root = document) => root.querySelector(selector);
const $$m = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeManual(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function manualApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureManualStyles() {
  if ($m('#manual-plans-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'manual-plans-next-styles';
  link.rel = 'stylesheet';
  link.href = '/manual-plans-next.css';
  document.head.append(link);
}

function ensureManualUi() {
  ensureManualStyles();
  const actions = $m('.topbar-actions');
  if (actions && !$m('[data-manual-calendar-add]', actions)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button manual-calendar-add';
    button.dataset.manualCalendarAdd = '1';
    button.textContent = 'В план';
    button.title = 'Добавить пункт годового плана';
    actions.insertBefore(button, $m('#create-button', actions));
  }
  if (!$m('#manual-plan-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="manual-plan-backdrop" class="manual-plan-backdrop hidden"></div>
      <section id="manual-plan-modal" class="manual-plan-modal hidden" role="dialog" aria-modal="true" aria-labelledby="manual-plan-modal-title"></section>
    `);
  }
  patchCalendarButtonVisibility();
}

function patchCalendarButtonVisibility() {
  const button = $m('[data-manual-calendar-add]');
  if (!button) return;
  const calendar = $m('[data-view-panel="calendar"]');
  button.classList.toggle('hidden', !calendar?.classList.contains('active'));
}

function showManualModal(html) {
  ensureManualUi();
  $m('#manual-plan-modal').innerHTML = html;
  $m('#manual-plan-backdrop').classList.remove('hidden');
  $m('#manual-plan-modal').classList.remove('hidden');
  document.body.classList.add('manual-plan-modal-open');
}

function closeManualModal() {
  $m('#manual-plan-backdrop')?.classList.add('hidden');
  $m('#manual-plan-modal')?.classList.add('hidden');
  document.body.classList.remove('manual-plan-modal-open');
}

function notice(message) {
  const existing = $m('#plans-notice');
  if (existing) {
    const span = $m('span', existing);
    if (span) span.textContent = message;
    $m('button', existing)?.classList.add('hidden');
    existing.classList.remove('hidden');
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => existing.classList.add('hidden'), 5000);
    return;
  }
  console.info(message);
}

function currentPlanId() {
  return $m('.plan-card.active[data-plan-id]')?.dataset.planId || null;
}

async function refreshPlan(planId = manualState.selectedPlanId) {
  if (!planId) return;
  if (typeof window.kafedraOpenPlan === 'function') {
    window.kafedraOpenPlan(planId);
    return;
  }
  location.reload();
}

async function loadPeople() {
  if (manualState.people.length) return manualState.people;
  const data = await manualApi('/api/people');
  manualState.people = (data.items || []).filter((item) => item.status !== 'inactive');
  return manualState.people;
}

function peopleOptions(selected = '', empty = 'Не выбран') {
  return `<option value="">${escapeManual(empty)}</option>` + manualState.people.map((person) => `
    <option value="${escapeManual(person.id)}" ${person.id === selected ? 'selected' : ''}>${escapeManual(person.display_name)}</option>
  `).join('');
}

function executorChecks(selectedIds = []) {
  const selected = new Set(selectedIds || []);
  return manualState.people.map((person) => `
    <label class="manual-person-choice">
      <input type="checkbox" name="executorPersonIds" value="${escapeManual(person.id)}" ${selected.has(person.id) ? 'checked' : ''}>
      <span>${escapeManual(person.display_name)}</span>
    </label>
  `).join('') || '<div class="empty-state">Сначала добавьте сотрудников в справочник.</div>';
}

function periodFields(kind = 'calendar', start = new Date().getFullYear(), end = null) {
  const finish = end || Number(start) + 1;
  return `
    <div class="manual-period-fields" data-manual-period-fields>
      <label class="field"><span>Начальный год</span><input name="yearStart" type="number" min="2000" max="2099" value="${Number(start)}" required></label>
      <label class="field manual-academic-end ${kind === 'academic' ? '' : 'hidden'}"><span>Конечный год</span><input name="yearEnd" type="number" min="2000" max="2099" value="${Number(finish)}"></label>
    </div>`;
}

async function openCreatePlan() {
  await loadPeople();
  const year = new Date().getFullYear();
  showManualModal(`
    <header class="manual-modal-head"><div><span>Новый план</span><h3 id="manual-plan-modal-title">Создать план без файла</h3></div><button class="icon-button" type="button" data-manual-close>×</button></header>
    <form id="manual-plan-create-form" class="manual-modal-body">
      <label class="field"><span>Название</span><input name="title" placeholder="Например, План работы кафедры" required></label>
      <div class="manual-grid-two">
        <label class="field"><span>Вид плана</span><select name="planKind">
          <option value="department">Кафедра</option><option value="faculty">Факультет</option>
          <option value="unit">Подразделение</option><option value="personal">Личный</option>
          <option value="organization">Организация</option>
        </select></label>
        <label class="field"><span>Период</span><select name="periodKind"><option value="calendar">Календарный год</option><option value="academic">Учебный год</option></select></label>
      </div>
      ${periodFields('calendar', year, year + 1)}
      <label class="field"><span>Владелец</span><select name="ownerPersonId">${peopleOptions('', 'Определить автоматически')}</select></label>
      <p class="manual-helper">Для общего плана сотрудники рабочей области видят план. Личный план остаётся закрытым для посторонних. Это можно уточнить через права доступа, не меняя сам план.</p>
      <div class="manual-modal-actions"><button class="secondary-button" type="button" data-manual-close>Отмена</button><button class="primary-button" type="submit">Создать план</button></div>
    </form>
  `);
}

function executionLabel(mode) {
  return { track: 'Контрольная точка', assigned: 'Поручение', open: 'Открытая задача' }[mode] || 'Контрольная точка';
}

function executionHelp(mode) {
  return {
    track: 'Только событие или контрольный срок. Отчёт не обязателен.',
    assigned: 'Создаётся поручение выбранным исполнителям и попадает в «План / факт».',
    open: 'Создаётся задача без исполнителя. Сотрудник сможет взять её на себя.'
  }[mode] || '';
}

function itemFormHtml({ planId, item = null, date = '', fromCalendar = false }) {
  const executors = item?.assignment?.executors?.filter((row) => ['executor', 'coexecutor'].includes(row.role)).map((row) => row.person_id).filter(Boolean) || [];
  const controller = item?.assignment?.executors?.find((row) => row.role === 'controller')?.person_id || '';
  const mode = item?.execution_mode || 'track';
  return `
    <header class="manual-modal-head"><div><span>${fromCalendar ? 'Календарь → план' : 'Пункт плана'}</span><h3 id="manual-plan-modal-title">${item ? 'Изменить мероприятие' : 'Добавить мероприятие'}</h3></div><button class="icon-button" type="button" data-manual-close>×</button></header>
    <form id="manual-plan-item-form" class="manual-modal-body" data-plan-id="${escapeManual(planId)}" data-item-id="${escapeManual(item?.id || '')}">
      <label class="field"><span>Мероприятие</span><input name="title" value="${escapeManual(item?.title || '')}" required placeholder="Что нужно сделать"></label>
      <div class="manual-grid-three">
        <label class="field"><span>Начало</span><input name="startsAt" type="date" value="${escapeManual(item?.starts_at || date || '')}"></label>
        <label class="field"><span>Окончание</span><input name="endsAt" type="date" value="${escapeManual(item?.ends_at || '')}"></label>
        <label class="field"><span>Контрольный срок</span><input name="dueDate" type="date" value="${escapeManual(item?.due_date || '')}"></label>
      </div>
      <div class="manual-grid-two">
        <label class="field"><span>Направление</span><select name="direction">
          ${[['organizational','Организация'],['education','Образование'],['science','Наука'],['everyday','Повседневная']].map(([value,label]) => `<option value="${value}" ${item?.direction === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="field"><span>Режим исполнения</span><select name="executionMode" data-manual-execution-mode>
          <option value="track" ${mode === 'track' ? 'selected' : ''}>Контрольная точка</option>
          <option value="assigned" ${mode === 'assigned' ? 'selected' : ''}>Поручение</option>
          <option value="open" ${mode === 'open' ? 'selected' : ''}>Открытая задача</option>
        </select></label>
      </div>
      <p class="manual-helper" data-manual-execution-help>${escapeManual(executionHelp(mode))}</p>
      <label class="field"><span>Ожидаемый результат</span><input name="expectedResult" value="${escapeManual(item?.expected_result || '')}" placeholder="Например, протокол или отчёт"></label>
      <label class="field"><span>Комментарий</span><textarea name="description" rows="3" placeholder="Коротко: что и где подготовить">${escapeManual(item?.description || '')}</textarea></label>
      <section class="manual-execution-people ${mode === 'track' ? 'hidden' : ''}" data-manual-execution-people>
        <div class="manual-subhead"><strong>Исполнители</strong><span>Для открытой задачи их можно не выбирать</span></div>
        <div class="manual-people-list">${executorChecks(executors)}</div>
        <label class="field"><span>Контролирует</span><select name="controllerPersonId">${peopleOptions(controller, 'Определить по создателю')}</select></label>
      </section>
      <div class="manual-modal-actions"><button class="secondary-button" type="button" data-manual-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`;
}

async function openItemForm(planId, item = null, date = '', fromCalendar = false) {
  await loadPeople();
  showManualModal(itemFormHtml({ planId, item, date, fromCalendar }));
}

async function openCalendarItemForm() {
  const data = await manualApi('/api/plans?limit=500');
  manualState.calendarPlans = (data.items || []).filter((plan) => plan.origin_kind === 'manual' && plan.status === 'active');
  if (!manualState.calendarPlans.length) {
    await openCreatePlan();
    notice('Сначала создайте план. После сохранения в него можно добавить пункт из календаря.');
    return;
  }
  await loadPeople();
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  showManualModal(`
    <header class="manual-modal-head"><div><span>Календарь → план</span><h3 id="manual-plan-modal-title">Добавить пункт плана</h3></div><button class="icon-button" type="button" data-manual-close>×</button></header>
    <div class="manual-modal-body">
      <label class="field"><span>План</span><select id="manual-calendar-plan-select">
        ${manualState.calendarPlans.map((plan) => `<option value="${escapeManual(plan.id)}">${escapeManual(plan.title)} · ${escapeManual(plan.period_key || '')}</option>`).join('')}
      </select></label>
      <button class="primary-button" type="button" data-manual-calendar-plan-next data-date="${date}">Продолжить</button>
    </div>`);
}

async function openSupportingDocuments(item) {
  const data = await manualApi(`/api/supporting-documents?targetKind=plan_item&targetId=${encodeURIComponent(item.id)}`);
  const documents = data.items || [];
  showManualModal(`
    <header class="manual-modal-head"><div><span>Подтверждение выполнения</span><h3 id="manual-plan-modal-title">Сопроводительные документы</h3></div><button class="icon-button" type="button" data-manual-close>×</button></header>
    <div class="manual-modal-body">
      <div class="manual-support-list">
        ${documents.length ? documents.map((doc) => `
          <article class="manual-support-card">
            <div><strong>№ ${escapeManual(doc.document_number)} от ${escapeManual(doc.document_date)}</strong><span>${escapeManual(doc.title || doc.note || 'Без названия')}</span></div>
            ${doc.document_id ? `<a class="secondary-button" target="_blank" rel="noopener" href="/api/documents/${encodeURIComponent(doc.document_id)}/content?variant=original">Открыть файл</a>` : '<span class="manual-badge">Без файла</span>'}
          </article>`).join('') : '<div class="empty-state">Пока нет подтверждающих документов.</div>'}
      </div>
      <form id="manual-support-form" data-item-id="${escapeManual(item.id)}">
        <div class="manual-grid-two">
          <label class="field"><span>Номер</span><input name="documentNumber" required placeholder="Например, 12-03/26"></label>
          <label class="field"><span>Дата</span><input name="documentDate" type="date" required></label>
        </div>
        <label class="field"><span>Название</span><input name="title" placeholder="Например, письмо о публикации"></label>
        <label class="field"><span>Примечание</span><textarea name="note" rows="2"></textarea></label>
        <label class="field"><span>Файл, если есть</span><input name="file" type="file" accept=".pdf,.docx,.odt,.xlsx,.ods,.png,.jpg,.jpeg,.tif,.tiff"></label>
        <p class="manual-helper">Номер и дата можно зарегистрировать без файла. Если файл приложен, исходник сохраняется как обычный неизменяемый документ.</p>
        <div class="manual-modal-actions"><button class="secondary-button" type="button" data-manual-close>Закрыть</button><button class="primary-button" type="submit">Добавить документ</button></div>
      </form>
    </div>`);
  const dateInput = $m('#manual-support-form [name="documentDate"]');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
}

async function uploadSupportingFile(file) {
  if (!file) return null;
  return await manualApi('/api/documents', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-document-type': 'auto',
      'idempotency-key': `support:${file.name}:${file.size}:${file.lastModified}`
    },
    body: file
  });
}

async function saveSupportingDocument(form) {
  const data = new FormData(form);
  const file = data.get('file');
  const uploaded = file instanceof File && file.size ? await uploadSupportingFile(file) : null;
  const body = {
    documentNumber: String(data.get('documentNumber') || '').trim(),
    documentDate: data.get('documentDate'),
    title: String(data.get('title') || '').trim() || null,
    note: String(data.get('note') || '').trim() || null,
    documentId: uploaded?.documentId || null,
    targetKind: 'plan_item',
    targetId: form.dataset.itemId,
    relationKind: 'completion'
  };
  await manualApi('/api/supporting-documents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  closeManualModal();
  await refreshPlan();
  notice(uploaded ? 'Документ сохранён и связан с пунктом плана.' : 'Реквизиты сохранены без файла.');
}

async function openGenerateManualPlan(plan) {
  const data = await manualApi('/api/plan-templates?limit=300');
  manualState.templates = data.items || [];
  if (!manualState.templates.length) throw new Error('Сначала сохраните хотя бы один DOCX-образец плана из загруженного документа.');
  showManualModal(`
    <header class="manual-modal-head"><div><span>Готовый документ</span><h3 id="manual-plan-modal-title">Сформировать DOCX</h3></div><button class="icon-button" type="button" data-manual-close>×</button></header>
    <form id="manual-plan-generate-form" class="manual-modal-body" data-plan-id="${escapeManual(plan.id)}">
      <p class="manual-helper">Пункты берутся из текущего плана. Исходный образец не изменяется; результат будет сохранён отдельным документом.</p>
      <label class="field"><span>Образец</span><select name="templateId" required>
        ${manualState.templates.map((template) => `<option value="${escapeManual(template.id)}">${escapeManual(template.name)} · ${escapeManual(template.period_kind === 'academic' ? 'учебный год' : 'календарный год')}</option>`).join('')}
      </select></label>
      <div class="manual-modal-actions"><button class="secondary-button" type="button" data-manual-close>Отмена</button><button class="primary-button" type="submit">Сформировать</button></div>
    </form>`);
}

async function generateManualPlan(form) {
  const data = new FormData(form);
  const result = await manualApi(`/api/plans/${encodeURIComponent(form.dataset.planId)}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId: data.get('templateId') })
  });
  closeManualModal();
  if (result.generated_document_id) {
    notice('DOCX сформирован и сохранён в документах.');
    window.open(`/api/documents/${encodeURIComponent(result.generated_document_id)}/content?variant=original`, '_blank', 'noopener');
  } else notice('Формирование документа запущено.');
}

async function savePlan(form) {
  const data = new FormData(form);
  const body = {
    title: String(data.get('title') || '').trim(),
    planKind: data.get('planKind'),
    periodKind: data.get('periodKind'),
    yearStart: Number(data.get('yearStart')),
    yearEnd: data.get('periodKind') === 'academic' ? Number(data.get('yearEnd')) : Number(data.get('yearStart')),
    ownerPersonId: data.get('ownerPersonId') || null
  };
  const plan = await manualApi('/api/plans', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  closeManualModal();
  notice('План создан. Теперь добавьте мероприятия.');
  await refreshPlan(plan.id);
}

async function saveItem(form) {
  const data = new FormData(form);
  const executorPersonIds = data.getAll('executorPersonIds').filter(Boolean);
  const body = {
    title: String(data.get('title') || '').trim(),
    startsAt: data.get('startsAt') || null,
    endsAt: data.get('endsAt') || null,
    dueDate: data.get('dueDate') || null,
    direction: data.get('direction'),
    executionMode: data.get('executionMode'),
    expectedResult: String(data.get('expectedResult') || '').trim() || null,
    description: String(data.get('description') || '').trim() || null,
    executorPersonIds,
    responsiblePersonId: executorPersonIds[0] || null,
    controllerPersonId: data.get('controllerPersonId') || null
  };
  const planId = form.dataset.planId;
  const itemId = form.dataset.itemId;
  await manualApi(itemId
    ? `/api/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`
    : `/api/plans/${encodeURIComponent(planId)}/items`, {
    method: itemId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  closeManualModal();
  await refreshPlan(planId);
  notice(itemId ? 'Пункт плана обновлён.' : 'Пункт добавлен в план и календарь.');
}

async function claimItem(planId, itemId) {
  await manualApi(`/api/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/claim`, { method: 'POST' });
  await refreshPlan(planId);
  notice('Задача закреплена за вами и доступна в «План / факт».');
}

function manualMeta(item) {
  const assignment = item.assignment;
  const parts = [`Режим: ${executionLabel(item.execution_mode)}`];
  if (assignment) {
    const executors = (assignment.executors || []).filter((row) => ['executor','coexecutor'].includes(row.role)).map((row) => row.display_name || row.executor_raw).filter(Boolean);
    parts.push(executors.length ? `Исполнители: ${executors.join(', ')}` : 'Исполнитель пока не выбран');
    parts.push(`Поручение: ${assignment.status === 'completed' ? 'выполнено' : assignment.status === 'submitted' ? 'на проверке' : 'в работе'}`);
  }
  return parts.join(' · ');
}

async function patchManualDetail() {
  const planId = currentPlanId();
  const detail = $m('#plan-detail');
  if (!planId || !detail) return;
  const token = ++manualState.patchToken;
  let plan;
  try { plan = await manualApi(`/api/plans/${encodeURIComponent(planId)}`); }
  catch { return; }
  if (token !== manualState.patchToken || currentPlanId() !== planId) return;
  manualState.selectedPlanId = planId;
  manualState.selectedPlan = plan;

  const heading = $m('.plans-heading-actions');
  if (heading && !$m('[data-manual-create-plan]', heading)) {
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'secondary-button';
    create.dataset.manualCreatePlan = '1';
    create.textContent = 'Создать план';
    heading.insertBefore(create, heading.firstChild);
  }

  const topGenerate = $m('#plans-generate-button, #manual-plans-generate-button');
  if (topGenerate) {
    if (plan.origin_kind === 'manual') {
      topGenerate.id = 'manual-plans-generate-button';
      topGenerate.dataset.manualPlanGenerate = '1';
      topGenerate.textContent = 'Сформировать DOCX';
    } else {
      topGenerate.id = 'plans-generate-button';
      delete topGenerate.dataset.manualPlanGenerate;
      topGenerate.textContent = 'Сформировать по образцу';
    }
  }
  if (plan.origin_kind !== 'manual') return;

  $m('.plan-detail-actions .plan-link-button', detail)?.remove();
  const actions = $m('.plan-detail-actions', detail);
  if (actions) {
    const oldGenerate = $m('[data-plan-generate-current]', actions);
    if (oldGenerate) {
      oldGenerate.removeAttribute('data-plan-generate-current');
      oldGenerate.dataset.manualPlanGenerate = '1';
      oldGenerate.textContent = 'Сформировать DOCX';
    }
    if (!$m('[data-manual-add-item]', actions)) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'primary-button';
      add.dataset.manualAddItem = plan.id;
      add.textContent = 'Добавить пункт';
      actions.insertBefore(add, actions.firstChild);
    }
  }

  for (const item of plan.items || []) {
    const row = $m(`[data-plan-item-row="${CSS.escape(item.id)}"]`, detail);
    if (!row) continue;
    const titleCell = row.children[1];
    if (titleCell && !$m('.manual-item-meta', titleCell)) {
      titleCell.insertAdjacentHTML('beforeend', `<small class="manual-item-meta">${escapeManual(manualMeta(item))}</small>`);
    }
    const actionCell = row.lastElementChild;
    const edit = $m('[data-plan-edit-item]', actionCell);
    if (edit) {
      edit.removeAttribute('data-plan-edit-item');
      edit.dataset.manualEditItem = item.id;
      edit.textContent = 'Изменить';
    }
    if (actionCell && !$m(
      '[data-manual-support], [data-supporting-open][data-target-kind="plan_item"]',
      actionCell
    )) {
      const count = (item.supporting_documents || []).length;
      actionCell.insertAdjacentHTML('beforeend', `<button class="row-button" type="button" data-manual-support="${escapeManual(item.id)}">Документы${count ? ` · ${count}` : ''}</button>`);
    }
    if (actionCell && item.execution_mode === 'open' && item.assignment && !item.assignment.claimed_by_person_id && !$m('[data-manual-claim]', actionCell)) {
      actionCell.insertAdjacentHTML('beforeend', `<button class="row-button manual-claim-button" type="button" data-manual-claim="${escapeManual(item.id)}">Взять задачу</button>`);
    }
  }
}

function schedulePatch() {
  clearTimeout(schedulePatch.timer);
  schedulePatch.timer = setTimeout(() => patchManualDetail().catch(() => {}), 60);
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-manual-close]') || event.target === $m('#manual-plan-backdrop')) return closeManualModal();
  if (event.target.closest('[data-manual-create-plan]')) return openCreatePlan().catch((error) => notice(error.message));
  if (event.target.closest('[data-manual-calendar-add]')) return openCalendarItemForm().catch((error) => notice(error.message));
  const next = event.target.closest('[data-manual-calendar-plan-next]');
  if (next) {
    const planId = $m('#manual-calendar-plan-select')?.value;
    return openItemForm(planId, null, next.dataset.date || '', true).catch((error) => notice(error.message));
  }
  const add = event.target.closest('[data-manual-add-item]');
  if (add) return openItemForm(add.dataset.manualAddItem).catch((error) => notice(error.message));
  const edit = event.target.closest('[data-manual-edit-item]');
  if (edit) {
    const item = manualState.selectedPlan?.items?.find((candidate) => candidate.id === edit.dataset.manualEditItem);
    return openItemForm(manualState.selectedPlanId, item).catch((error) => notice(error.message));
  }
  const support = event.target.closest('[data-manual-support]');
  if (support) {
    const item = manualState.selectedPlan?.items?.find((candidate) => candidate.id === support.dataset.manualSupport);
    if (item) return openSupportingDocuments(item).catch((error) => notice(error.message));
  }
  const claim = event.target.closest('[data-manual-claim]');
  if (claim) return claimItem(manualState.selectedPlanId, claim.dataset.manualClaim).catch((error) => notice(error.message));
  if (event.target.closest('[data-manual-plan-generate]')) {
    if (manualState.selectedPlan?.origin_kind === 'manual') return openGenerateManualPlan(manualState.selectedPlan).catch((error) => notice(error.message));
  }
  if (event.target.closest('[data-view]')) setTimeout(patchCalendarButtonVisibility, 0);
}, true);

document.addEventListener('change', (event) => {
  if (event.target.name === 'periodKind' && event.target.closest('#manual-plan-create-form')) {
    $m('.manual-academic-end', event.target.closest('form'))?.classList.toggle('hidden', event.target.value !== 'academic');
  }
  if (event.target.matches('[data-manual-execution-mode]')) {
    const form = event.target.closest('form');
    $m('[data-manual-execution-people]', form)?.classList.toggle('hidden', event.target.value === 'track');
    const help = $m('[data-manual-execution-help]', form);
    if (help) help.textContent = executionHelp(event.target.value);
  }
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id === 'manual-plan-create-form') {
    event.preventDefault();
    savePlan(event.target).catch((error) => notice(error.message));
  }
  if (event.target.id === 'manual-plan-item-form') {
    event.preventDefault();
    saveItem(event.target).catch((error) => notice(error.message));
  }
  if (event.target.id === 'manual-support-form') {
    event.preventDefault();
    saveSupportingDocument(event.target).catch((error) => notice(error.message));
  }
  if (event.target.id === 'manual-plan-generate-form') {
    event.preventDefault();
    generateManualPlan(event.target).catch((error) => notice(error.message));
  }
}, true);

ensureManualUi();
const detail = $m('#plan-detail');
if (detail) new MutationObserver(schedulePatch).observe(detail, { childList: true, subtree: true });
const views = $m('.workspace');
if (views) new MutationObserver(patchCalendarButtonVisibility).observe(views, { attributes: true, subtree: true, attributeFilter: ['class'] });
schedulePatch();
