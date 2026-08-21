const organizationState = {
  open: false,
  at: new Date().toISOString().slice(0, 10),
  snapshot: null,
  positions: [],
  people: [],
  appointments: [],
  loading: false
};

const orgSafe = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

async function orgApi(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Ошибка HTTP ${response.status}`);
  return payload;
}

function ensureOrganizationStyles() {
  if (document.querySelector('#organization-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'organization-next-styles';
  link.rel = 'stylesheet';
  link.href = '/organization-next.css';
  document.head.append(link);
}

function ensureOrganizationUi() {
  ensureOrganizationStyles();
  if (!document.querySelector('#organization-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="organization-backdrop" class="organization-backdrop hidden"></div>
      <section id="organization-panel" class="organization-panel hidden"
        role="dialog" aria-modal="true" aria-labelledby="organization-title">
        <header class="organization-header">
          <div>
            <div class="eyebrow">Администрирование</div>
            <h2 id="organization-title">Структура кафедры</h2>
            <p>Подразделения, должности и назначения с историей по датам.</p>
          </div>
          <button type="button" class="secondary-button" data-organization-close>Закрыть</button>
        </header>
        <div class="organization-body">
          <div class="organization-toolbar">
            <label class="field organization-at-field">
              <span>Состояние на дату</span>
              <input id="organization-at" type="date">
            </label>
            <div class="organization-actions">
              <button type="button" class="primary-button" data-org-add-unit>Подразделение</button>
              <button type="button" class="secondary-button" data-org-add-position>Должность</button>
              <button type="button" class="secondary-button" data-org-add-appointment>Назначение</button>
            </div>
          </div>
          <p id="organization-status" class="organization-status" role="status"></p>
          <section id="organization-editor" class="organization-editor hidden"></section>
          <div class="organization-grid">
            <section class="organization-card">
              <header><h3>Подразделения</h3><span id="organization-unit-count"></span></header>
              <div id="organization-tree"></div>
            </section>
            <section class="organization-card">
              <header><h3>Сотрудники</h3><span id="organization-person-count"></span></header>
              <div id="organization-people"></div>
            </section>
          </div>
          <section class="organization-card organization-positions-card">
            <header><h3>Должности</h3><span id="organization-position-count"></span></header>
            <div id="organization-positions"></div>
          </section>
        </div>
      </section>
    `);
    document.querySelector('#organization-at').value = organizationState.at;
  }
}

function setOrganizationStatus(message, error = false) {
  const node = document.querySelector('#organization-status');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error', Boolean(error));
}

function ensureOrganizationControl(payload) {
  if (payload?.role !== 'admin') return;
  const menu = document.querySelector('.auth-user-menu');
  if (menu && !menu.querySelector('[data-auth-action="organization"]')) {
    menu.insertAdjacentHTML('afterbegin', '<button type="button" data-auth-action="organization">Структура кафедры</button>');
    return;
  }
  const topbar = document.querySelector('.topbar-actions');
  if (topbar && !topbar.querySelector('[data-organization-open]')) {
    topbar.insertAdjacentHTML('afterbegin', '<button type="button" class="secondary-button organization-open-button" data-organization-open>Структура</button>');
  }
}

function flattenUnits(nodes, depth = 0, output = []) {
  for (const node of nodes || []) {
    output.push({ ...node, depth });
    flattenUnits(node.children || [], depth + 1, output);
  }
  return output;
}

function unitOptions(selected = '', exclude = '') {
  const rows = flattenUnits(organizationState.snapshot?.units || []);
  return [
    '<option value="">Без родительского подразделения</option>',
    ...rows.filter((item) => item.id !== exclude).map((item) =>
      `<option value="${orgSafe(item.id)}" ${item.id === selected ? 'selected' : ''}>${'— '.repeat(item.depth)}${orgSafe(item.name)}</option>`
    )
  ].join('');
}

function positionOptions(selected = '') {
  return [
    '<option value="">Указать текстом</option>',
    ...organizationState.positions.filter((item) => item.status === 'active').map((item) =>
      `<option value="${orgSafe(item.id)}" ${item.id === selected ? 'selected' : ''}>${orgSafe(item.name)}</option>`
    )
  ].join('');
}

function personOptions(selected = '') {
  return organizationState.people
    .filter((person) => person.status !== 'inactive')
    .map((person) => `<option value="${orgSafe(person.id)}" ${person.id === selected ? 'selected' : ''}>${orgSafe(person.display_name)}</option>`)
    .join('');
}

function unitKindTitle(kind) {
  return {
    organization: 'Организация', faculty: 'Факультет', department: 'Кафедра / подразделение',
    laboratory: 'Лаборатория', section: 'Секция', other: 'Другое'
  }[kind] || kind;
}

function appointmentKindTitle(kind) {
  return { primary: 'Основное', additional: 'Дополнительное', temporary: 'Временное' }[kind] || kind;
}

function renderUnitTree(nodes, depth = 0) {
  if (!(nodes || []).length && depth === 0) return '<div class="organization-empty">Подразделения ещё не созданы.</div>';
  return `<ul class="organization-tree-level">${(nodes || []).map((item) => `
    <li>
      <article class="organization-unit" data-org-unit-id="${orgSafe(item.id)}">
        <div class="organization-unit-main">
          <span class="organization-indent" style="--org-depth:${depth}"></span>
          <div>
            <strong>${orgSafe(item.name)}</strong>
            <small>${orgSafe(unitKindTitle(item.unit_kind))}${item.manager ? ` · руководитель: ${orgSafe(item.manager.person_name)}` : ''}</small>
          </div>
        </div>
        <div class="organization-row-actions">
          <button type="button" class="quiet-button" data-org-manager="${orgSafe(item.id)}">Руководитель</button>
          <button type="button" class="quiet-button" data-org-edit-unit="${orgSafe(item.id)}">Изменить</button>
        </div>
      </article>
      ${renderUnitTree(item.children || [], depth + 1)}
    </li>`).join('')}</ul>`;
}

function currentAppointment(personId) {
  return organizationState.appointments.find((item) => item.person_id === personId && item.appointment_kind === 'primary') || null;
}

function renderPeople() {
  if (!organizationState.people.length) return '<div class="organization-empty">Сотрудники ещё не добавлены.</div>';
  return `<div class="organization-people-list">${organizationState.people.map((person) => {
    const active = currentAppointment(person.id);
    return `<article class="organization-person" data-org-person-id="${orgSafe(person.id)}">
      <div><strong>${orgSafe(person.display_name)}</strong><span>${active ? `${orgSafe(active.position_name || active.position_title_snapshot)} · ${orgSafe(active.unit_name)}` : 'Нет назначения на выбранную дату'}</span></div>
      <div class="organization-row-actions">
        <button type="button" class="quiet-button" data-org-history="${orgSafe(person.id)}">История</button>
        <button type="button" class="secondary-button" data-org-appoint="${orgSafe(person.id)}">Назначить</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderPositions() {
  if (!organizationState.positions.length) return '<div class="organization-empty">Должности ещё не добавлены.</div>';
  return `<div class="organization-position-list">${organizationState.positions.map((item) => `
    <article class="organization-position" data-status="${orgSafe(item.status)}">
      <div><strong>${orgSafe(item.name)}</strong><span>${orgSafe(item.code)} · назначений: ${Number(item.appointment_count || 0)}</span></div>
      <button type="button" class="quiet-button" data-org-edit-position="${orgSafe(item.id)}">Изменить</button>
    </article>`).join('')}</div>`;
}

function renderOrganization() {
  const units = flattenUnits(organizationState.snapshot?.units || []);
  document.querySelector('#organization-tree').innerHTML = renderUnitTree(organizationState.snapshot?.units || []);
  document.querySelector('#organization-people').innerHTML = renderPeople();
  document.querySelector('#organization-positions').innerHTML = renderPositions();
  document.querySelector('#organization-unit-count').textContent = `${units.length}`;
  document.querySelector('#organization-person-count').textContent = `${organizationState.people.length}`;
  document.querySelector('#organization-position-count').textContent = `${organizationState.positions.length}`;
}

async function loadOrganization() {
  if (organizationState.loading) return;
  organizationState.loading = true;
  setOrganizationStatus('Обновление структуры…');
  try {
    const at = document.querySelector('#organization-at')?.value || organizationState.at;
    organizationState.at = at;
    const [snapshot, positions, people, appointments] = await Promise.all([
      orgApi(`/api/organization/snapshot?at=${encodeURIComponent(at)}`),
      orgApi('/api/organization/positions?includeArchived=1'),
      orgApi('/api/people'),
      orgApi(`/api/organization/appointments?at=${encodeURIComponent(at)}`)
    ]);
    organizationState.snapshot = snapshot;
    organizationState.positions = positions.items || [];
    organizationState.people = people.items || [];
    organizationState.appointments = appointments.items || [];
    renderOrganization();
    setOrganizationStatus('');
  } catch (error) {
    setOrganizationStatus(error.message, true);
  } finally {
    organizationState.loading = false;
  }
}

function openOrganization() {
  ensureOrganizationUi();
  organizationState.open = true;
  document.querySelector('#organization-panel').classList.remove('hidden');
  document.querySelector('#organization-backdrop').classList.remove('hidden');
  document.body.classList.add('organization-open');
  loadOrganization();
}

function closeOrganization() {
  organizationState.open = false;
  document.querySelector('#organization-panel')?.classList.add('hidden');
  document.querySelector('#organization-backdrop')?.classList.add('hidden');
  document.body.classList.remove('organization-open');
}

function showEditor(title, body) {
  const editor = document.querySelector('#organization-editor');
  editor.innerHTML = `<header><h3>${orgSafe(title)}</h3><button type="button" class="quiet-button" data-org-editor-close>Скрыть</button></header>${body}`;
  editor.classList.remove('hidden');
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideEditor() {
  const editor = document.querySelector('#organization-editor');
  editor?.classList.add('hidden');
  if (editor) editor.innerHTML = '';
}

function formError(form, message = '') {
  let node = form.querySelector('[data-org-form-error]');
  if (!node) {
    node = document.createElement('p');
    node.dataset.orgFormError = '1';
    node.className = 'organization-form-error';
    node.setAttribute('role', 'alert');
    form.querySelector('.organization-form-actions')?.insertAdjacentElement('beforebegin', node);
  }
  node.textContent = message;
}

function unitForm(item = null) {
  showEditor(item ? 'Изменить подразделение' : 'Новое подразделение', `
    <form class="organization-form" data-org-unit-form data-unit-id="${orgSafe(item?.id || '')}">
      <div class="organization-form-grid">
        <label class="field"><span>Название</span><input name="name" value="${orgSafe(item?.name || '')}" required></label>
        <label class="field"><span>Код</span><input name="code" value="${orgSafe(item?.code || '')}" placeholder="например: kafedra-meteo" required></label>
        <label class="field"><span>Вид</span><select name="unitKind">${['organization','faculty','department','laboratory','section','other'].map((kind) => `<option value="${kind}" ${item?.unit_kind === kind ? 'selected' : ''}>${orgSafe(unitKindTitle(kind))}</option>`).join('')}</select></label>
        <label class="field"><span>В составе</span><select name="parentId">${unitOptions(item?.parent_id || '', item?.id || '')}</select></label>
      </div>
      ${item ? `<label class="field"><span>Состояние</span><select name="status"><option value="active" ${item.status === 'active' ? 'selected' : ''}>Действует</option><option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Архив</option></select></label>` : ''}
      <div class="organization-form-actions"><button type="button" class="secondary-button" data-org-editor-close>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>`);
}

function positionForm(item = null) {
  showEditor(item ? 'Изменить должность' : 'Новая должность', `
    <form class="organization-form" data-org-position-form data-position-id="${orgSafe(item?.id || '')}">
      <div class="organization-form-grid">
        <label class="field"><span>Название</span><input name="name" value="${orgSafe(item?.name || '')}" required></label>
        <label class="field"><span>Код</span><input name="code" value="${orgSafe(item?.code || '')}" required></label>
        <label class="field"><span>Категория</span><select name="category">${[['teaching','Преподавательская'],['research','Научная'],['leadership','Руководящая'],['engineering','Инженерная'],['administrative','Административная'],['support','Обеспечение'],['other','Другое']].map(([value,label]) => `<option value="${value}" ${item?.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        ${item ? `<label class="field"><span>Состояние</span><select name="status"><option value="active" ${item.status === 'active' ? 'selected' : ''}>Используется</option><option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Архив</option></select></label>` : ''}
      </div>
      <div class="organization-form-actions"><button type="button" class="secondary-button" data-org-editor-close>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>`);
}

function appointmentForm(personId = '', item = null) {
  const today = organizationState.at || new Date().toISOString().slice(0,10);
  const selectedPerson = item?.person_id || personId || organizationState.people[0]?.id || '';
  showEditor(item ? 'Изменить назначение' : 'Новое назначение', `
    <form class="organization-form" data-org-appointment-form data-appointment-id="${orgSafe(item?.id || '')}">
      <div class="organization-form-grid">
        <label class="field"><span>Сотрудник</span><select name="personId" ${item ? 'disabled' : ''}>${personOptions(selectedPerson)}</select></label>
        <label class="field"><span>Подразделение</span><select name="organizationUnitId" required>${flattenUnits(organizationState.snapshot?.units || []).map((unit) => `<option value="${orgSafe(unit.id)}" ${unit.id === item?.organization_unit_id ? 'selected' : ''}>${'— '.repeat(unit.depth)}${orgSafe(unit.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Должность</span><select name="positionId">${positionOptions(item?.position_id || '')}</select></label>
        <label class="field"><span>Если должности нет в справочнике</span><input name="positionTitleSnapshot" value="${orgSafe(item?.position_title_snapshot || '')}"></label>
        <label class="field"><span>Назначение</span><select name="appointmentKind">${['primary','additional','temporary'].map((kind) => `<option value="${kind}" ${item?.appointment_kind === kind ? 'selected' : ''}>${appointmentKindTitle(kind)}</option>`).join('')}</select></label>
        <label class="field"><span>Ставка</span><input name="workloadFraction" type="number" min="0.1" max="1.5" step="0.1" value="${orgSafe(item?.workload_fraction ?? 1)}"></label>
        <label class="field"><span>С</span><input name="validFrom" type="date" value="${orgSafe(item?.valid_from || today)}" required></label>
        <label class="field"><span>По</span><input name="validTo" type="date" value="${orgSafe(item?.valid_to || '')}"></label>
      </div>
      <div class="organization-form-actions"><button type="button" class="secondary-button" data-org-editor-close>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>`);
}

function managerForm(unitId) {
  const unit = flattenUnits(organizationState.snapshot?.units || []).find((item) => item.id === unitId);
  const today = organizationState.at || new Date().toISOString().slice(0,10);
  showEditor(`Руководитель: ${unit?.name || 'подразделение'}`, `
    ${unit?.manager ? `<article class="organization-current-manager"><div><strong>${orgSafe(unit.manager.person_name)}</strong><span>${orgSafe(unit.manager.valid_from)} — ${orgSafe(unit.manager.valid_to || 'по настоящее время')}</span></div><button type="button" class="secondary-button" data-org-end-manager="${orgSafe(unit.manager.id)}">Завершить полномочия</button></article>` : ''}
    <form class="organization-form" data-org-manager-form data-unit-id="${orgSafe(unitId)}">
      <div class="organization-form-grid">
        <label class="field"><span>Сотрудник</span><select name="personId">${personOptions()}</select></label>
        <label class="field"><span>С</span><input name="validFrom" type="date" value="${today}" required></label>
        <label class="field"><span>По</span><input name="validTo" type="date"></label>
      </div>
      <div class="organization-form-actions"><button type="button" class="secondary-button" data-org-editor-close>Отмена</button><button type="submit" class="primary-button">Назначить руководителем</button></div>
    </form>`);
}

async function historyView(personId) {
  try {
    const result = await orgApi(`/api/organization/appointments?personId=${encodeURIComponent(personId)}&includeEnded=1`);
    const person = organizationState.people.find((item) => item.id === personId);
    showEditor(`История: ${person?.display_name || 'сотрудник'}`, `
      <div class="organization-history">${(result.items || []).length ? result.items.map((item) => `
        <article><div><strong>${orgSafe(item.position_name || item.position_title_snapshot)} · ${orgSafe(item.unit_name)}</strong><span>${orgSafe(appointmentKindTitle(item.appointment_kind))} · ${orgSafe(item.valid_from)} — ${orgSafe(item.valid_to || 'по настоящее время')}</span></div><div class="organization-row-actions"><button type="button" class="quiet-button" data-org-edit-appointment="${orgSafe(item.id)}">Исправить</button>${item.status === 'active' ? `<button type="button" class="secondary-button" data-org-end-appointment="${orgSafe(item.id)}">Завершить</button>` : ''}</div></article>`).join('') : '<div class="organization-empty">История назначений пуста.</div>'}</div>
      <div class="organization-form-actions"><button type="button" class="primary-button" data-org-appoint="${orgSafe(personId)}">Добавить назначение</button></div>`);
  } catch (error) {
    setOrganizationStatus(error.message, true);
  }
}

async function submitJson(form, path, method, payload) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  formError(form, '');
  try {
    await orgApi(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    hideEditor();
    await loadOrganization();
    setOrganizationStatus('Изменения сохранены.');
  } catch (error) {
    formError(form, error.message);
    if (button) button.disabled = false;
  }
}

document.addEventListener('submit', (event) => {
  const unit = event.target.closest('[data-org-unit-form]');
  if (unit) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(unit));
    const id = unit.dataset.unitId;
    submitJson(unit, id ? `/api/organization/units/${encodeURIComponent(id)}` : '/api/organization/units', id ? 'PATCH' : 'POST', {
      name: values.name, code: values.code, unitKind: values.unitKind,
      parentId: values.parentId || null, ...(id ? { status: values.status } : {})
    });
    return;
  }
  const position = event.target.closest('[data-org-position-form]');
  if (position) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(position));
    const id = position.dataset.positionId;
    submitJson(position, id ? `/api/organization/positions/${encodeURIComponent(id)}` : '/api/organization/positions', id ? 'PATCH' : 'POST', values);
    return;
  }
  const appointment = event.target.closest('[data-org-appointment-form]');
  if (appointment) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(appointment));
    const id = appointment.dataset.appointmentId;
    submitJson(appointment, id ? `/api/organization/appointments/${encodeURIComponent(id)}` : '/api/organization/appointments', id ? 'PATCH' : 'POST', {
      personId: values.personId || appointment.querySelector('[name="personId"]')?.value,
      organizationUnitId: values.organizationUnitId,
      positionId: values.positionId || null,
      positionTitleSnapshot: values.positionTitleSnapshot || null,
      appointmentKind: values.appointmentKind,
      workloadFraction: Number(values.workloadFraction),
      validFrom: values.validFrom,
      validTo: values.validTo || null
    });
    return;
  }
  const manager = event.target.closest('[data-org-manager-form]');
  if (manager) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(manager));
    submitJson(manager, '/api/organization/managers', 'POST', {
      organizationUnitId: manager.dataset.unitId,
      personId: values.personId,
      validFrom: values.validFrom,
      validTo: values.validTo || null
    });
  }
});

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action === 'organization' || event.target.closest('[data-organization-open]')) openOrganization();
  if (event.target.closest('[data-organization-close]') || event.target.id === 'organization-backdrop') closeOrganization();
  if (event.target.closest('[data-org-editor-close]')) hideEditor();
  if (event.target.closest('[data-org-add-unit]')) unitForm();
  if (event.target.closest('[data-org-add-position]')) positionForm();
  if (event.target.closest('[data-org-add-appointment]')) appointmentForm();

  const editUnit = event.target.closest('[data-org-edit-unit]');
  if (editUnit) {
    const item = flattenUnits(organizationState.snapshot?.units || []).find((unit) => unit.id === editUnit.dataset.orgEditUnit);
    if (item) unitForm(item);
  }
  const editPosition = event.target.closest('[data-org-edit-position]');
  if (editPosition) {
    const item = organizationState.positions.find((position) => position.id === editPosition.dataset.orgEditPosition);
    if (item) positionForm(item);
  }
  const appoint = event.target.closest('[data-org-appoint]');
  if (appoint) appointmentForm(appoint.dataset.orgAppoint);
  const history = event.target.closest('[data-org-history]');
  if (history) historyView(history.dataset.orgHistory);
  const manager = event.target.closest('[data-org-manager]');
  if (manager) managerForm(manager.dataset.orgManager);

  const editAppointment = event.target.closest('[data-org-edit-appointment]');
  if (editAppointment) {
    try {
      const result = await orgApi('/api/organization/appointments?includeEnded=1');
      const item = (result.items || []).find((row) => row.id === editAppointment.dataset.orgEditAppointment);
      if (item) appointmentForm(item.person_id, item);
    } catch (error) { setOrganizationStatus(error.message, true); }
  }
  const endAppointment = event.target.closest('[data-org-end-appointment]');
  if (endAppointment) {
    try {
      await orgApi(`/api/organization/appointments/${encodeURIComponent(endAppointment.dataset.orgEndAppointment)}/end`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ validTo: organizationState.at, reason: 'Завершено оператором' })
      });
      hideEditor(); await loadOrganization();
    } catch (error) { setOrganizationStatus(error.message, true); }
  }
  const endManager = event.target.closest('[data-org-end-manager]');
  if (endManager) {
    try {
      await orgApi(`/api/organization/managers/${encodeURIComponent(endManager.dataset.orgEndManager)}/end`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ validTo: organizationState.at, reason: 'Завершено оператором' })
      });
      hideEditor(); await loadOrganization();
    } catch (error) { setOrganizationStatus(error.message, true); }
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'organization-at') loadOrganization();
});

window.addEventListener('kafedra-auth-changed', (event) => ensureOrganizationControl(event.detail));
window.kafedraAuthReady?.then(ensureOrganizationControl).catch(() => {});
ensureOrganizationUi();
window.kafedraOpenOrganization = openOrganization;
