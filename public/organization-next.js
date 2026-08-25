const organizationState = {
  snapshot: null,
  selectedPersonId: null,
  initialized: false,
  loading: false
};

const $o = (selector, root = document) => root.querySelector(selector);
const $$o = (selector, root = document) => [...root.querySelectorAll(selector)];

function escOrg(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function organizationApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureOrganizationStyles() {
  if ($o('#organization-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'organization-next-styles';
  link.rel = 'stylesheet';
  link.href = '/organization-next.css';
  document.head.append(link);
}

function adminHost() {
  return $o('[data-view-panel="admin"]') || $o('#admin-view') || $o('.admin-view');
}

function ensureOrganizationUi() {
  ensureOrganizationStyles();
  const host = adminHost();
  if (!host || $o('#organization-admin', host)) return Boolean(host);
  host.insertAdjacentHTML('beforeend', `
    <section id="organization-admin" class="organization-admin settings-section">
      <header class="organization-head">
        <div><span class="eyebrow">Кадровая история</span><h2>Структура кафедры</h2>
          <p>Подразделения, должности и назначения с периодами действия.</p></div>
        <div class="organization-head-actions">
          <label class="field organization-as-of"><span>На дату</span><input id="organization-as-of" type="date"></label>
          <button class="secondary-button" type="button" data-organization-refresh>Обновить</button>
        </div>
      </header>
      <div id="organization-notice" class="organization-notice hidden" role="status"></div>
      <div class="organization-toolbar">
        <button class="primary-button" type="button" data-organization-add-unit>Подразделение</button>
        <button class="secondary-button" type="button" data-organization-add-position>Должность</button>
        <button class="secondary-button" type="button" data-organization-add-appointment>Назначение</button>
      </div>
      <div class="organization-layout">
        <section class="organization-panel"><header><h3>Подразделения</h3><span id="organization-unit-count"></span></header><div id="organization-tree"></div></section>
        <section class="organization-panel"><header><h3>Сотрудники</h3><span id="organization-people-count"></span></header><div id="organization-people"></div></section>
      </div>
    </section>
    <div id="organization-backdrop" class="organization-backdrop hidden"></div>
    <section id="organization-modal" class="organization-modal hidden" role="dialog" aria-modal="true" aria-labelledby="organization-modal-title"></section>
  `);
  const input = $o('#organization-as-of');
  if (input) input.value = new Date().toISOString().slice(0, 10);
  organizationState.initialized = true;
  return true;
}

function setOrganizationNotice(message, kind = 'info') {
  const notice = $o('#organization-notice');
  if (!notice) return;
  notice.textContent = message || '';
  notice.dataset.kind = kind;
  notice.classList.toggle('hidden', !message);
}

function closeOrganizationModal() {
  $o('#organization-backdrop')?.classList.add('hidden');
  $o('#organization-modal')?.classList.add('hidden');
  document.body.classList.remove('organization-modal-open');
}

function showOrganizationModal(html) {
  ensureOrganizationUi();
  $o('#organization-modal').innerHTML = html;
  $o('#organization-backdrop').classList.remove('hidden');
  $o('#organization-modal').classList.remove('hidden');
  document.body.classList.add('organization-modal-open');
}

function modalError(form, message = '') {
  let target = $o('[data-organization-form-error]', form);
  if (!target) {
    target = document.createElement('div');
    target.dataset.organizationFormError = '1';
    target.className = 'organization-form-error hidden';
    target.setAttribute('role', 'alert');
    $o('.organization-modal-actions', form)?.insertAdjacentElement('beforebegin', target);
  }
  target.textContent = message;
  target.classList.toggle('hidden', !message);
}

function flattenUnits(nodes, level = 0, result = []) {
  for (const node of nodes || []) {
    result.push({ ...node, level });
    flattenUnits(node.children || [], level + 1, result);
  }
  return result;
}

function unitOptions(selected = '', allowEmpty = true) {
  const rows = flattenUnits(organizationState.snapshot?.tree || []);
  return `${allowEmpty ? '<option value="">Без родительского подразделения</option>' : ''}${rows.map((unit) => `
    <option value="${escOrg(unit.id)}" ${unit.id === selected ? 'selected' : ''}>${'— '.repeat(unit.level)}${escOrg(unit.name)}</option>
  `).join('')}`;
}

function positionOptions(selected = '') {
  return `<option value="">Должность не указана</option>${(organizationState.snapshot?.positions || []).map((item) => `
    <option value="${escOrg(item.id)}" ${item.id === selected ? 'selected' : ''}>${escOrg(item.name)}</option>
  `).join('')}`;
}

function personOptions(selected = '', excluded = '') {
  return `<option value="">Не выбран</option>${(organizationState.snapshot?.people || []).filter((person) => person.id !== excluded).map((person) => `
    <option value="${escOrg(person.id)}" ${person.id === selected ? 'selected' : ''}>${escOrg(person.display_name)}</option>
  `).join('')}`;
}

function unitKindLabel(value) {
  return {
    organization: 'Организация', faculty: 'Факультет', department: 'Кафедра/подразделение',
    laboratory: 'Лаборатория', section: 'Секция', other: 'Другое'
  }[value] || value;
}

function renderTree(nodes, level = 0) {
  if (!(nodes || []).length && level === 0) return '<div class="organization-empty">Подразделения не созданы.</div>';
  return `<ul class="organization-tree-level">${(nodes || []).map((unit) => `
    <li>
      <button class="organization-unit-card" type="button" data-organization-edit-unit="${escOrg(unit.id)}">
        <span class="organization-unit-indent" data-level="${level}"></span>
        <span><strong>${escOrg(unit.name)}</strong><small>${escOrg(unitKindLabel(unit.unit_kind))} · сотрудников: ${Number(unit.appointment_count || 0)}</small></span>
        <span class="organization-period">${escOrg(unit.valid_from)} — ${escOrg(unit.valid_to || 'по настоящее время')}</span>
      </button>
      ${renderTree(unit.children || [], level + 1)}
    </li>`).join('')}</ul>`;
}

function assignmentLabel(item) {
  if (!item) return 'Назначение не задано';
  return [item.position_name, item.unit_name].filter(Boolean).join(' · ') || item.unit_name || 'Назначение';
}

function renderPeople(people) {
  if (!(people || []).length) return '<div class="organization-empty">Сотрудники не добавлены.</div>';
  return `<div class="organization-people-list">${people.map((person) => `
    <article class="organization-person-card" data-organization-person-id="${escOrg(person.id)}">
      <div><strong>${escOrg(person.display_name)}</strong><span>${escOrg(assignmentLabel(person.appointment))}</span>
        <small>${person.appointment ? `${escOrg(person.appointment.valid_from)} — ${escOrg(person.appointment.valid_to || 'по настоящее время')}` : 'История пока пуста'}</small></div>
      <div class="organization-person-actions">
        <button class="quiet-button" type="button" data-organization-history="${escOrg(person.id)}">История</button>
        <button class="secondary-button" type="button" data-organization-appoint="${escOrg(person.id)}">Назначить</button>
      </div>
    </article>`).join('')}</div>`;
}

function renderOrganization(snapshot) {
  organizationState.snapshot = snapshot;
  const tree = $o('#organization-tree');
  const people = $o('#organization-people');
  if (tree) tree.innerHTML = renderTree(snapshot.tree || []);
  if (people) people.innerHTML = renderPeople(snapshot.people || []);
  const units = flattenUnits(snapshot.tree || []);
  if ($o('#organization-unit-count')) $o('#organization-unit-count').textContent = `${units.length}`;
  if ($o('#organization-people-count')) $o('#organization-people-count').textContent = `${(snapshot.people || []).length}`;
}

function authGateVisible() {
  return Boolean($o('#auth-gate') && !$o('#auth-gate')?.classList.contains('hidden'));
}

async function loadOrganization() {
  if (authGateVisible() || !ensureOrganizationUi() || organizationState.loading) return;
  organizationState.loading = true;
  setOrganizationNotice('Загрузка структуры…');
  try {
    const asOf = $o('#organization-as-of')?.value || new Date().toISOString().slice(0, 10);
    const data = await organizationApi(`/api/organization?asOf=${encodeURIComponent(asOf)}&includeInactive=1`);
    renderOrganization(data);
    setOrganizationNotice('');
  } catch (error) {
    setOrganizationNotice(error.message, 'error');
  } finally {
    organizationState.loading = false;
  }
}

function unitForm(unit = null) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <header class="organization-modal-head"><div><span>Структура</span><h3 id="organization-modal-title">${unit ? 'Изменить подразделение' : 'Новое подразделение'}</h3></div><button class="icon-button" type="button" data-organization-close>×</button></header>
    <form class="organization-modal-body" data-organization-unit-form data-unit-id="${escOrg(unit?.id || '')}">
      <label class="field"><span>Название</span><input name="name" value="${escOrg(unit?.name || '')}" required></label>
      <div class="organization-grid-two">
        <label class="field"><span>Код</span><input name="code" value="${escOrg(unit?.code || '')}" placeholder="Необязательно"></label>
        <label class="field"><span>Вид</span><select name="unitKind">${[
          ['organization','Организация'],['faculty','Факультет'],['department','Кафедра/подразделение'],
          ['laboratory','Лаборатория'],['section','Секция'],['other','Другое']
        ].map(([value,label]) => `<option value="${value}" ${unit?.unit_kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>В составе</span><select name="parentUnitId">${unitOptions(unit?.parent_unit_id || '', true)}</select></label>
      <div class="organization-grid-two">
        <label class="field"><span>Действует с</span><input name="validFrom" type="date" value="${escOrg(unit?.valid_from || today)}" required></label>
        <label class="field"><span>Действует по</span><input name="validTo" type="date" value="${escOrg(unit?.valid_to || '')}"></label>
      </div>
      ${unit ? `<label class="field"><span>Состояние</span><select name="status"><option value="active" ${unit.status === 'active' ? 'selected' : ''}>Действует</option><option value="inactive" ${unit.status === 'inactive' ? 'selected' : ''}>Закрыто</option></select></label>
        <label class="field"><span>Причина изменения</span><textarea name="reason" rows="2" required></textarea></label>` : ''}
      <div class="organization-modal-actions"><button class="secondary-button" type="button" data-organization-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`;
}

function positionForm(position = null) {
  return `
    <header class="organization-modal-head"><div><span>Справочник</span><h3 id="organization-modal-title">${position ? 'Изменить должность' : 'Новая должность'}</h3></div><button class="icon-button" type="button" data-organization-close>×</button></header>
    <form class="organization-modal-body" data-organization-position-form data-position-id="${escOrg(position?.id || '')}">
      <label class="field"><span>Название</span><input name="name" value="${escOrg(position?.name || '')}" required></label>
      <label class="field"><span>Код</span><input name="code" value="${escOrg(position?.code || '')}" placeholder="Необязательно"></label>
      ${position ? `<label class="field"><span>Состояние</span><select name="status"><option value="active" ${position.status === 'active' ? 'selected' : ''}>Используется</option><option value="inactive" ${position.status === 'inactive' ? 'selected' : ''}>Отключена</option></select></label>
        <label class="field"><span>Причина изменения</span><textarea name="reason" rows="2" required></textarea></label>` : ''}
      <div class="organization-modal-actions"><button class="secondary-button" type="button" data-organization-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`;
}

function appointmentForm(personId = '', appointment = null) {
  const today = new Date().toISOString().slice(0, 10);
  const selectedPersonId = appointment?.person_id || personId;
  return `
    <header class="organization-modal-head"><div><span>Кадровая история</span><h3 id="organization-modal-title">${appointment ? 'Исправить назначение' : 'Новое назначение'}</h3></div><button class="icon-button" type="button" data-organization-close>×</button></header>
    <form class="organization-modal-body" data-organization-appointment-form data-appointment-id="${escOrg(appointment?.id || '')}">
      <label class="field"><span>Сотрудник</span><select name="personId" ${appointment ? 'disabled' : ''}>${personOptions(selectedPersonId)}</select></label>
      <div class="organization-grid-two">
        <label class="field"><span>Подразделение</span><select name="unitId" required>${unitOptions(appointment?.unit_id || '', false)}</select></label>
        <label class="field"><span>Должность</span><select name="positionId">${positionOptions(appointment?.position_id || '')}</select></label>
      </div>
      <div class="organization-grid-two">
        <label class="field"><span>Вид назначения</span><select name="appointmentKind"><option value="primary" ${appointment?.appointment_kind !== 'additional' ? 'selected' : ''}>Основное</option><option value="additional" ${appointment?.appointment_kind === 'additional' ? 'selected' : ''}>Дополнительное</option></select></label>
        <label class="field"><span>Руководитель</span><select name="managerPersonId">${personOptions(appointment?.manager_person_id || '', selectedPersonId)}</select></label>
      </div>
      <div class="organization-grid-two">
        <label class="field"><span>С</span><input name="validFrom" type="date" value="${escOrg(appointment?.valid_from || today)}" required></label>
        <label class="field"><span>По</span><input name="validTo" type="date" value="${escOrg(appointment?.valid_to || '')}"></label>
      </div>
      ${appointment ? '<label class="field"><span>Причина исправления</span><textarea name="reason" rows="2" required></textarea></label>' : '<label class="organization-check"><input name="closePrevious" type="checkbox" checked><span>Закрыть предыдущее основное назначение накануне</span></label>'}
      <div class="organization-modal-actions"><button class="secondary-button" type="button" data-organization-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`;
}

async function openHistory(personId) {
  const person = organizationState.snapshot?.people?.find((item) => item.id === personId);
  const data = await organizationApi(`/api/people/${encodeURIComponent(personId)}/appointments`);
  const items = data.items || [];
  showOrganizationModal(`
    <header class="organization-modal-head"><div><span>История сотрудника</span><h3 id="organization-modal-title">${escOrg(person?.display_name || 'Сотрудник')}</h3></div><button class="icon-button" type="button" data-organization-close>×</button></header>
    <div class="organization-modal-body">
      <div class="organization-history">${items.length ? items.map((item) => `
        <article><div><strong>${escOrg(assignmentLabel(item))}</strong><span>${escOrg(item.valid_from)} — ${escOrg(item.valid_to || 'по настоящее время')}</span><small>${item.appointment_kind === 'primary' ? 'Основное назначение' : 'Дополнительное назначение'}${item.manager_name ? ` · руководитель: ${escOrg(item.manager_name)}` : ''}</small></div><button class="quiet-button" type="button" data-organization-edit-appointment="${escOrg(item.id)}">Исправить</button></article>`).join('') : '<div class="organization-empty">История пока пуста.</div>'}</div>
      <div class="organization-modal-actions"><button class="primary-button" type="button" data-organization-appoint="${escOrg(personId)}">Добавить назначение</button><button class="secondary-button" type="button" data-organization-close>Закрыть</button></div>
    </div>`);
}

async function saveUnit(form) {
  const id = form.dataset.unitId;
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.parentUnitId ||= null;
  payload.validTo ||= null;
  modalError(form, '');
  const submit = $o('button[type="submit"]', form);
  submit.disabled = true;
  try {
    await organizationApi(id ? `/api/organization/units/${encodeURIComponent(id)}` : '/api/organization/units', {
      method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    closeOrganizationModal();
    await loadOrganization();
    setOrganizationNotice(id ? 'Подразделение обновлено. История назначений сохранена.' : 'Подразделение создано.');
  } catch (error) {
    modalError(form, error.message);
    submit.disabled = false;
  }
}

async function savePosition(form) {
  const id = form.dataset.positionId;
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  modalError(form, '');
  const submit = $o('button[type="submit"]', form);
  submit.disabled = true;
  try {
    await organizationApi(id ? `/api/organization/positions/${encodeURIComponent(id)}` : '/api/organization/positions', {
      method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    closeOrganizationModal();
    await loadOrganization();
    setOrganizationNotice(id ? 'Должность обновлена.' : 'Должность добавлена.');
  } catch (error) {
    modalError(form, error.message);
    submit.disabled = false;
  }
}

async function saveAppointment(form) {
  const id = form.dataset.appointmentId;
  const data = new FormData(form);
  const personId = String(data.get('personId') || form.querySelector('[name="personId"]')?.value || '').trim();
  const payload = Object.fromEntries(data.entries());
  payload.positionId ||= null;
  payload.managerPersonId ||= null;
  payload.validTo ||= null;
  payload.closePrevious = data.get('closePrevious') === 'on';
  delete payload.personId;
  modalError(form, '');
  const submit = $o('button[type="submit"]', form);
  submit.disabled = true;
  try {
    await organizationApi(id ? `/api/appointments/${encodeURIComponent(id)}` : `/api/people/${encodeURIComponent(personId)}/appointments`, {
      method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    closeOrganizationModal();
    await loadOrganization();
    setOrganizationNotice(id ? 'Период назначения исправлен. Предыдущее значение осталось в аудите.' : 'Назначение сохранено.');
  } catch (error) {
    modalError(form, error.message);
    submit.disabled = false;
  }
}

document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-organization-refresh]')) return loadOrganization();
  if (event.target.closest('[data-organization-close]') || event.target === $o('#organization-backdrop')) return closeOrganizationModal();
  if (event.target.closest('[data-organization-add-unit]')) return showOrganizationModal(unitForm());
  if (event.target.closest('[data-organization-add-position]')) return showOrganizationModal(positionForm());
  if (event.target.closest('[data-organization-add-appointment]')) return showOrganizationModal(appointmentForm());
  const editUnit = event.target.closest('[data-organization-edit-unit]');
  if (editUnit) {
    const unit = flattenUnits(organizationState.snapshot?.tree || []).find((item) => item.id === editUnit.dataset.organizationEditUnit);
    return showOrganizationModal(unitForm(unit));
  }
  const appoint = event.target.closest('[data-organization-appoint]');
  if (appoint) return showOrganizationModal(appointmentForm(appoint.dataset.organizationAppoint));
  const history = event.target.closest('[data-organization-history]');
  if (history) {
    try { await openHistory(history.dataset.organizationHistory); }
    catch (error) { setOrganizationNotice(error.message, 'error'); }
    return;
  }
  const editAppointment = event.target.closest('[data-organization-edit-appointment]');
  if (editAppointment) {
    const personId = $o('[data-organization-appoint]')?.dataset.organizationAppoint;
    const data = personId ? await organizationApi(`/api/people/${encodeURIComponent(personId)}/appointments`) : { items: [] };
    const appointment = (data.items || []).find((item) => item.id === editAppointment.dataset.organizationEditAppointment);
    if (appointment) showOrganizationModal(appointmentForm(appointment.person_id, appointment));
  }
}, true);

document.addEventListener('submit', (event) => {
  const unit = event.target.closest('[data-organization-unit-form]');
  if (unit) { event.preventDefault(); saveUnit(unit); return; }
  const position = event.target.closest('[data-organization-position-form]');
  if (position) { event.preventDefault(); savePosition(position); return; }
  const appointment = event.target.closest('[data-organization-appointment-form]');
  if (appointment) { event.preventDefault(); saveAppointment(appointment); }
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'organization-as-of') loadOrganization();
});

new MutationObserver(() => {
  if (!authGateVisible() && ensureOrganizationUi() && adminHost()?.classList.contains('active') && !organizationState.snapshot) loadOrganization();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

ensureOrganizationUi();
window.kafedraLoadOrganization = loadOrganization;
