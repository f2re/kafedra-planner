const pftState = {
  activeAssignmentId: '',
  activeDetail: null,
  views: [],
  people: [],
  enhancing: false
};

const pftOne = (selector, root = document) => root.querySelector(selector);
const pftSafe = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

async function pftApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function pftToast(message, kind = 'normal') {
  let toast = pftOne('#plan-fact-tool-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'plan-fact-tool-toast';
    toast.className = 'plan-fact-tool-toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

function currentProfileId() {
  return pftOne('#current-person-select')?.value
    || localStorage.getItem('kafedra-current-person-id')
    || '';
}

function rawFilterSnapshot() {
  const form = pftOne('#plan-fact-filters');
  return form ? Object.fromEntries(new FormData(form)) : {};
}

function effectiveFilterParams(filters = rawFilterSnapshot()) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value || ['scope', 'personId'].includes(key)) continue;
    params.set(key, value);
  }
  const personId = filters.personId || '';
  if (personId && filters.scope === 'owner') params.set('ownerPersonId', personId);
  if (personId && filters.scope === 'manager') params.set('managerPersonId', personId);
  return params;
}

function closeToolSheet(sheet) {
  sheet?.classList.add('hidden');
  const anotherOpen = [...document.querySelectorAll('.sheet:not(.hidden)')]
    .some((item) => item !== sheet);
  if (!anotherOpen) pftOne('#sheet-backdrop')?.classList.add('hidden');
}

function openToolSheet(sheet) {
  if (!sheet) return;
  sheet.classList.remove('hidden');
  pftOne('#sheet-backdrop')?.classList.remove('hidden');
  sheet.querySelector('input:not([type="hidden"]), textarea, select')?.focus();
}

function ensureToolUi() {
  if (!pftOne('#plan-fact-tools-style')) {
    const link = document.createElement('link');
    link.id = 'plan-fact-tools-style';
    link.rel = 'stylesheet';
    link.href = '/plan-fact-tools.css';
    document.head.append(link);
  }

  const filters = pftOne('#plan-fact-filters');
  if (filters && !pftOne('#plan-fact-tools-bar')) {
    filters.insertAdjacentHTML('afterend', `<div id="plan-fact-tools-bar" class="plan-fact-tools-bar">
      <label><span>Сохранённый вид</span><select id="plan-fact-view-select"><option value="">Текущие фильтры</option></select></label>
      <button id="plan-fact-view-save" class="secondary-button" type="button">Сохранить вид</button>
      <button id="plan-fact-view-delete" class="quiet-button" type="button" disabled>Удалить</button>
      <span class="plan-fact-tools-spacer"></span>
      <button id="plan-fact-export-csv" class="secondary-button" type="button">CSV</button>
      <button id="plan-fact-export-json" class="secondary-button" type="button">JSON</button>
    </div>`);
  }

  if (!pftOne('#metric-correction-sheet')) {
    document.body.insertAdjacentHTML('beforeend', `<section id="metric-correction-sheet" class="sheet hidden" role="dialog" aria-modal="true" aria-labelledby="metric-correction-title">
      <header class="sheet-header">
        <div><div class="eyebrow">План / факт</div><h2 id="metric-correction-title">Исправить значение</h2></div>
        <button class="icon-button" type="button" data-pft-close aria-label="Закрыть">×</button>
      </header>
      <form id="metric-correction-form" class="sheet-body form-grid">
        <input name="assignmentId" type="hidden">
        <input name="assignmentEvidenceId" type="hidden">
        <input name="metricKey" type="hidden">
        <input name="fieldKind" type="hidden">
        <label class="field full"><span>Показатель</span><input name="metricName" readonly></label>
        <label class="field"><span>Машинное значение</span><input name="machineValue" readonly></label>
        <label class="field"><span>Исправленное значение</span><input name="value" type="number" step="any" required></label>
        <label class="field full"><span>Причина исправления</span><textarea name="reason" rows="3" minlength="3" required placeholder="Например: в отчёте опечатка, подтверждено приложением № 2"></textarea></label>
        <label class="field full"><span>Кто исправляет</span><select name="actorPersonId"><option value="">Не указан</option></select></label>
        <p class="helper full">Исходное машинное значение сохраняется. Новая запись добавляется в журнал и может быть отменена.</p>
        <div class="sheet-actions full"><button class="secondary-button" type="button" data-pft-close>Отмена</button><button class="primary-button" type="submit">Сохранить исправление</button></div>
      </form>
    </section>`);
  }

  if (!pftOne('#plan-fact-view-sheet')) {
    document.body.insertAdjacentHTML('beforeend', `<section id="plan-fact-view-sheet" class="sheet hidden" role="dialog" aria-modal="true" aria-labelledby="plan-fact-view-title">
      <header class="sheet-header">
        <div><div class="eyebrow">План / факт</div><h2 id="plan-fact-view-title">Сохранить набор фильтров</h2></div>
        <button class="icon-button" type="button" data-pft-close aria-label="Закрыть">×</button>
      </header>
      <form id="plan-fact-view-form" class="sheet-body form-grid">
        <label class="field full"><span>Название</span><input name="name" minlength="2" maxlength="100" required placeholder="Например, Наука · осенний семестр"></label>
        <label class="checkbox-field full"><input name="isShared" type="checkbox"><span>Показывать всей кафедре</span></label>
        <p class="helper full">Сохраняются текущие сотрудник, режим, период, направление и состояние.</p>
        <div class="sheet-actions full"><button class="secondary-button" type="button" data-pft-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
      </form>
    </section>`);
  }
}

async function loadPeopleForTools() {
  const data = await pftApi('/api/people');
  pftState.people = data.items || [];
  const select = pftOne('#metric-correction-form select[name="actorPersonId"]');
  if (!select) return;
  const selected = currentProfileId();
  select.innerHTML = `<option value="">Не указан</option>${pftState.people
    .map((person) => `<option value="${pftSafe(person.id)}">${pftSafe(person.display_name)}</option>`)
    .join('')}`;
  if (selected && pftState.people.some((person) => person.id === selected)) select.value = selected;
}

async function loadViews() {
  ensureToolUi();
  const profile = currentProfileId();
  const query = profile ? `?personId=${encodeURIComponent(profile)}` : '';
  const data = await pftApi(`/api/plan-fact/views${query}`);
  pftState.views = data.items || [];
  const select = pftOne('#plan-fact-view-select');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = `<option value="">Текущие фильтры</option>${pftState.views.map((view) =>
    `<option value="${pftSafe(view.id)}">${view.isShared ? 'Общий · ' : ''}${pftSafe(view.name)}</option>`
  ).join('')}`;
  if (pftState.views.some((view) => view.id === previous)) select.value = previous;
  pftOne('#plan-fact-view-delete').disabled = !select.value;
}

function applyView(view) {
  const form = pftOne('#plan-fact-filters');
  if (!form || !view) return;
  for (const element of form.elements) {
    if (!element.name) continue;
    element.value = view.filters?.[element.name] || '';
  }
  form.dispatchEvent(new Event('change', { bubbles: true }));
}

function startDownload(format) {
  const params = effectiveFilterParams();
  const link = document.createElement('a');
  link.href = `/api/plan-fact/export.${format}?${params}`;
  link.download = `plan-fakt.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
}

function correctionValueHtml(metric, fieldKind, evidenceId) {
  const isTarget = fieldKind === 'target_numeric';
  const correction = isTarget ? metric.targetCorrection : metric.actualCorrection;
  const effective = isTarget ? metric.targetNumeric : metric.actualNumeric;
  const machine = isTarget ? metric.machineTargetNumeric : metric.machineActualNumeric;
  const canEdit = isTarget
    ? machine !== null && machine !== undefined
    : Boolean(evidenceId) && machine !== null && machine !== undefined;
  const unit = metric.unit ? ` ${pftSafe(metric.unit)}` : '';
  return `<div class="metric-correction-value ${correction ? 'corrected' : ''}">
    <strong>${effective ?? '—'}${effective === null || effective === undefined ? '' : unit}</strong>
    ${correction ? `<span class="metric-correction-badge" title="${pftSafe(correction.reason)}">исправлено</span><small>машинное: ${machine ?? '—'}${machine === null || machine === undefined ? '' : unit}</small>` : ''}
    ${canEdit ? `<button class="metric-edit-button" type="button"
      data-pft-correct
      data-metric-key="${pftSafe(metric.key)}"
      data-metric-name="${pftSafe(metric.name)}"
      data-field-kind="${fieldKind}"
      data-evidence-id="${pftSafe(isTarget ? '' : evidenceId)}"
      data-machine-value="${pftSafe(machine)}"
      data-effective-value="${pftSafe(effective)}">Изменить</button>` : ''}
  </div>`;
}

function correctionHistoryHtml(item) {
  const corrections = item.corrections || [];
  if (!corrections.length) {
    return `<section id="plan-fact-correction-history" class="plan-fact-correction-history"><h3>История исправлений</h3><p class="helper">Ручных исправлений нет.</p></section>`;
  }
  return `<section id="plan-fact-correction-history" class="plan-fact-correction-history">
    <h3>История исправлений</h3>
    <div class="correction-history-list">${corrections.map((entry) => `<article class="${entry.active ? 'active' : 'inactive'}">
      <div><strong>${entry.fieldKind === 'target_numeric' ? 'План' : 'Факт'} · ${pftSafe(entry.metricKey)}</strong><span>${entry.machineValue ?? '—'} → ${entry.correctedValue}</span></div>
      <p>${pftSafe(entry.reason)}</p>
      <small>${pftSafe(entry.actorName || 'Автор не указан')} · ${pftSafe(String(entry.createdAt || '').replace('T', ' ').slice(0, 16))}${entry.revertedAt ? ' · отменено' : entry.supersededById ? ' · заменено' : ''}</small>
      ${entry.active ? `<button class="text-button" type="button" data-pft-revert="${pftSafe(entry.id)}">Отменить исправление</button>` : ''}
    </article>`).join('')}</div>
  </section>`;
}

async function enhanceInspector(force = false) {
  if (pftState.enhancing || !pftState.activeAssignmentId) return;
  const inspector = pftOne('#ux-inspector-body .plan-fact-inspector');
  if (!inspector) return;
  pftState.enhancing = true;
  try {
    const item = await pftApi(`/api/assignments/${encodeURIComponent(pftState.activeAssignmentId)}/plan-fact`);
    const signature = `${item.progressRevision || ''}:${item.corrections?.[0]?.id || ''}:${item.correctionCount || 0}`;
    if (!force && inspector.dataset.pftSignature === signature) return;
    inspector.dataset.pftSignature = signature;
    pftState.activeDetail = item;

    const progress = inspector.querySelector('.plan-fact-inspector-summary div:first-child strong');
    if (progress) progress.textContent = `${item.progressPercent}%`;

    const rows = [...inspector.querySelectorAll('.plan-fact-table tbody tr')];
    rows.forEach((row, index) => {
      const metric = item.metrics[index];
      if (!metric || row.cells.length < 4) return;
      row.cells[1].innerHTML = correctionValueHtml(metric, 'target_numeric', item.selectedEvidenceId);
      row.cells[2].innerHTML = correctionValueHtml(metric, 'actual_numeric', item.selectedEvidenceId);
      row.cells[3].innerHTML = metric.attainmentPercent === null
        ? '—'
        : `<span class="metric-attainment ${pftSafe(metric.status)}">${metric.attainmentPercent}%</span>`;
    });

    pftOne('#plan-fact-correction-history', inspector)?.remove();
    inspector.insertAdjacentHTML('beforeend', correctionHistoryHtml(item));
  } finally {
    pftState.enhancing = false;
  }
}

function openCorrection(button) {
  const form = pftOne('#metric-correction-form');
  if (!form) return;
  form.reset();
  form.elements.assignmentId.value = pftState.activeAssignmentId;
  form.elements.assignmentEvidenceId.value = button.dataset.evidenceId || '';
  form.elements.metricKey.value = button.dataset.metricKey || '';
  form.elements.fieldKind.value = button.dataset.fieldKind || '';
  form.elements.metricName.value = `${button.dataset.fieldKind === 'target_numeric' ? 'План' : 'Факт'} · ${button.dataset.metricName || ''}`;
  form.elements.machineValue.value = button.dataset.machineValue || '';
  form.elements.value.value = button.dataset.effectiveValue || button.dataset.machineValue || '';
  loadPeopleForTools().catch(() => {});
  openToolSheet(pftOne('#metric-correction-sheet'));
}

async function submitCorrection(form) {
  const values = Object.fromEntries(new FormData(form));
  const result = await pftApi(`/api/assignments/${encodeURIComponent(values.assignmentId)}/plan-fact/corrections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      assignmentEvidenceId: values.assignmentEvidenceId || null,
      metricKey: values.metricKey,
      fieldKind: values.fieldKind,
      value: values.value,
      reason: values.reason,
      actorPersonId: values.actorPersonId || null
    })
  });
  pftState.activeDetail = result.item;
  closeToolSheet(pftOne('#metric-correction-sheet'));
  await enhanceInspector(true);
  pftOne('#plan-fact-filters')?.dispatchEvent(new Event('change', { bubbles: true }));
  pftToast('Исправление сохранено.');
}

async function revertCorrection(correctionId) {
  await pftApi(`/api/plan-fact/corrections/${encodeURIComponent(correctionId)}/revert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actorPersonId: currentProfileId() || null,
      reason: 'Отменено оператором'
    })
  });
  await enhanceInspector(true);
  pftOne('#plan-fact-filters')?.dispatchEvent(new Event('change', { bubbles: true }));
  pftToast('Исправление отменено.');
}

const observer = new MutationObserver(() => {
  ensureToolUi();
  if (pftOne('#ux-inspector-body .plan-fact-inspector')) {
    queueMicrotask(() => enhanceInspector().catch(() => {}));
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', (event) => {
  const card = event.target.closest('[data-plan-fact-id]');
  if (card?.dataset.planFactKind === 'assignment') {
    pftState.activeAssignmentId = card.dataset.planFactId;
    setTimeout(() => enhanceInspector(true).catch(() => {}), 80);
  }

  if (event.target.closest('[data-view="plan-fact"]')) {
    setTimeout(() => {
      ensureToolUi();
      loadViews().catch(() => {});
    }, 80);
  }

  const correction = event.target.closest('[data-pft-correct]');
  if (correction) openCorrection(correction);

  const revert = event.target.closest('[data-pft-revert]');
  if (revert) revertCorrection(revert.dataset.pftRevert).catch((error) => pftToast(error.message, 'error'));

  if (event.target.closest('#plan-fact-view-save')) {
    pftOne('#plan-fact-view-form')?.reset();
    openToolSheet(pftOne('#plan-fact-view-sheet'));
  }

  if (event.target.closest('#plan-fact-view-delete')) {
    const select = pftOne('#plan-fact-view-select');
    if (!select?.value) return;
    const profile = currentProfileId();
    const query = profile ? `?personId=${encodeURIComponent(profile)}` : '';
    pftApi(`/api/plan-fact/views/${encodeURIComponent(select.value)}${query}`, { method: 'DELETE' })
      .then(() => {
        pftToast('Сохранённый вид удалён.');
        return loadViews();
      })
      .catch((error) => pftToast(error.message, 'error'));
  }

  if (event.target.closest('#plan-fact-export-csv')) startDownload('csv');
  if (event.target.closest('#plan-fact-export-json')) startDownload('json');

  const close = event.target.closest('[data-pft-close]');
  if (close) closeToolSheet(close.closest('.sheet'));
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'plan-fact-view-select') {
    const view = pftState.views.find((item) => item.id === event.target.value);
    pftOne('#plan-fact-view-delete').disabled = !view;
    if (view) {
      applyView(view);
      pftApi(`/api/plan-fact/views/${encodeURIComponent(view.id)}`, { method: 'POST' }).catch(() => {});
    }
  }
  if (event.target.id === 'current-person-select') {
    setTimeout(() => loadViews().catch(() => {}), 30);
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'metric-correction-form') {
    event.preventDefault();
    submitCorrection(event.target).catch((error) => pftToast(error.message, 'error'));
  }
  if (event.target.id === 'plan-fact-view-form') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const profile = currentProfileId();
    pftApi('/api/plan-fact/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        isShared: Boolean(values.isShared),
        ownerPersonId: profile || null,
        createdByPersonId: profile || null,
        filters: rawFilterSnapshot()
      })
    }).then(async (view) => {
      closeToolSheet(pftOne('#plan-fact-view-sheet'));
      await loadViews();
      const select = pftOne('#plan-fact-view-select');
      if (select) select.value = view.id;
      pftOne('#plan-fact-view-delete').disabled = false;
      pftToast('Набор фильтров сохранён.');
    }).catch((error) => pftToast(error.message, 'error'));
  }
});

ensureToolUi();
loadViews().catch(() => {});
