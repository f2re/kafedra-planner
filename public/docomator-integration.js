const docomatorState = {
  settings: null,
  check: null,
  initialized: false,
  settingsLoadAttempted: false,
  loadingSettings: false,
  busy: false,
  autoChecked: false
};

const $d = (selector, root = document) => root.querySelector(selector);

function escDocomator(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function docomatorApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureDocomatorStyles() {
  if ($d('#docomator-integration-styles')) return;
  const link = document.createElement('link');
  link.id = 'docomator-integration-styles';
  link.rel = 'stylesheet';
  link.href = '/docomator-integration.css';
  document.head.append(link);
}

function organizationHost() {
  return $d('#organization-admin');
}

function ensureDocomatorUi() {
  ensureDocomatorStyles();
  const host = organizationHost();
  if (!host) return false;
  if ($d('#docomator-integration', host)) return true;
  const anchor = $d('.organization-head', host);
  const html = `
    <section id="docomator-integration" class="docomator-integration">
      <header class="docomator-head">
        <div>
          <span class="eyebrow">Источник сотрудников</span>
          <h3>Импорт из Оформлятора</h3>
          <p>Подключитесь к Оформлятору по сети, проверьте доступность и перенесите сотрудников в справочник кафедры.</p>
        </div>
        <span id="docomator-connection-badge" class="docomator-badge" data-state="unknown">Не проверено</span>
      </header>
      <form id="docomator-settings-form" class="docomator-form">
        <div class="docomator-address-grid">
          <label class="field"><span>Протокол</span><select name="scheme"><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          <label class="field docomator-host-field"><span>Адрес</span><input name="host" inputmode="url" autocomplete="off" placeholder="192.168.1.50 или docomator.local"></label>
          <label class="field"><span>Порт</span><input name="port" type="number" min="1" max="65535" value="8080"></label>
          <label class="field"><span>Код доступа</span><input name="accessCode" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="если включён"></label>
        </div>
        <p class="docomator-secret-note">Код доступа используется только для текущей проверки или импорта и не сохраняется.</p>
        <div class="docomator-actions">
          <button class="secondary-button" type="submit" data-docomator-check>Проверить соединение</button>
          <span id="docomator-endpoint"></span>
        </div>
      </form>
      <div id="docomator-status" class="docomator-status hidden" role="status"></div>
      <div id="docomator-source" class="docomator-source hidden">
        <div class="docomator-source-grid">
          <label class="field"><span>Пространство</span><select id="docomator-space"></select></label>
          <label class="field"><span>Группа</span><select id="docomator-group"><option value="">Все сотрудники пространства</option></select></label>
          <label class="docomator-checkbox"><input id="docomator-include-inactive" type="checkbox"><span>Включить неактивных</span></label>
        </div>
        <div class="docomator-info-row">
          <div><strong id="docomator-people-count">—</strong><span>сотрудников найдено</span></div>
          <div id="docomator-last-import" class="docomator-last-import"></div>
          <button class="primary-button" type="button" data-docomator-import disabled>Импортировать сотрудников</button>
        </div>
        <div id="docomator-preview" class="docomator-preview"></div>
      </div>
    </section>`;
  if (anchor) anchor.insertAdjacentHTML('afterend', html);
  else host.insertAdjacentHTML('afterbegin', html);
  docomatorState.initialized = true;
  return true;
}

function authGateVisible() {
  return Boolean($d('#auth-gate') && !$d('#auth-gate')?.classList.contains('hidden'));
}

function setBusy(busy) {
  docomatorState.busy = busy;
  for (const button of document.querySelectorAll('[data-docomator-check], [data-docomator-import]')) {
    button.disabled = busy || (button.hasAttribute('data-docomator-import') && !canImport());
  }
}

function setBadge(text, state = 'unknown') {
  const badge = $d('#docomator-connection-badge');
  if (!badge) return;
  badge.textContent = text;
  badge.dataset.state = state;
}

function setStatus(message = '', kind = 'info') {
  const status = $d('#docomator-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
  status.classList.toggle('hidden', !message);
}

function formValues() {
  const form = $d('#docomator-settings-form');
  const saved = docomatorState.settings || {};
  return {
    scheme: form?.elements.scheme?.value || saved.scheme || 'http',
    host: form?.elements.host?.value?.trim() || saved.host || '',
    port: Number(form?.elements.port?.value || saved.port || 8080),
    accessCode: form?.elements.accessCode?.value?.trim() || undefined,
    spaceId: $d('#docomator-space')?.value || saved.spaceId || null,
    groupId: $d('#docomator-group')?.value || null,
    includeInactive: Boolean($d('#docomator-include-inactive')?.checked)
  };
}

function applySettings(settings) {
  docomatorState.settings = settings;
  const form = $d('#docomator-settings-form');
  if (!form) return;
  form.elements.scheme.value = settings.scheme || 'http';
  form.elements.host.value = settings.host || '';
  form.elements.port.value = String(settings.port || 8080);
  $d('#docomator-include-inactive').checked = Boolean(settings.includeInactive);
  if (settings.lastImportedAt) {
    const date = new Date(settings.lastImportedAt);
    $d('#docomator-last-import').textContent = Number.isNaN(date.getTime())
      ? `Последний импорт: ${settings.lastImportedAt}`
      : `Последний импорт: ${date.toLocaleString('ru-RU')}`;
  } else {
    $d('#docomator-last-import').textContent = 'Импорт ещё не выполнялся';
  }
  if (settings.host) $d('#docomator-endpoint').textContent = `${settings.scheme}://${settings.host}:${settings.port}`;
}

function optionRows(items, selected, emptyLabel = null) {
  const empty = emptyLabel === null ? '' : `<option value="">${escDocomator(emptyLabel)}</option>`;
  return `${empty}${(items || []).map((item) => `
    <option value="${escDocomator(item.id)}" ${String(item.id) === String(selected || '') ? 'selected' : ''}>${escDocomator(item.name || item.displayName || item.id)}</option>
  `).join('')}`;
}

function canImport() {
  return Boolean(
    docomatorState.check?.dataAvailable
    && !docomatorState.check?.authRequired
    && $d('#docomator-space')?.value
  );
}

function renderCheck(result, requested = {}) {
  docomatorState.check = result;
  const source = $d('#docomator-source');
  const space = $d('#docomator-space');
  const group = $d('#docomator-group');
  if (result.endpoint) $d('#docomator-endpoint').textContent = result.endpoint;

  if (!result.reachable) {
    setBadge('Недоступен', 'error');
    source?.classList.add('hidden');
    return;
  }
  if (result.authRequired) {
    setBadge('Доступен · нужен код', 'warning');
    setStatus(`Оформлятор отвечает${result.remoteVersion ? `, версия ${result.remoteVersion}` : ''}. Для чтения списка сотрудников введите 4-значный код доступа и повторите проверку.`, 'warning');
    source?.classList.add('hidden');
    return;
  }

  setBadge(result.ready ? 'Доступен' : 'Запущен · не готов', result.ready ? 'ok' : 'warning');
  setStatus(result.ready
    ? `Соединение установлено${result.remoteVersion ? ` · Оформлятор ${result.remoteVersion}` : ''}. Данные сотрудников доступны.`
    : 'Сервер отвечает, но база Оформлятора ещё не готова к чтению.', result.ready ? 'success' : 'warning');

  source?.classList.remove('hidden');
  const selectedSpace = requested.spaceId || docomatorState.settings?.spaceId || '';
  if (space) {
    space.innerHTML = optionRows(result.spaces || [], selectedSpace, 'Выберите пространство');
    if (!space.value && (result.spaces || []).length === 1) space.value = String(result.spaces[0].id);
  }
  const selectedGroup = requested.groupId ?? docomatorState.settings?.groupId ?? '';
  if (group) group.innerHTML = optionRows(result.groups || [], selectedGroup, 'Все сотрудники пространства');

  $d('#docomator-people-count').textContent = result.peopleCount === null || result.peopleCount === undefined ? '—' : String(result.peopleCount);
  const preview = $d('#docomator-preview');
  if (preview) {
    preview.innerHTML = (result.peoplePreview || []).length
      ? `<div class="docomator-preview-list">${result.peoplePreview.map((person) => `<span>${escDocomator(person.displayName)}</span>`).join('')}</div>`
      : (space?.value ? '<span class="docomator-empty">В выбранном источнике сотрудники не найдены.</span>' : '<span class="docomator-empty">Выберите пространство, чтобы увидеть сотрудников.</span>');
  }
  const importButton = $d('[data-docomator-import]');
  if (importButton) importButton.disabled = docomatorState.busy || !canImport();
}

async function loadSettings() {
  if (
    docomatorState.settingsLoadAttempted
    || docomatorState.loadingSettings
    || authGateVisible()
    || !ensureDocomatorUi()
  ) return;
  docomatorState.settingsLoadAttempted = true;
  docomatorState.loadingSettings = true;
  try {
    const settings = await docomatorApi('/api/integrations/docomator');
    applySettings(settings);
    if (settings.host && !docomatorState.autoChecked) {
      docomatorState.autoChecked = true;
      await checkConnection({ silent: true });
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    docomatorState.loadingSettings = false;
  }
}

async function checkConnection({ silent = false, resetGroup = false } = {}) {
  if (docomatorState.busy || !ensureDocomatorUi()) return;
  const values = formValues();
  if (resetGroup) values.groupId = null;
  if (!values.host) {
    if (!silent) setStatus('Укажите адрес сервера Оформлятора.', 'error');
    return;
  }
  setBusy(true);
  if (!silent) setStatus('Проверяю Оформлятор и доступность сотрудников…');
  try {
    const result = await docomatorApi('/api/integrations/docomator/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    if (result.settings) applySettings(result.settings);
    renderCheck(result, values);
    const selectedNow = $d('#docomator-space')?.value;
    if (selectedNow && !values.spaceId && (result.spaces || []).length === 1) {
      setBusy(false);
      return checkConnection({ silent: true });
    }
  } catch (error) {
    docomatorState.check = null;
    setBadge('Ошибка', 'error');
    setStatus(error.message, 'error');
    $d('#docomator-source')?.classList.add('hidden');
  } finally {
    setBusy(false);
  }
}

async function importPeople() {
  if (docomatorState.busy || !canImport()) return;
  const values = formValues();
  setBusy(true);
  setStatus('Импортирую сотрудников. Существующие ФИО будут сопоставлены без создания дублей…');
  try {
    const result = await docomatorApi('/api/integrations/docomator/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    if (result.settings) applySettings(result.settings);
    const stats = result.stats || {};
    setStatus(`Импорт завершён: ${Number(stats.total || 0)} записей · новых ${Number(stats.created || 0)} · обновлено ${Number(stats.updated || 0)} · сопоставлено ${Number(stats.matched || 0)}.`, 'success');
    await window.kafedraLoadOrganization?.();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'docomator-settings-form') return;
  event.preventDefault();
  checkConnection();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-docomator-import]')) importPeople();
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'docomator-space') {
    const group = $d('#docomator-group');
    if (group) group.value = '';
    checkConnection({ silent: true, resetGroup: true });
  }
  if (event.target.id === 'docomator-group' || event.target.id === 'docomator-include-inactive') {
    checkConnection({ silent: true });
  }
});

new MutationObserver(() => {
  if (!authGateVisible() && ensureDocomatorUi() && !docomatorState.settings) loadSettings();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

ensureDocomatorUi();
loadSettings();
window.kafedraCheckDocomator = checkConnection;
