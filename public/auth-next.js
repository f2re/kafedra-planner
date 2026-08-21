const authBaseFetch = window.fetch.bind(window);
const authState = {
  ready: false,
  payload: null,
  showingLogin: false
};
const authSafe = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function ensureAuthStyles() {
  if (document.querySelector('#auth-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'auth-next-styles';
  link.rel = 'stylesheet';
  link.href = '/auth-next.css';
  document.head.append(link);
}

function ensureAuthGate() {
  let gate = document.querySelector('#auth-gate');
  if (gate) return gate;
  gate = document.createElement('div');
  gate.id = 'auth-gate';
  gate.className = 'auth-gate hidden';
  document.body.append(gate);
  return gate;
}

function pinInput(name, autocomplete = 'off') {
  return `<input class="auth-pin-input" name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" autocomplete="${autocomplete}" aria-label="PIN-код из четырёх цифр" required>`;
}

function renderAuthGate(payload, message = '') {
  const gate = ensureAuthGate();
  const mode = payload?.authMode || 'accounts';
  if (mode === 'pin' && !payload?.pinConfigured) {
    gate.innerHTML = `<section class="auth-card" aria-labelledby="auth-title">
      <div class="auth-lock-mark" aria-hidden="true">••••</div>
      <h1 id="auth-title">Задайте PIN-код</h1>
      <p>Четыре цифры — это локальная защита от случайного доступа. Логин и пароль не нужны.</p>
      <form id="auth-pin-setup-form" class="auth-form">
        <label>PIN-код${pinInput('pin', 'new-password')}</label>
        <label>Повторите PIN-код${pinInput('pinConfirm', 'new-password')}</label>
        <p id="auth-login-error" class="auth-error" role="alert">${authSafe(message)}</p>
        <button type="submit">Сохранить и открыть</button>
      </form>
    </section>`;
  } else if (mode === 'pin') {
    gate.innerHTML = `<section class="auth-card auth-card-pin" aria-labelledby="auth-title">
      <div class="auth-lock-mark" aria-hidden="true">••••</div>
      <h1 id="auth-title">Введите PIN-код</h1>
      <p>Введите четыре цифры, заданные при первом запуске.</p>
      <form id="auth-pin-login-form" class="auth-form">
        <label class="auth-pin-label">PIN-код${pinInput('pin', 'off')}</label>
        <p id="auth-login-error" class="auth-error" role="alert">${authSafe(message)}</p>
        <button type="submit">Открыть</button>
      </form>
    </section>`;
  } else {
    gate.innerHTML = `<section class="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">Вход в систему</h1>
      <p>Используйте локальный аккаунт сотрудника. Пароль и документы не передаются во внешние сервисы.</p>
      <form id="auth-login-form" class="auth-form">
        <label>Имя пользователя<input name="username" autocomplete="username" required></label>
        <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
        <p id="auth-login-error" class="auth-error" role="alert">${authSafe(message)}</p>
        <button type="submit">Войти</button>
      </form>
    </section>`;
  }
  return gate;
}

function showLogin(message = '', payload = authState.payload) {
  const gate = renderAuthGate(payload || { authMode: 'pin', pinConfigured: true }, message);
  gate.classList.remove('hidden');
  authState.showingLogin = true;
  setTimeout(() => gate.querySelector('input')?.focus(), 0);
}

function hideLogin() {
  ensureAuthGate().classList.add('hidden');
  authState.showingLogin = false;
}

function requestWithCsrf(input, init = {}) {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin
  );
  const method = String(
    init.method || (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  if (
    url.origin !== window.location.origin
    || ['GET', 'HEAD', 'OPTIONS'].includes(method)
    || url.pathname === '/api/auth/login'
    || url.pathname === '/api/auth/setup-pin'
    || !authState.payload?.csrfToken
  ) return init;
  const headers = new Headers(
    init.headers || (input instanceof Request ? input.headers : undefined)
  );
  if (!headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', authState.payload.csrfToken);
  }
  return { ...init, headers };
}

async function authJson(path, options = {}) {
  const response = await authBaseFetch(path, requestWithCsrf(path, options));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.code = data?.error?.code || '';
    error.status = response.status;
    throw error;
  }
  return data;
}

function ensurePinDialog() {
  let dialog = document.querySelector('#auth-pin-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'auth-pin-dialog';
  dialog.className = 'auth-pin-dialog';
  dialog.innerHTML = `<form id="auth-pin-change-form" method="dialog" class="auth-form">
    <div class="auth-dialog-header">
      <div><strong>Сменить PIN-код</strong><p>Введите текущий и новый PIN из четырёх цифр.</p></div>
      <button class="auth-dialog-close" type="button" data-auth-pin-close aria-label="Закрыть">×</button>
    </div>
    <label>Текущий PIN-код${pinInput('currentPin')}</label>
    <label>Новый PIN-код${pinInput('newPin', 'new-password')}</label>
    <label>Повторите новый PIN${pinInput('newPinConfirm', 'new-password')}</label>
    <p id="auth-pin-change-error" class="auth-error" role="alert"></p>
    <button type="submit">Сохранить PIN-код</button>
  </form>`;
  document.body.append(dialog);
  return dialog;
}

function showPinDialog() {
  const dialog = ensurePinDialog();
  dialog.querySelector('#auth-pin-change-form')?.reset();
  dialog.querySelector('#auth-pin-change-error').textContent = '';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  setTimeout(() => dialog.querySelector('input[name="currentPin"]')?.focus(), 0);
}

function applyProfile(payload) {
  authState.payload = payload;
  window.kafedraAuthContext = payload;
  document.documentElement.dataset.authRole = payload.role || '';
  document.body.classList.toggle('auth-staff', payload.role === 'staff');
  const personId = payload.user?.person?.id || '';
  if (personId) localStorage.setItem('kafedra-current-person-id', personId);
  if (!payload.authenticated || !payload.user) return;
  let control = document.querySelector('#auth-user-control');
  const buttonLabel = payload.authMode === 'pin'
    ? 'Доступ'
    : (payload.user.person?.displayName || payload.user.username);
  const secretLabel = payload.authMode === 'pin' ? 'Сменить PIN-код' : 'Сменить пароль';
  const secretAction = payload.authMode === 'pin' ? 'pin' : 'password';
  if (!control) {
    control = document.createElement('div');
    control.id = 'auth-user-control';
    control.className = 'auth-user-control';
    control.innerHTML = `<button class="auth-user-button" type="button" aria-expanded="false">${authSafe(buttonLabel)}</button>
      <div class="auth-user-menu hidden">
        <button type="button" data-auth-action="${secretAction}">${secretLabel}</button>
        <button type="button" data-auth-action="logout">Выйти</button>
      </div>`;
    const host = document.querySelector('.topbar-actions') || document.body;
    host.prepend(control);
  }
  const current = document.querySelector('#current-person-select');
  if (current && personId) {
    current.value = personId;
    current.disabled = payload.role === 'staff';
  }
  window.dispatchEvent(
    new CustomEvent('kafedra-auth-changed', { detail: payload })
  );
}

function observeProfileControl() {
  const update = () => {
    const payload = authState.payload;
    const select = document.querySelector('#current-person-select');
    const personId = payload?.user?.person?.id;
    if (!select || !personId) return;
    if (payload.role === 'staff' && [...select.options].some((option) => option.value === personId)) {
      select.value = personId;
    }
    select.disabled = payload.role === 'staff';
    const actor = document.querySelector(
      '#metric-correction-form select[name="actorPersonId"]'
    );
    if (actor) {
      actor.value = personId;
      actor.disabled = true;
    }
  };
  new MutationObserver(update).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  update();
}

async function initializeAuth() {
  ensureAuthStyles();
  ensureAuthGate();
  observeProfileControl();
  const payload = await authJson('/api/auth/me');
  authState.ready = true;
  authState.payload = payload;
  if (!payload.authEnabled) {
    hideLogin();
    applyProfile(payload);
    return payload;
  }
  if (!payload.authenticated) {
    showLogin('', payload);
    return payload;
  }
  applyProfile(payload);
  hideLogin();
  if (payload.authMode === 'accounts' && payload.mustChangePassword) showPasswordDialog(true);
  return payload;
}

function showPasswordDialog(required = false) {
  const currentPassword = window.prompt(
    required ? 'Введите временный пароль:' : 'Введите текущий пароль:'
  );
  if (currentPassword === null) return;
  const newPassword = window.prompt(
    'Введите новый пароль: не менее 12 символов, буквы и цифры.'
  );
  if (newPassword === null) return;
  authJson('/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  })
    .then(() => window.location.reload())
    .catch((error) => window.alert(error.message));
}

window.fetch = async function authenticatedFetch(input, init = {}) {
  const response = await authBaseFetch(input, requestWithCsrf(input, init));
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin
  );
  if (
    response.status === 401
    && url.origin === window.location.origin
    && !url.pathname.startsWith('/api/auth/')
  ) {
    const payload = {
      ...(authState.payload || {}),
      authenticated: false,
      pinConfigured: authState.payload?.authMode === 'pin' ? true : null
    };
    showLogin(
      payload.authMode === 'pin' ? 'Сессия завершена. Введите PIN-код снова.' : 'Сессия завершена. Войдите снова.',
      payload
    );
  }
  if (response.status === 403 && url.origin === window.location.origin) {
    const cloned = response.clone();
    const data = await cloned.json().catch(() => null);
    if (data?.error?.code === 'csrf_token_invalid') {
      window.setTimeout(() => window.location.reload(), 50);
    }
  }
  return response;
};

window.kafedraAuthReady = initializeAuth().catch((error) => {
  showLogin(error.message, authState.payload || { authMode: 'pin', pinConfigured: true });
  return { authEnabled: true, authenticated: false };
});
window.kafedraAuth = authState;

async function submitAuthForm(form, path, payload) {
  const errorNode = form.querySelector('.auth-error');
  if (errorNode) errorNode.textContent = '';
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await authJson(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    window.location.reload();
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message;
    if (button) button.disabled = false;
    form.querySelector('input')?.focus();
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'auth-login-form') {
    event.preventDefault();
    submitAuthForm(form, '/api/auth/login', Object.fromEntries(new FormData(form)));
    return;
  }
  if (form.id === 'auth-pin-login-form') {
    event.preventDefault();
    const pin = new FormData(form).get('pin');
    submitAuthForm(form, '/api/auth/login', { pin });
    return;
  }
  if (form.id === 'auth-pin-setup-form') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const errorNode = form.querySelector('.auth-error');
    if (values.pin !== values.pinConfirm) {
      errorNode.textContent = 'PIN-коды не совпадают.';
      form.querySelector('input[name="pinConfirm"]')?.focus();
      return;
    }
    submitAuthForm(form, '/api/auth/setup-pin', { pin: values.pin });
    return;
  }
  if (form.id === 'auth-pin-change-form') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const errorNode = form.querySelector('#auth-pin-change-error');
    if (values.newPin !== values.newPinConfirm) {
      errorNode.textContent = 'Новые PIN-коды не совпадают.';
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    errorNode.textContent = '';
    authJson('/api/auth/change-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPin: values.currentPin, newPin: values.newPin })
    })
      .then(() => window.location.reload())
      .catch((error) => {
        errorNode.textContent = error.message;
        button.disabled = false;
      });
  }
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('#auth-pin-login-form input[name="pin"]');
  if (!input) return;
  input.value = input.value.replace(/\D/g, '').slice(0, 4);
  if (/^\d{4}$/.test(input.value)) input.form?.requestSubmit();
});

function closeAuthMenu() {
  document.querySelector('.auth-user-menu')?.classList.add('hidden');
  document.querySelector('.auth-user-button')?.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (event) => {
  const userButton = event.target.closest('.auth-user-button');
  if (userButton) {
    const menu = document.querySelector('.auth-user-menu');
    const open = menu.classList.toggle('hidden') === false;
    userButton.setAttribute('aria-expanded', String(open));
  }
  if (event.target.closest('[data-auth-pin-close]')) {
    const dialog = document.querySelector('#auth-pin-dialog');
    if (typeof dialog?.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
  }
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action) closeAuthMenu();
  if (action === 'pin') showPinDialog();
  if (action === 'password') showPasswordDialog(false);
  if (action === 'logout') {
    authJson('/api/auth/logout', { method: 'POST' })
      .finally(() => window.location.reload());
  }
});
