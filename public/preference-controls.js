const $p = (selector, root = document) => root.querySelector(selector);

const labels = {
  'calendar.mode': 'Вид календаря',
  'calendar.new.kind': 'Тип новой записи',
  'calendar.new.category': 'Категория записи',
  'calendar.new.importance': 'Важность',
  'calendar.new.reminder': 'Напоминание',
  'template.document.type': 'Тип документа шаблона',
  'template.field.type': 'Тип поля шаблона',
  'template.field.strategy': 'Способ извлечения поля',
  'meeting.new.date_offset': 'Дата нового заседания',
  'work.periodic.period_kind': 'Период регулярной задачи',
  'work.periodic.direction': 'Направление регулярной задачи',
  'plans.filter.kind': 'Вид плана',
  'plans.filter.period': 'Период плана',
  'plans.filter.direction': 'Направление плана',
  'plan.item.direction': 'Направление пункта плана',
  'search.filter.source_kind': 'Тип поиска',
  'search.filter.direction': 'Направление поиска',
  'search.filter.role': 'Роль в поиске',
  'search.filter.status': 'Состояние в поиске',
  'search.filter.report': 'Наличие отчёта',
  'science.filter.kind': 'Вид научного материала',
  'planfact.scope': 'Область План / факт',
  'planfact.filter.direction': 'Направление План / факт',
  'planfact.filter.status': 'Состояние План / факт',
  'planfact.filter.period_kind': 'Период План / факт'
};

let controls = null;
let loading = false;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function request(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.code = data?.error?.code || null;
    throw error;
  }
  return data;
}

function ensureUi() {
  if ($p('#preference-controls-button')) return;
  const anchor = $p('#notification-button') || $p('#open-search') || $p('#create-button');
  if (!anchor) return;
  anchor.insertAdjacentHTML('beforebegin', `
    <div class="preference-controls-anchor">
      <button id="preference-controls-button" class="icon-button" type="button" aria-haspopup="dialog" aria-expanded="false" title="Личные подсказки">Подсказки</button>
      <section id="preference-controls-popover" class="preference-controls-popover hidden" role="dialog" aria-label="Личные подсказки">
        <div class="preference-controls-head"><div><strong>Подсказки</strong><span>Только безопасные личные defaults</span></div><button type="button" class="icon-button" data-pref-close aria-label="Закрыть">×</button></div>
        <div id="preference-controls-body" class="preference-controls-body"><span>Загрузка…</span></div>
      </section>
    </div>`);
  if (!$p('#preference-controls-styles')) {
    const style = document.createElement('style');
    style.id = 'preference-controls-styles';
    style.textContent = `
      .preference-controls-anchor{position:relative;display:inline-flex}.preference-controls-popover{position:absolute;z-index:80;right:0;top:calc(100% + 8px);width:min(390px,calc(100vw - 24px));max-height:min(70vh,620px);overflow:auto;padding:14px;border:1px solid var(--border,#d2d2d7);border-radius:16px;background:var(--surface,#fff);box-shadow:0 14px 44px rgba(0,0,0,.14)}.preference-controls-popover.hidden{display:none}.preference-controls-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.preference-controls-head>div{display:grid;gap:3px}.preference-controls-head span,.preference-controls-note{font-size:12px;color:var(--muted,#6e6e73)}.preference-controls-body{display:grid;gap:12px;margin-top:12px}.preference-learning-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--border,#e5e7eb);border-bottom:1px solid var(--border,#e5e7eb)}.preference-learning-row input{margin-top:3px}.preference-pin-list{display:grid;gap:8px}.preference-pin-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:end}.preference-pin-row label{display:grid;gap:4px;min-width:0}.preference-pin-row label span{font-size:12px;color:var(--muted,#6e6e73)}.preference-pin-row select{min-width:0;width:100%;min-height:36px;border:1px solid var(--border,#d2d2d7);border-radius:9px;background:var(--surface,#fff);padding:0 8px}.preference-controls-actions{display:flex;justify-content:space-between;gap:8px;padding-top:4px}.preference-controls-status{font-size:12px;color:var(--muted,#6e6e73)}@media(max-width:720px){.preference-controls-popover{position:fixed;top:72px;right:12px;left:12px;width:auto}.preference-pin-row{grid-template-columns:1fr}.preference-pin-row button{width:100%}}
    `;
    document.head.append(style);
  }
}

function rankedCandidates(key, pinnedValue = null) {
  const ranking = window.kafedraUiPreferences?.ranking?.(key);
  const values = ranking instanceof Map
    ? [...ranking.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => String(value))
    : [];
  if (pinnedValue && !values.includes(String(pinnedValue))) values.unshift(String(pinnedValue));
  return [...new Set(values)].slice(0, 5);
}

function pinRows() {
  const safeKeys = controls?.safePinKeys || [];
  const rows = [];
  for (const key of safeKeys) {
    const pinned = controls?.pinned?.[key] || null;
    const values = rankedCandidates(key, pinned);
    if (!values.length) continue;
    rows.push({ key, pinned, values });
  }
  return rows;
}

function render() {
  const body = $p('#preference-controls-body');
  if (!body) return;
  if (!controls) {
    body.innerHTML = '<span class="preference-controls-note">Персональные настройки доступны после входа.</span>';
    return;
  }
  const rows = pinRows();
  body.innerHTML = `
    <label class="preference-learning-row">
      <input type="checkbox" data-pref-learning ${controls.learningEnabled ? 'checked' : ''}>
      <span><strong>Учитывать мои частые выборы</strong><br><span class="preference-controls-note">Явные настройки и правила предметной области работают независимо.</span></span>
    </label>
    <div><strong>Закреплённые defaults</strong><div class="preference-controls-note">Можно закрепить только безопасное значение, которое вы уже выбирали сами.</div></div>
    <div class="preference-pin-list">
      ${rows.length ? rows.map(({ key, pinned, values }) => `
        <div class="preference-pin-row" data-pref-pin-row="${esc(key)}">
          <label><span>${esc(labels[key] || key)}</span><select data-pref-pin-value>${values.map((value) => `<option value="${esc(value)}" ${String(pinned || '') === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>
          <button type="button" class="secondary-button" data-pref-pin="${esc(key)}">${pinned ? 'Снять' : 'Закрепить'}</button>
        </div>`).join('') : '<span class="preference-controls-note">Пока нет безопасных повторяющихся выборов для закрепления.</span>'}
    </div>
    <div class="preference-controls-actions"><button type="button" class="secondary-button" data-pref-reset>Сбросить подсказки</button><span id="preference-controls-status" class="preference-controls-status"></span></div>
  `;
}

function setStatus(text) {
  const target = $p('#preference-controls-status');
  if (target) target.textContent = text;
}

async function loadControls() {
  if (loading) return;
  loading = true;
  try {
    const data = await request('/api/ui-preferences/controls');
    controls = data.controls || null;
  } catch (error) {
    controls = null;
    const body = $p('#preference-controls-body');
    if (body) body.innerHTML = `<span class="preference-controls-note">${esc(error.message)}</span>`;
    return;
  } finally {
    loading = false;
  }
  render();
}

function open() {
  ensureUi();
  const popover = $p('#preference-controls-popover');
  if (!popover) return;
  popover.classList.remove('hidden');
  $p('#preference-controls-button')?.setAttribute('aria-expanded', 'true');
  loadControls();
}

function close() {
  $p('#preference-controls-popover')?.classList.add('hidden');
  $p('#preference-controls-button')?.setAttribute('aria-expanded', 'false');
}

async function saveAndReload(payload) {
  setStatus('Сохраняется…');
  await request('/api/ui-preferences/controls', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  window.location.reload();
}

ensureUi();

document.addEventListener('click', (event) => {
  if (event.target.closest('#preference-controls-button')) {
    const hidden = $p('#preference-controls-popover')?.classList.contains('hidden');
    if (hidden) open(); else close();
    return;
  }
  if (event.target.closest('[data-pref-close]')) return close();
  if (!event.target.closest('.preference-controls-anchor')) close();

  const reset = event.target.closest('[data-pref-reset]');
  if (reset) {
    setStatus('Сбрасываются только обученные подсказки…');
    request('/api/ui-preferences/reset', { method: 'POST' })
      .then(() => window.location.reload())
      .catch((error) => setStatus(error.message));
    return;
  }
  const pin = event.target.closest('[data-pref-pin]');
  if (pin) {
    const key = pin.dataset.prefPin;
    const row = pin.closest('[data-pref-pin-row]');
    const current = controls?.pinned?.[key] || null;
    const value = current ? null : row?.querySelector('[data-pref-pin-value]')?.value;
    saveAndReload({ pin: { key, value } }).catch((error) => setStatus(error.message));
  }
});

document.addEventListener('change', (event) => {
  const learning = event.target.closest('[data-pref-learning]');
  if (!learning) return;
  saveAndReload({ learningEnabled: learning.checked }).catch((error) => setStatus(error.message));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$p('#preference-controls-popover')?.classList.contains('hidden')) {
    event.preventDefault();
    close();
    $p('#preference-controls-button')?.focus();
  }
});
