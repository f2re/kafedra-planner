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
  gate.innerHTML = `<section class="auth-card" aria-labelledby="auth-title">
    <h1 id="auth-title">Вход в систему</h1>
    <p>Используйте локальный аккаунт сотрудника. Пароль и документы не передаются во внешние сервисы.</p>
    <form id="auth-login-form" class="auth-form">
      <label>Имя пользователя<input name="username" autocomplete="username" required></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <p id="auth-login-error" class="auth-error" role="alert"></p>
      <button type="submit">Войти</button>
    </form>
  </section>`;
  document.body.append(gate);
  return gate;
}

function showLogin(message = '') {
  const gate = ensureAuthGate();
  gate.classList.remove('hidden');
  document.querySelector('#auth-login-error').textContent = message;
  authState.showingLogin = true;
  setTimeout(() => gate.querySelector('input[name="username"]')?.focus(), 0);
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
    throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  }
  return data;
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
  if (!control) {
    control = document.createElement('div');
    control.id = 'auth-user-control';
    control.className = 'auth-user-control';
    control.innerHTML = `<button class="auth-user-button" type="button" aria-expanded="false">${authSafe(payload.user.person?.displayName || payload.user.username)}</button>
      <div class="auth-user-menu hidden">
        <button type="button" data-auth-action="password">Сменить пароль</button>
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
    if ([...select.options].some((option) => option.value === personId)) {
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
  if (!payload.authEnabled) {
    hideLogin();
    applyProfile(payload);
    return payload;
  }
  if (!payload.authenticated) {
    showLogin();
    return payload;
  }
  applyProfile(payload);
  hideLogin();
  if (payload.mustChangePassword) showPasswordDialog(true);
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
    showLogin('Сессия завершена. Войдите снова.');
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
  showLogin(error.message);
  return { authEnabled: true, authenticated: false };
});
window.kafedraAuth = authState;

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'auth-login-form') return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const errorNode = document.querySelector('#auth-login-error');
  errorNode.textContent = '';
  authJson('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values)
  })
    .then(() => window.location.reload())
    .catch((error) => {
      errorNode.textContent = error.message;
    });
});

document.addEventListener('click', (event) => {
  const userButton = event.target.closest('.auth-user-button');
  if (userButton) {
    const menu = document.querySelector('.auth-user-menu');
    const open = menu.classList.toggle('hidden') === false;
    userButton.setAttribute('aria-expanded', String(open));
  }
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action === 'password') showPasswordDialog(false);
  if (action === 'logout') {
    authJson('/api/auth/logout', { method: 'POST' })
      .finally(() => window.location.reload());
  }
});
