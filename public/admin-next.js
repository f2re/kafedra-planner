const adminState = {
  accounts: [],
  sessions: [],
  people: [],
  readiness: null,
  loading: false
};
const adminSafe = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function ensureAdminStyles() {
  if (document.querySelector('#admin-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'admin-next-styles';
  link.rel = 'stylesheet';
  link.href = '/admin-next.css';
  document.head.append(link);
}

function ensureAdminUi() {
  ensureAdminStyles();
  if (!document.querySelector('#admin-access-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="admin-access-backdrop" class="admin-backdrop hidden"></div>
      <section id="admin-access-panel" class="admin-access-panel hidden"
        role="dialog" aria-modal="true" aria-labelledby="admin-access-title">
        <header class="admin-access-header">
          <div>
            <div class="eyebrow">Эксплуатация</div>
            <h2 id="admin-access-title">Доступ и готовность</h2>
          </div>
          <button type="button" class="admin-secondary" data-admin-close>Закрыть</button>
        </header>
        <div class="admin-access-body">
          <section>
            <h3>Готовность</h3>
            <div id="admin-readiness" class="admin-readiness-grid"></div>
          </section>
          <section class="admin-section">
            <h3>Создать аккаунт</h3>
            <form id="admin-account-create" class="admin-account-form">
              <label>Сотрудник<select name="personId" required></select></label>
              <label>Логин<input name="username" minlength="3" maxlength="80" required></label>
              <label>Роль<select name="role">
                <option value="staff">Сотрудник</option>
                <option value="manager">Руководитель</option>
                <option value="admin">Администратор</option>
              </select></label>
              <label>Временный пароль<input name="password" type="password"
                minlength="12" autocomplete="new-password" required></label>
              <button class="admin-primary" type="submit">Создать</button>
            </form>
          </section>
          <section class="admin-section">
            <h3>Аккаунты</h3>
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead><tr><th>Сотрудник</th><th>Логин</th><th>Роль</th>
                  <th>Состояние</th><th>Последний вход</th><th>Действия</th></tr></thead>
                <tbody id="admin-accounts-body"></tbody>
              </table>
            </div>
          </section>
          <section class="admin-section">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
              <h3>Активные сессии</h3>
              <button id="admin-revoke-all" class="admin-danger" type="button">
                Завершить все, кроме моей
              </button>
            </div>
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead><tr><th>Сотрудник</th><th>Устройство</th>
                  <th>Последняя активность</th><th>Истекает</th><th>Действие</th></tr></thead>
                <tbody id="admin-sessions-body"></tbody>
              </table>
            </div>
          </section>
          <p id="admin-access-status" class="admin-status" role="status"></p>
        </div>
      </section>
    `);
  }
}

async function adminApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  }
  return data;
}

function setStatus(message, error = false) {
  const node = document.querySelector('#admin-access-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = error ? '#a3222b' : '#4f5e74';
}

function roleTitle(role) {
  return role === 'admin'
    ? 'Администратор'
    : role === 'manager'
      ? 'Руководитель'
      : 'Сотрудник';
}

function renderReadiness() {
  const host = document.querySelector('#admin-readiness');
  const readiness = adminState.readiness;
  if (!host || !readiness) return;
  host.innerHTML = readiness.checks.map((check) => `
    <article class="admin-readiness-card" data-status="${adminSafe(check.status)}">
      <strong>${adminSafe(check.title)}</strong>
      <span>${adminSafe(check.detail)}</span>
    </article>
  `).join('');
}

function renderCreatePeople() {
  const select = document.querySelector('#admin-account-create select[name="personId"]');
  if (!select) return;
  const used = new Set(adminState.accounts.map((item) => item.personId));
  const available = adminState.people.filter((person) => !used.has(person.id));
  select.innerHTML = available.length
    ? available.map((person) =>
        `<option value="${adminSafe(person.id)}">${adminSafe(person.display_name)}</option>`
      ).join('')
    : '<option value="">Все сотрудники уже имеют аккаунты</option>';
  select.disabled = !available.length;
}

function renderAccounts() {
  const body = document.querySelector('#admin-accounts-body');
  if (!body) return;
  body.innerHTML = adminState.accounts.map((account) => `
    <tr data-account-id="${adminSafe(account.id)}">
      <td>${adminSafe(account.person?.displayName || '—')}</td>
      <td><strong>${adminSafe(account.username)}</strong></td>
      <td><select data-admin-role>
        ${['staff', 'manager', 'admin'].map((role) =>
          `<option value="${role}" ${account.role === role ? 'selected' : ''}>${roleTitle(role)}</option>`
        ).join('')}
      </select></td>
      <td><label><input data-admin-active type="checkbox" ${account.active ? 'checked' : ''}>
        ${account.active ? 'активен' : 'отключён'}</label></td>
      <td>${adminSafe(String(account.lastLoginAt || '—').replace('T', ' ').slice(0, 16))}</td>
      <td><div class="admin-table-actions">
        <button class="admin-secondary" type="button" data-admin-save>Сохранить</button>
        <button class="admin-secondary" type="button" data-admin-reset>Сбросить пароль</button>
        <button class="admin-danger" type="button" data-admin-revoke-account>Завершить сессии</button>
      </div></td>
    </tr>
  `).join('');
}

function renderSessions() {
  const body = document.querySelector('#admin-sessions-body');
  if (!body) return;
  body.innerHTML = adminState.sessions
    .filter((item) => item.active)
    .map((session) => `
      <tr data-session-id="${adminSafe(session.id)}">
        <td>${adminSafe(session.personName)}${session.current ? ' · текущая' : ''}</td>
        <td>${adminSafe(session.userAgent || 'не определено')}</td>
        <td>${adminSafe(String(session.lastSeenAt || '').replace('T', ' ').slice(0, 16))}</td>
        <td>${adminSafe(String(session.expiresAt || '').replace('T', ' ').slice(0, 16))}</td>
        <td>${session.current
          ? '<span>Текущая</span>'
          : '<button class="admin-danger" type="button" data-admin-revoke-session>Завершить</button>'
        }</td>
      </tr>
    `).join('');
}

async function loadAdminData() {
  if (adminState.loading) return;
  adminState.loading = true;
  setStatus('Обновление данных…');
  try {
    const [readiness, accounts, sessions, people] = await Promise.all([
      adminApi('/api/admin/readiness'),
      adminApi('/api/admin/accounts'),
      adminApi('/api/admin/sessions'),
      adminApi('/api/people')
    ]);
    adminState.readiness = readiness;
    adminState.accounts = accounts.items || [];
    adminState.sessions = sessions.items || [];
    adminState.people = people.items || [];
    renderReadiness();
    renderAccounts();
    renderSessions();
    renderCreatePeople();
    setStatus(
      readiness.status === 'ready'
        ? 'Готово к эксплуатации.'
        : readiness.status === 'ready_with_warnings'
          ? 'Система работает, но есть предупреждения конфигурации.'
          : 'Требуется устранить критические замечания.'
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    adminState.loading = false;
  }
}

function openAdminPanel() {
  ensureAdminUi();
  document.querySelector('#admin-access-panel').classList.remove('hidden');
  document.querySelector('#admin-access-backdrop').classList.remove('hidden');
  loadAdminData();
}

function closeAdminPanel() {
  document.querySelector('#admin-access-panel')?.classList.add('hidden');
  document.querySelector('#admin-access-backdrop')?.classList.add('hidden');
}

function ensureAdminMenu(payload) {
  if (payload?.role !== 'admin') return;
  const menu = document.querySelector('.auth-user-menu');
  if (!menu || menu.querySelector('[data-auth-action="admin"]')) return;
  menu.insertAdjacentHTML(
    'afterbegin',
    '<button type="button" data-auth-action="admin">Управление доступом</button>'
  );
}

window.addEventListener('kafedra-auth-changed', (event) => {
  ensureAdminMenu(event.detail);
});
window.kafedraAuthReady?.then(ensureAdminMenu);

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action === 'admin') openAdminPanel();
  if (event.target.closest('[data-admin-close]') || event.target.id === 'admin-access-backdrop') {
    closeAdminPanel();
  }

  const row = event.target.closest('[data-account-id]');
  if (row && event.target.closest('[data-admin-save]')) {
    try {
      await adminApi(`/api/admin/accounts/${encodeURIComponent(row.dataset.accountId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: row.querySelector('[data-admin-role]').value,
          active: row.querySelector('[data-admin-active]').checked
        })
      });
      await loadAdminData();
    } catch (error) { setStatus(error.message, true); }
  }
  if (row && event.target.closest('[data-admin-reset]')) {
    const password = window.prompt('Новый временный пароль: не менее 12 символов, буквы и цифры.');
    if (!password) return;
    try {
      await adminApi(
        `/api/admin/accounts/${encodeURIComponent(row.dataset.accountId)}/reset-password`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password, mustChangePassword: true })
        }
      );
      setStatus('Пароль сброшен, прежние сессии завершены.');
      await loadAdminData();
    } catch (error) { setStatus(error.message, true); }
  }
  if (row && event.target.closest('[data-admin-revoke-account]')) {
    try {
      const result = await adminApi(
        `/api/admin/accounts/${encodeURIComponent(row.dataset.accountId)}/revoke-sessions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        }
      );
      setStatus(`Завершено сессий: ${result.count}.`);
      await loadAdminData();
    } catch (error) { setStatus(error.message, true); }
  }

  const sessionRow = event.target.closest('[data-session-id]');
  if (sessionRow && event.target.closest('[data-admin-revoke-session]')) {
    try {
      await adminApi(
        `/api/admin/sessions/${encodeURIComponent(sessionRow.dataset.sessionId)}/revoke`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        }
      );
      await loadAdminData();
    } catch (error) { setStatus(error.message, true); }
  }

  if (event.target.id === 'admin-revoke-all') {
    if (!window.confirm('Завершить все активные сессии, кроме текущей?')) return;
    try {
      const result = await adminApi('/api/admin/sessions/revoke-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keepCurrent: true })
      });
      setStatus(`Завершено сессий: ${result.count}.`);
      await loadAdminData();
    } catch (error) { setStatus(error.message, true); }
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'admin-account-create') return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  try {
    await adminApi('/api/admin/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...values,
        mustChangePassword: true
      })
    });
    event.target.reset();
    setStatus('Аккаунт создан.');
    await loadAdminData();
  } catch (error) {
    setStatus(error.message, true);
  }
});
