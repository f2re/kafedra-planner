const docomatorFieldsState = {
  initialized: false,
  settings: null,
  settingsLoadAttempted: false,
  properties: [],
  loading: false,
  loadedSpaceId: null,
  savePromise: null,
  importReplay: false,
  touched: false
};

const $df = (selector, root = document) => root.querySelector(selector);

function escDf(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function dfApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureStyles() {
  if ($df('#docomator-fields-styles')) return;
  const link = document.createElement('link');
  link.id = 'docomator-fields-styles';
  link.rel = 'stylesheet';
  link.href = '/docomator-fields.css';
  document.head.append(link);
}

function ensureUi() {
  ensureStyles();
  const source = $df('#docomator-source');
  if (!source) return false;
  if ($df('#docomator-fields-panel', source)) return true;
  const info = $df('.docomator-info-row', source);
  const html = `
    <section id="docomator-fields-panel" class="docomator-fields-panel">
      <header class="docomator-fields-head">
        <div><strong>Какие данные переносить</strong><span id="docomator-fields-summary">ФИО переносится всегда</span></div>
        <button class="quiet-button" type="button" data-docomator-fields-refresh>Обновить поля</button>
      </header>
      <div class="docomator-fields-grid">
        <div class="docomator-fixed-field"><span>ФИО</span><strong>Всегда</strong><small>Используется для идентификации и сопоставления человека.</small></div>
        <label class="field"><span>E-mail</span><select id="docomator-email-field"><option value="">Не переносить</option></select></label>
        <label class="field"><span>Должность</span><select id="docomator-position-field"><option value="">Не переносить</option></select></label>
      </div>
      <details class="docomator-extra-details">
        <summary><span>Дополнительные поля</span><strong id="docomator-extra-count">0 выбрано</strong></summary>
        <div class="docomator-extra-body">
          <label class="field"><span>Поиск поля</span><input id="docomator-field-search" type="search" autocomplete="off" placeholder="Телефон, подразделение, учёная степень…"></label>
          <div id="docomator-extra-fields" class="docomator-extra-fields"></div>
        </div>
      </details>
      <p id="docomator-fields-status" class="docomator-fields-status">Сначала проверьте соединение и выберите пространство.</p>
    </section>`;
  if (info) info.insertAdjacentHTML('beforebegin', html);
  else source.insertAdjacentHTML('beforeend', html);
  docomatorFieldsState.initialized = true;
  return true;
}

function baseValues() {
  const form = $df('#docomator-settings-form');
  return {
    scheme: form?.elements.scheme?.value || docomatorFieldsState.settings?.scheme || 'http',
    host: form?.elements.host?.value?.trim() || docomatorFieldsState.settings?.host || '',
    port: Number(form?.elements.port?.value || docomatorFieldsState.settings?.port || 8080),
    accessCode: form?.elements.accessCode?.value?.trim() || undefined,
    spaceId: $df('#docomator-space')?.value || null,
    groupId: $df('#docomator-group')?.value || null,
    includeInactive: Boolean($df('#docomator-include-inactive')?.checked)
  };
}

function selectedMapping() {
  return {
    emailPropertyKey: $df('#docomator-email-field')?.value || null,
    positionPropertyKey: $df('#docomator-position-field')?.value || null,
    extraPropertyKeys: [...document.querySelectorAll('#docomator-extra-fields input[type="checkbox"]:checked')]
      .map((input) => input.value)
  };
}

function optionMarkup(properties, selected) {
  return `<option value="">Не переносить</option>${properties.map((item) => `
    <option value="${escDf(item.key)}" ${item.key === selected ? 'selected' : ''}>${escDf(item.label)} · ${escDf(item.key)}</option>
  `).join('')}`;
}

function renderExtras(properties, selectedKeys) {
  const host = $df('#docomator-extra-fields');
  if (!host) return;
  const selected = new Set(selectedKeys || []);
  host.innerHTML = properties.length ? properties.map((item) => `
    <label class="docomator-extra-field" data-search="${escDf(`${item.label} ${item.key}`.toLocaleLowerCase('ru-RU'))}">
      <input type="checkbox" value="${escDf(item.key)}" ${selected.has(item.key) ? 'checked' : ''}>
      <span><strong>${escDf(item.label)}</strong><small>${escDf(item.key)} · ${escDf(item.valueType || 'string')}</small></span>
    </label>`).join('') : '<div class="docomator-fields-empty">У этого пространства нет доступных дополнительных полей сотрудников.</div>';
  updateSummary();
}

function updateSummary() {
  const mapping = selectedMapping();
  const extraCount = mapping.extraPropertyKeys.length;
  const count = $df('#docomator-extra-count');
  if (count) count.textContent = `${extraCount} выбрано`;
  const parts = ['ФИО'];
  if (mapping.emailPropertyKey) parts.push('e-mail');
  if (mapping.positionPropertyKey) parts.push('должность');
  if (extraCount) parts.push(`ещё ${extraCount}`);
  const summary = $df('#docomator-fields-summary');
  if (summary) summary.textContent = `Будут перенесены: ${parts.join(', ')}`;
}

function renderProperties(result) {
  const properties = Array.isArray(result.properties) ? result.properties : [];
  docomatorFieldsState.properties = properties;
  const saved = docomatorFieldsState.settings || {};
  const suggested = result.suggestedMappings || {};
  const email = docomatorFieldsState.touched
    ? ($df('#docomator-email-field')?.value || null)
    : (saved.emailPropertyKey || suggested.emailPropertyKey || null);
  const position = docomatorFieldsState.touched
    ? ($df('#docomator-position-field')?.value || null)
    : (saved.positionPropertyKey || suggested.positionPropertyKey || null);
  const emailSelect = $df('#docomator-email-field');
  const positionSelect = $df('#docomator-position-field');
  if (emailSelect) emailSelect.innerHTML = optionMarkup(properties, email);
  if (positionSelect) positionSelect.innerHTML = optionMarkup(properties, position);
  const currentExtras = docomatorFieldsState.touched
    ? selectedMapping().extraPropertyKeys
    : (saved.extraPropertyKeys || []);
  renderExtras(properties, currentExtras);
  const status = $df('#docomator-fields-status');
  if (status) status.textContent = `${properties.length} полей сотрудников доступно в выбранном пространстве. ФИО переносится независимо от этих настроек.`;
  updateSummary();
}

async function loadSettings() {
  if (docomatorFieldsState.settingsLoadAttempted || !ensureUi()) return;
  docomatorFieldsState.settingsLoadAttempted = true;
  try {
    docomatorFieldsState.settings = await dfApi('/api/integrations/docomator');
    const mapping = docomatorFieldsState.settings;
    if ($df('#docomator-email-field')) $df('#docomator-email-field').value = mapping.emailPropertyKey || '';
    if ($df('#docomator-position-field')) $df('#docomator-position-field').value = mapping.positionPropertyKey || '';
    updateSummary();
  } catch (error) {
    const status = $df('#docomator-fields-status');
    if (status) status.textContent = error.message;
  }
}

async function discover({ force = false } = {}) {
  if (docomatorFieldsState.loading || !ensureUi()) return;
  const input = baseValues();
  if (!input.host || !input.spaceId) return;
  if (!force && docomatorFieldsState.loadedSpaceId === input.spaceId && docomatorFieldsState.properties.length) return;
  docomatorFieldsState.loading = true;
  const status = $df('#docomator-fields-status');
  if (status) status.textContent = 'Читаю описание полей сотрудников из Оформлятора…';
  try {
    const result = await dfApi('/api/integrations/docomator/fields/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    docomatorFieldsState.loadedSpaceId = input.spaceId;
    renderProperties(result);
  } catch (error) {
    if (status) status.textContent = error.message;
  } finally {
    docomatorFieldsState.loading = false;
  }
}

function persistMapping() {
  if (!docomatorFieldsState.settings) return Promise.resolve();
  const input = { ...baseValues(), ...selectedMapping() };
  delete input.accessCode;
  docomatorFieldsState.savePromise = dfApi('/api/integrations/docomator', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  }).then((settings) => {
    docomatorFieldsState.settings = settings;
    updateSummary();
  }).finally(() => {
    docomatorFieldsState.savePromise = null;
  });
  return docomatorFieldsState.savePromise;
}

function filterExtras(value) {
  const query = String(value || '').trim().toLocaleLowerCase('ru-RU');
  for (const row of document.querySelectorAll('.docomator-extra-field')) {
    row.classList.toggle('hidden', Boolean(query) && !String(row.dataset.search || '').includes(query));
  }
}

document.addEventListener('change', (event) => {
  if (event.target.id === 'docomator-space') {
    docomatorFieldsState.loadedSpaceId = null;
    docomatorFieldsState.properties = [];
    docomatorFieldsState.touched = false;
    setTimeout(() => discover({ force: true }), 50);
    return;
  }
  if (
    event.target.id === 'docomator-email-field'
    || event.target.id === 'docomator-position-field'
    || event.target.closest?.('#docomator-extra-fields')
  ) {
    docomatorFieldsState.touched = true;
    updateSummary();
    persistMapping().catch((error) => {
      const status = $df('#docomator-fields-status');
      if (status) status.textContent = error.message;
    });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'docomator-field-search') filterExtras(event.target.value);
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-docomator-fields-refresh]')) discover({ force: true });
}, false);

document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-docomator-import]');
  if (!button || docomatorFieldsState.importReplay) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    if (docomatorFieldsState.savePromise) await docomatorFieldsState.savePromise;
    else await persistMapping();
    docomatorFieldsState.importReplay = true;
    button.click();
  } finally {
    docomatorFieldsState.importReplay = false;
  }
}, true);

const observer = new MutationObserver(() => {
  if (!ensureUi()) return;
  if (!docomatorFieldsState.settings) loadSettings();
  const badge = $df('#docomator-connection-badge');
  if (badge?.dataset.state === 'ok' && $df('#docomator-space')?.value) discover();
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-state'] });

ensureUi();
loadSettings();
window.kafedraLoadDocomatorFields = () => discover({ force: true });
