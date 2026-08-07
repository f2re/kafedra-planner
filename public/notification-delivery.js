const deliveryState = { profile: null, diagnostics: null, loading: false, auth: null };

const deliverySafe = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

async function deliveryApi(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureDeliveryStyles() {
  if (document.querySelector('#notification-delivery-styles')) return;
  const link = document.createElement('link');
  link.id = 'notification-delivery-styles';
  link.rel = 'stylesheet';
  link.href = '/notification-delivery.css';
  document.head.append(link);
}

function ensureDeliveryUi() {
  ensureDeliveryStyles();
  if (document.querySelector('#notification-delivery-panel')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="notification-delivery-backdrop" class="delivery-backdrop hidden"></div>
    <section id="notification-delivery-panel" class="delivery-panel hidden" role="dialog" aria-modal="true" aria-labelledby="notification-delivery-title">
      <header class="delivery-head">
        <div><div class="eyebrow">Уведомления</div><h2 id="notification-delivery-title">Как связаться со мной</h2></div>
        <button type="button" class="delivery-button secondary" data-delivery-close>Закрыть</button>
      </header>
      <form id="notification-delivery-form" class="delivery-body">
        <section class="delivery-section">
          <h3>Каналы</h3>
          <p class="delivery-helper">Внутренние уведомления работают всегда. Внешние каналы нужны только если важно получить сообщение вне открытой системы.</p>
          <div id="delivery-availability" class="delivery-availability"></div>
          <label class="delivery-switch"><input type="checkbox" name="smtpEnabled"><span><strong>Электронная почта</strong><small>Отправка через локальный или настроенный SMTP-сервер.</small></span></label>
          <label class="delivery-field"><span>Адрес</span><input name="emailAddress" type="email" autocomplete="email" placeholder="name@example.ru"></label>
          <label class="delivery-switch"><input type="checkbox" name="telegramEnabled"><span><strong>Telegram</strong><small>Необязательный канал. Токен бота хранится только в конфигурации сервера.</small></span></label>
          <label class="delivery-field"><span>ID чата</span><input name="telegramChatId" inputmode="numeric" autocomplete="off" placeholder="123456789"></label>
        </section>

        <section class="delivery-section">
          <h3>Когда сообщать</h3>
          <label class="delivery-switch"><input type="checkbox" name="immediateEnabled"><span><strong>Сразу о существенном</strong><small>Сроки и риски сотруднику; руководителю — только проверка и риск срыва.</small></span></label>
          <div class="delivery-grid">
            <label class="delivery-switch"><input type="checkbox" name="dailyDigestEnabled"><span><strong>Ежедневная сводка</strong></span></label>
            <label class="delivery-field"><span>Время</span><input name="dailyDigestTime" type="time"></label>
            <label class="delivery-switch"><input type="checkbox" name="weeklyDigestEnabled"><span><strong>Еженедельная сводка</strong></span></label>
            <label class="delivery-field"><span>День</span><select name="weeklyDigestDay"><option value="1">Понедельник</option><option value="2">Вторник</option><option value="3">Среда</option><option value="4">Четверг</option><option value="5">Пятница</option><option value="6">Суббота</option><option value="7">Воскресенье</option></select></label>
            <div></div><label class="delivery-field"><span>Время</span><input name="weeklyDigestTime" type="time"></label>
          </div>
        </section>

        <section class="delivery-section">
          <h3>Тихие часы</h3>
          <label class="delivery-switch"><input type="checkbox" name="quietHoursEnabled"><span><strong>Не беспокоить ночью</strong><small>Сообщение останется в очереди и будет отправлено после окончания тихих часов.</small></span></label>
          <div class="delivery-grid"><label class="delivery-field"><span>С</span><input name="quietStart" type="time"></label><label class="delivery-field"><span>До</span><input name="quietEnd" type="time"></label></div>
          <label class="delivery-field"><span>Часовой пояс</span><input name="timezone" autocomplete="off" placeholder="Europe/Moscow"></label>
        </section>

        <section id="delivery-admin-section" class="delivery-section hidden">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><h3>Диагностика доставки</h3><button type="button" class="delivery-button secondary" data-delivery-refresh-admin>Обновить</button></div>
          <div id="delivery-admin-summary" class="delivery-admin-summary"></div>
          <div id="delivery-admin-failed" class="delivery-failed"></div>
        </section>

        <p id="notification-delivery-status" class="delivery-status" role="status"></p>
        <div class="delivery-actions"><button type="button" class="delivery-button secondary" data-delivery-close>Отмена</button><button type="submit" class="delivery-button primary">Сохранить</button></div>
      </form>
    </section>
  `);
}

function ensureDeliveryMenu(payload) {
  deliveryState.auth = payload;
  if (!payload?.authenticated || !payload?.user) return;
  const menu = document.querySelector('.auth-user-menu');
  if (!menu || menu.querySelector('[data-auth-action="delivery"]')) return;
  const logout = menu.querySelector('[data-auth-action="logout"]');
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.authAction = 'delivery';
  button.textContent = 'Доставка уведомлений';
  menu.insertBefore(button, logout || null);
}

function setDeliveryStatus(message, error = false) {
  const node = document.querySelector('#notification-delivery-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = error ? '#a3222b' : '';
}

function setValue(form, name, value) {
  const field = form.elements.namedItem(name);
  if (!field) return;
  if (field.type === 'checkbox') field.checked = Boolean(value);
  else field.value = value ?? '';
}

function renderProfile(data) {
  deliveryState.profile = data.profile;
  const profile = data.profile;
  const form = document.querySelector('#notification-delivery-form');
  if (!form || !profile) return;
  for (const name of ['smtpEnabled','telegramEnabled','immediateEnabled','dailyDigestEnabled','weeklyDigestEnabled','quietHoursEnabled']) setValue(form, name, profile[name]);
  for (const name of ['emailAddress','telegramChatId','dailyDigestTime','weeklyDigestDay','weeklyDigestTime','quietStart','quietEnd','timezone']) setValue(form, name, profile[name]);
  const availability = document.querySelector('#delivery-availability');
  availability.innerHTML = [
    `<span class="delivery-pill ${profile.availability.smtp ? 'ok' : 'warn'}">Почта: ${profile.availability.smtp ? 'сервер готов' : 'сервер не настроен'}</span>`,
    `<span class="delivery-pill ${profile.availability.telegram ? 'ok' : 'warn'}">Telegram: ${profile.availability.telegram ? 'сервер готов' : 'не настроен'}</span>`,
    `<span class="delivery-pill ${data.deliveryEnabled ? 'ok' : 'warn'}">Доставка: ${data.deliveryEnabled ? 'включена' : 'выключена администратором'}</span>`
  ].join('');
}

function renderDiagnostics(data) {
  deliveryState.diagnostics = data;
  const host = document.querySelector('#delivery-admin-summary');
  const failed = document.querySelector('#delivery-admin-failed');
  if (!host || !failed) return;
  const counts = data.counts || {};
  host.innerHTML = [
    ['В очереди', counts.created || 0], ['Отправлено', counts.sent || 0],
    ['Доставлено', counts.delivered || 0], ['Подтверждено', counts.confirmed || 0],
    ['Ошибки', counts.error || 0], ['Профили', data.enabledProfiles || 0]
  ].map(([label, count]) => `<div class="delivery-stat"><strong>${deliverySafe(count)}</strong><span>${deliverySafe(label)}</span></div>`).join('');
  failed.innerHTML = (data.failed || []).length
    ? `<p class="delivery-helper">Последние ошибки можно повторить вручную после устранения причины.</p>${data.failed.map((item) => `<div class="delivery-failed-row" data-delivery-id="${deliverySafe(item.id)}"><div><strong>${deliverySafe(item.title)} · ${deliverySafe(item.channel)}</strong><small>${deliverySafe(item.destination)} · попыток ${deliverySafe(item.attempt_count)} · ${deliverySafe(item.last_error || 'ошибка канала')}</small></div><button type="button" class="delivery-button danger" data-delivery-retry>Повторить</button></div>`).join('')}`
    : '<p class="delivery-helper">Ошибок доставки нет.</p>';
}

async function loadDiagnostics() {
  if (deliveryState.auth?.role !== 'admin') return;
  const data = await deliveryApi('/api/admin/notification-delivery');
  renderDiagnostics(data);
}

async function openDeliveryPanel() {
  ensureDeliveryUi();
  document.querySelector('#notification-delivery-panel').classList.remove('hidden');
  document.querySelector('#notification-delivery-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setDeliveryStatus('Загрузка…');
  try {
    const data = await deliveryApi('/api/notification-delivery/profile');
    renderProfile(data);
    const adminSection = document.querySelector('#delivery-admin-section');
    adminSection.classList.toggle('hidden', deliveryState.auth?.role !== 'admin');
    if (deliveryState.auth?.role === 'admin') await loadDiagnostics();
    setDeliveryStatus('');
  } catch (error) {
    setDeliveryStatus(error.message, true);
  }
}

function closeDeliveryPanel() {
  document.querySelector('#notification-delivery-panel')?.classList.add('hidden');
  document.querySelector('#notification-delivery-backdrop')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function profileFromForm(form) {
  const values = Object.fromEntries(new FormData(form));
  const checked = (name) => form.elements.namedItem(name)?.checked === true;
  return {
    smtpEnabled: checked('smtpEnabled'), emailAddress: values.emailAddress || '',
    telegramEnabled: checked('telegramEnabled'), telegramChatId: values.telegramChatId || '',
    immediateEnabled: checked('immediateEnabled'),
    dailyDigestEnabled: checked('dailyDigestEnabled'), dailyDigestTime: values.dailyDigestTime || '08:00',
    weeklyDigestEnabled: checked('weeklyDigestEnabled'), weeklyDigestDay: Number(values.weeklyDigestDay || 1), weeklyDigestTime: values.weeklyDigestTime || '08:00',
    quietHoursEnabled: checked('quietHoursEnabled'), quietStart: values.quietStart || '22:00', quietEnd: values.quietEnd || '07:00',
    timezone: values.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
  };
}

window.addEventListener('kafedra-auth-changed', (event) => ensureDeliveryMenu(event.detail));
window.kafedraAuthReady?.then(ensureDeliveryMenu);

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action === 'delivery') {
    event.preventDefault();
    openDeliveryPanel();
  }
  if (event.target.closest('[data-delivery-close]') || event.target.id === 'notification-delivery-backdrop') closeDeliveryPanel();
  if (event.target.closest('[data-delivery-refresh-admin]')) {
    try { await loadDiagnostics(); setDeliveryStatus('Диагностика обновлена.'); }
    catch (error) { setDeliveryStatus(error.message, true); }
  }
  const retry = event.target.closest('[data-delivery-retry]');
  if (retry) {
    const id = retry.closest('[data-delivery-id]')?.dataset.deliveryId;
    if (!id) return;
    retry.disabled = true;
    try {
      await deliveryApi(`/api/admin/notification-delivery/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setDeliveryStatus('Повторная отправка поставлена в очередь.');
      await loadDiagnostics();
    } catch (error) { setDeliveryStatus(error.message, true); }
    finally { retry.disabled = false; }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('#notification-delivery-panel')?.classList.contains('hidden')) closeDeliveryPanel();
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'notification-delivery-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  setDeliveryStatus('Сохранение…');
  try {
    const data = await deliveryApi('/api/notification-delivery/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profileFromForm(event.target))
    });
    renderProfile(data);
    setDeliveryStatus('Настройки сохранены. Внутренние уведомления продолжают работать независимо от внешних каналов.');
  } catch (error) {
    setDeliveryStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

ensureDeliveryUi();
