const orgFieldsState = { people: null, decorating: false };

async function orgFieldsApi(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Ошибка HTTP ${response.status}`);
  return payload;
}

function fieldError(form, message = '') {
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

async function people() {
  if (!orgFieldsState.people) {
    const payload = await orgFieldsApi('/api/people');
    orgFieldsState.people = (payload.items || []).filter((item) => item.status !== 'inactive');
  }
  return orgFieldsState.people;
}

async function decorateUnitForm(form) {
  if (form.dataset.periodFieldsReady) return;
  form.dataset.periodFieldsReady = '1';
  const grid = form.querySelector('.organization-form-grid');
  const id = form.dataset.unitId;
  let current = null;
  if (id) current = await orgFieldsApi(`/api/organization/units/${encodeURIComponent(id)}`);
  grid.insertAdjacentHTML('beforeend', `
    <label class="field"><span>Действует с</span><input name="validFrom" type="date" value="${current?.valid_from || new Date().toISOString().slice(0,10)}" required></label>
    <label class="field"><span>Действует по</span><input name="validTo" type="date" value="${current?.valid_to || ''}"></label>
  `);
}

async function decorateAppointmentForm(form) {
  if (form.dataset.managerFieldReady) return;
  form.dataset.managerFieldReady = '1';
  const list = await people();
  const id = form.dataset.appointmentId;
  let current = null;
  if (id) {
    const history = await orgFieldsApi('/api/organization/appointments?includeEnded=1');
    current = (history.items || []).find((item) => item.id === id) || null;
  }
  const selectedPersonId = form.querySelector('[name="personId"]')?.value || current?.person_id || '';
  const options = ['<option value="">Руководитель подразделения</option>', ...list
    .filter((item) => item.id !== selectedPersonId)
    .map((item) => `<option value="${item.id}" ${item.id === current?.manager_person_id ? 'selected' : ''}>${item.display_name}</option>`)]
    .join('');
  form.querySelector('.organization-form-grid').insertAdjacentHTML('beforeend', `<label class="field"><span>Персональный руководитель</span><select name="managerPersonId">${options}</select></label>`);
  if (!id) {
    form.querySelector('.organization-form-actions')?.insertAdjacentHTML('beforebegin', `
      <label class="organization-check"><input name="closePrevious" type="checkbox" checked><span>При переводе безопасно закрыть предыдущее основное назначение накануне</span></label>
    `);
  }
}

async function decorateForms() {
  if (orgFieldsState.decorating) return;
  orgFieldsState.decorating = true;
  try {
    const unit = document.querySelector('[data-org-unit-form]');
    if (unit) await decorateUnitForm(unit);
    const appointment = document.querySelector('[data-org-appointment-form]');
    if (appointment) await decorateAppointmentForm(appointment);
  } catch (error) {
    const form = document.querySelector('[data-org-unit-form], [data-org-appointment-form]');
    if (form) fieldError(form, error.message);
  } finally { orgFieldsState.decorating = false; }
}

async function saveUnit(form) {
  const values = Object.fromEntries(new FormData(form));
  const id = form.dataset.unitId;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; fieldError(form, '');
  try {
    await orgFieldsApi(id ? `/api/organization/units/${encodeURIComponent(id)}` : '/api/organization/units', {
      method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: values.name, code: values.code, unitKind: values.unitKind,
        parentId: values.parentId || null, validFrom: values.validFrom, validTo: values.validTo || null,
        ...(id ? { status: values.status } : {}) })
    });
    form.closest('#organization-editor')?.classList.add('hidden');
    window.kafedraOpenOrganization?.();
  } catch (error) { fieldError(form, error.message); button.disabled = false; }
}

async function saveAppointment(form) {
  const data = new FormData(form);
  const id = form.dataset.appointmentId;
  const personId = data.get('personId') || form.querySelector('[name="personId"]')?.value;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; fieldError(form, '');
  try {
    await orgFieldsApi(id ? `/api/organization/appointments/${encodeURIComponent(id)}` : '/api/organization/appointments', {
      method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personId, organizationUnitId: data.get('organizationUnitId'),
        positionId: data.get('positionId') || null, positionTitleSnapshot: data.get('positionTitleSnapshot') || null,
        managerPersonId: data.get('managerPersonId') || null, appointmentKind: data.get('appointmentKind'),
        workloadFraction: Number(data.get('workloadFraction')), validFrom: data.get('validFrom'),
        validTo: data.get('validTo') || null, closePrevious: id ? undefined : data.get('closePrevious') === 'on' })
    });
    form.closest('#organization-editor')?.classList.add('hidden');
    window.kafedraOpenOrganization?.();
  } catch (error) { fieldError(form, error.message); button.disabled = false; }
}

document.addEventListener('submit', (event) => {
  const unit = event.target.closest('[data-org-unit-form]');
  const appointment = event.target.closest('[data-org-appointment-form]');
  if (!unit && !appointment) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (unit) saveUnit(unit); else saveAppointment(appointment);
}, true);

new MutationObserver(() => queueMicrotask(decorateForms)).observe(document.body, { childList: true, subtree: true });
decorateForms();
