const authBaseFetch = window.fetch.bind(window);
const authState = {
  ready: false,
  payload: null,
  showingLogin: false,
  setupPin: '',
  secretReturnFocus: null
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
  return `<input class="auth-pin-input" name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="PIN-код из четырёх цифр" required>`;
}

function normalizeAuthMode(payload) {
  return payload?.authMode === 'accounts' ? 'accounts' : 'pin';
}

function authViewKey(payload) {
  const mode = normalizeAuthMode(payload);
  if (mode !== 'pin') return 'accounts';
  return payload?.pinConfigured ? 'pin-login' : 'pin-setup';
}

function renderAuthGate(payload, message = '') {
  const gate = ensureAuthGate();
  const mode = normalizeAuthMode(payload);
  if (mode === 'pin' && !payload?.pinConfigured) {
    authState.setupPin = '';
    gate.innerHTML = `<section class="auth-card auth-card-pin" aria-labelledby="auth-title">
      <div class="auth-lock-mark" aria-hidden="true">••••</div>
      <div id="auth-pin-step" class="auth-pin-step">Шаг 1 из 2</div>
      <h1 id="auth-title">Задайте PIN-код</h1>
      <p id="auth-pin-description">Придумайте четыре цифры. Логин, регистрация и временный пароль не нужны.</p>
      <form id="auth-pin-setup-form" class="auth-form" data-pin-stage="create">
        <label class="auth-pin-label"><span id="auth-pin-field-label">Новый PIN-код</span>${pinInput('pin', 'new-password')}</label>
        <p id="auth-login-error" class="auth-error" role="alert" aria-live="polite">${authSafe(message)}</p>
        <button type="submit">Продолжить</button>
      </form>
    </section>`;
  } else if (mode === 'pin') {
    gate.innerHTML = `<section class="auth-card auth-card-pin" aria-labelledby="auth-title">
      <div class="auth-lock-mark" aria-hidden="true">••••</div>
      <h1 id="auth-title">Введите PIN-код</h1>
      <p>Четыре цифры — и рабочее пространство откроется автоматически.</p>
      <form id="auth-pin-login-form" class="auth-form">
        <label class="auth-pin-label">PIN-код${pinInput('pin', 'off')}</label>
        <p id="auth-login-error" class="auth-error" role="alert" aria-live="polite">${authSafe(message)}</p>
        <button type="submit">Открыть</button>
      </form>
    </section>`;
  } else {
    gate.innerHTML = `<section class="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">Персональный вход</h1>
      <p>Расширенный режим отдельных аккаунтов включён администратором этой установки.</p>
      <form id="auth-login-form" class="auth-form">
        <label>Имя пользователя<input name="username" autocomplete="username" required></label>
        <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
        <p id="auth-login-error" class="auth-error" role="alert">${authSafe(message)}</p>
        <button type="submit">Войти</button>
      </form>
    </section>`;
  }
  gate.dataset.authView = authViewKey(payload);
  return gate;
}

function showLogin(message = '', payload = authState.payload) {
  const resolved = payload || { authMode: 'pin', pinConfigured: true };
  let gate = ensureAuthGate();
  const viewChanged = gate.dataset.authView !== authViewKey(resolved) || !gate.querySelector('form');
  const wasHidden = gate.classList.contains('hidden');
  if (viewChanged) gate = renderAuthGate(resolved, message);
  else if (message) {
    const errorNode = gate.querySelector('#auth-login-error');
    if (errorNode) errorNode.textContent = message;
  }
  gate.classList.remove('hidden');
  authState.showingLogin = true;
  if (viewChanged || wasHidden) {
    setTimeout(() => gate.querySelector('input')?.focus(), 0);
  }
}

function hideLogin() {
  ensureAuthGate().classList.add('hidden');
  authState.showingLogin = false;
  authState.setupPin = '';
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

function closeNativeDialog(dialog) {
  if (typeof dialog?.close === 'function') dialog.close();
  else dialog?.removeAttribute('open');
}

function rememberSecretOrigin() {
  const active = document.activeElement;
  authState.secretReturnFocus = active instanceof HTMLElement ? active : null;
}

function restoreSecretOrigin() {
  const target = authState.secretReturnFocus;
  authState.secretReturnFocus = null;
  if (target?.isConnected && typeof target.focus === 'function') {
    setTimeout(() => target.focus({ preventScroll: true }), 0);
  }
}

function ensurePinDialog() {
  let dialog = document.querySelector('#auth-pin-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'auth-pin-dialog';
  dialog.className = 'auth-pin-dialog auth-secret-dialog';
  dialog.innerHTML = `<form id="auth-pin-change-form" method="dialog" class="auth-form">
    <div class="auth-dialog-header">
      <div><strong>Сменить PIN-код</strong><p>Текущий код нужен один раз. Новый код — четыре цифры.</p></div>
      <button class="auth-dialog-close" type="button" data-auth-pin-close aria-label="Закрыть">×</button>
    </div>
    <label>Текущий PIN-код${pinInput('currentPin')}</label>
    <label>Новый PIN-код${pinInput('newPin', 'new-password')}</label>
    <label>Повторите новый PIN${pinInput('newPinConfirm', 'new-password')}</label>
    <p id="auth-pin-change-error" class="auth-error" role="alert" aria-live="polite"></p>
    <button type="submit">Сохранить PIN-код</button>
  </form>`;
  dialog.addEventListener('close', restoreSecretOrigin);
  document.body.append(dialog);
  return dialog;
}

function showPinDialog() {
  rememberSecretOrigin();
  const dialog = ensurePinDialog();
  dialog.querySelector('#auth-pin-change-form')?.reset();
  dialog.querySelector('#auth-pin-change-error').textContent = '';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  setTimeout(() => dialog.querySelector('input[name="currentPin"]')?.focus(), 0);
}

function ensurePasswordDialog() {
  let dialog = document.querySelector('#auth-password-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'auth-password-dialog';
  dialog.className = 'auth-password-dialog auth-secret-dialog';
  dialog.innerHTML = `<form id="auth-password-change-form" method="dialog" class="auth-form">
    <div class="auth-dialog-header">
      <div><strong id="auth-password-title">Сменить пароль</strong><p>Пароль хранится локально в виде стойкого хэша.</p></div>
      <button class="auth-dialog-close" type="button" data-auth-password-close aria-label="Закрыть">×</button>
    </div>
    <label><span id="auth-current-password-label">Текущий пароль</span><input name="currentPassword" type="password" autocomplete="current-password" required></label>
    <label>Новый пароль<input name="newPassword" type="password" minlength="12" autocomplete="new-password" required></label>
    <label>Повторите новый пароль<input name="newPasswordConfirm" type="password" minlength="12" autocomplete="new-password" required></label>
    <p id="auth-password-change-error" class="auth-error" role="alert" aria-live="polite"></p>
    <button type="submit">Сохранить пароль</button>
  </form>`;
  dialog.addEventListener('close', restoreSecretOrigin);
  document.body.append(dialog);
  return dialog;
}

function showPasswordDialog(required = false) {
  rememberSecretOrigin();
  const dialog = ensurePasswordDialog();
  const form = dialog.querySelector('#auth-password-change-form');
  form?.reset();
  if (form) form.dataset.submitting = 'false';
  dialog.querySelector('#auth-password-change-error').textContent = '';
  dialog.querySelector('#auth-password-title').textContent = required ? 'Задайте постоянный пароль' : 'Сменить пароль';
  dialog.querySelector('#auth-current-password-label').textContent = required ? 'Временный пароль' : 'Текущий пароль';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  setTimeout(() => dialog.querySelector('input[name="currentPassword"]')?.focus(), 0);
}

function ensureSecretRequestDialog() {
  let dialog = document.querySelector('#auth-secret-request-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'auth-secret-request-dialog';
  dialog.className = 'auth-secret-request-dialog auth-secret-dialog';
  dialog.innerHTML = `<form id="auth-secret-request-form" method="dialog" class="auth-form">
    <div class="auth-dialog-header">
      <div><strong data-secret-title>Введите пароль</strong><p data-secret-description></p></div>
      <button class="auth-dialog-close" type="button" data-auth-secret-close aria-label="Закрыть">×</button>
    </div>
    <label><span data-secret-label>Пароль</span><input name="secret" type="password" autocomplete="new-password" required></label>
    <p class="auth-error" role="alert" aria-live="polite"></p>
    <button type="submit" data-secret-submit>Продолжить</button>
  </form>`;
  document.body.append(dialog);
  return dialog;
}

window.kafedraRequestSecret = function requestSecret({
  title = 'Введите пароль',
  description = '',
  label = 'Пароль',
  submitLabel = 'Продолжить',
  minLength = 1
} = {}) {
  rememberSecretOrigin();
  const dialog = ensureSecretRequestDialog();
  const form = dialog.querySelector('#auth-secret-request-form');
  const input = form.querySelector('input[name="secret"]');
  dialog.querySelector('[data-secret-title]').textContent = title;
  dialog.querySelector('[data-secret-description]').textContent = description;
  dialog.querySelector('[data-secret-label]').textContent = label;
  dialog.querySelector('[data-secret-submit]').textContent = submitLabel;
  form.querySelector('.auth-error').textContent = '';
  input.minLength = Math.max(1, Number(minLength) || 1);
  form.reset();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  setTimeout(() => input.focus(), 0);
  return new Promise((resolve) => {
    const finish = (value) => {
      form.removeEventListener('submit', submit);
      dialog.removeEventListener('close', cancel);
      restoreSecretOrigin();
      resolve(value);
    };
    const submit = (event) => {
      event.preventDefault();
      const value = input.value;
      if (value.length < input.minLength) {
        form.querySelector('.auth-error').textContent = `Не менее ${input.minLength} символов.`;
        input.focus();
        return;
      }
      closeNativeDialog(dialog);
      finish(value);
    };
    const cancel = () => finish(null);
    form.addEventListener('submit', submit);
    dialog.addEventListener('close', cancel, { once: true });
  });
};

function applyProfile(payload) {
  authState.payload = payload;
  window.kafedraAuthContext = payload;
  document.documentElement.dataset.authRole = payload.role || '';
  document.body.classList.toggle('auth-staff', payload.role === 'staff');
  const personId = payload.user?.person?.id || '';
  if (personId) localStorage.setItem('kafedra-current-person-id', personId);
  if (!payload.authenticated || !payload.user) return;
  const mode = normalizeAuthMode(payload);
  let control = document.querySelector('#auth-user-control');
  const buttonLabel = mode === 'pin'
    ? 'Доступ'
    : (payload.user.person?.displayName || payload.user.username);
  const secretLabel = mode === 'pin' ? 'Сменить PIN-код' : 'Сменить пароль';
  const secretAction = mode === 'pin' ? 'pin' : 'password';
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
  if (normalizeAuthMode(payload) === 'accounts' && payload.mustChangePassword) {
    showPasswordDialog(true);
  }
  return payload;
}

window.kafedraAuthReady = initializeAuth().catch((error) => {
  showLogin(error.message, authState.payload || { authMode: 'pin', pinConfigured: true });
  return { authEnabled: true, authenticated: false };
});
window.kafedraAuth = authState;

window.fetch = async function authenticatedFetch(input, init = {}) {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin
  );
  const method = String(
    init.method || (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  if (isMutating && url.origin === window.location.origin && !url.pathname.startsWith('/api/auth/')) {
    if (window.kafedraAuthReady) {
      try {
        await window.kafedraAuthReady;
      } catch {}
    }
  }

  let finalInit = requestWithCsrf(input, init);
  let response = await authBaseFetch(input, finalInit);

  if (
    response.status === 401
    && url.origin === window.location.origin
    && !url.pathname.startsWith('/api/auth/')
    && authState.payload?.authenticated
  ) {
    const current = authState.payload;
    const mode = normalizeAuthMode(current);
    const payload = {
      ...current,
      authMode: mode,
      authenticated: false,
      pinConfigured: mode === 'pin'
        ? Boolean(current.pinConfigured || current.authenticated)
        : null
    };
    showLogin(
      mode === 'pin'
        ? (payload.pinConfigured ? 'Сессия завершена. Введите PIN-код снова.' : '')
        : 'Сессия завершена. Войдите снова.',
      payload
    );
  }
  if (response.status === 403 && url.origin === window.location.origin) {
    const cloned = response.clone();
    const data = await cloned.json().catch(() => null);
    if (data?.error?.code === 'csrf_token_invalid') {
      try {
        const fresh = await authBaseFetch('/api/auth/me').then((r) => r.json());
        if (fresh?.csrfToken && fresh.csrfToken !== authState.payload?.csrfToken) {
          authState.payload = { ...(authState.payload || {}), ...fresh };
          finalInit = requestWithCsrf(input, init);
          const retried = await authBaseFetch(input, finalInit);
          if (retried.ok) return retried;
        }
      } catch {}

      const now = Date.now();
      const lastReload = Number(sessionStorage.getItem('kafedra-csrf-reload-time') || 0);
      if (now - lastReload > 15000) {
        sessionStorage.setItem('kafedra-csrf-reload-time', String(now));
        window.setTimeout(() => window.location.reload(), 150);
      } else {
        console.warn('Защитный токен CSRF недействителен, автоматическая перезагрузка заблокирована от цикла.');
      }
    }
  }
  return response;
};

async function submitAuthForm(form, path, payload, { clearPinOnError = false } = {}) {
  if (form.dataset.submitting === 'true') return false;
  form.dataset.submitting = 'true';
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
    return true;
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message;
    if (clearPinOnError) {
      const input = form.querySelector('.auth-pin-input');
      if (input) input.value = '';
    }
    form.dataset.submitting = 'false';
    if (button) button.disabled = false;
    form.querySelector('input')?.focus();
    return false;
  }
}

function updatePinSetupStep(form, stage, message = '') {
  const confirming = stage === 'confirm';
  form.dataset.pinStage = confirming ? 'confirm' : 'create';
  const title = document.querySelector('#auth-title');
  const description = document.querySelector('#auth-pin-description');
  const step = document.querySelector('#auth-pin-step');
  const label = form.querySelector('#auth-pin-field-label');
  const button = form.querySelector('button[type="submit"]');
  const errorNode = form.querySelector('#auth-login-error');
  const input = form.querySelector('input[name="pin"]');
  if (title) title.textContent = confirming ? 'Повторите PIN-код' : 'Задайте PIN-код';
  if (description) {
    description.textContent = confirming
      ? 'Введите те же четыре цифры ещё раз — это защищает от случайной опечатки.'
      : 'Придумайте четыре цифры. Логин, регистрация и временный пароль не нужны.';
  }
  if (step) step.textContent = confirming ? 'Шаг 2 из 2' : 'Шаг 1 из 2';
  if (label) label.textContent = confirming ? 'Повторите PIN-код' : 'Новый PIN-код';
  if (button) button.textContent = confirming ? 'Сохранить и открыть' : 'Продолжить';
  if (errorNode) errorNode.textContent = message;
  if (input) {
    input.value = '';
    input.setAttribute(
      'aria-label',
      confirming ? 'Повторите PIN-код из четырёх цифр' : 'Новый PIN-код из четырёх цифр'
    );
  }
  setTimeout(() => input?.focus(), 0);
}

async function submitPinSetup(form) {
  const input = form.querySelector('input[name="pin"]');
  const pin = input?.value || '';
  const errorNode = form.querySelector('#auth-login-error');
  if (!/^\d{4}$/.test(pin)) {
    if (errorNode) errorNode.textContent = 'Введите ровно четыре цифры.';
    input?.focus();
    return;
  }

  if (form.dataset.pinStage !== 'confirm') {
    authState.setupPin = pin;
    updatePinSetupStep(form, 'confirm');
    return;
  }

  if (!authState.setupPin || authState.setupPin !== pin) {
    authState.setupPin = '';
    updatePinSetupStep(form, 'create', 'PIN-коды не совпали. Введите новый код ещё раз.');
    return;
  }

  const chosenPin = authState.setupPin;
  authState.setupPin = '';
  const success = await submitAuthForm(
    form,
    '/api/auth/setup-pin',
    { pin: chosenPin },
    { clearPinOnError: true }
  );
  if (!success) {
    const message = errorNode?.textContent || 'Не удалось сохранить PIN-код.';
    updatePinSetupStep(form, 'create', message);
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
    const pin = String(new FormData(form).get('pin') || '');
    if (!/^\d{4}$/.test(pin)) {
      form.querySelector('#auth-login-error').textContent = 'Введите ровно четыре цифры.';
      form.querySelector('input[name="pin"]')?.focus();
      return;
    }
    submitAuthForm(form, '/api/auth/login', { pin }, { clearPinOnError: true });
    return;
  }
  if (form.id === 'auth-pin-setup-form') {
    event.preventDefault();
    submitPinSetup(form);
    return;
  }
  if (form.id === 'auth-pin-change-form') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const errorNode = form.querySelector('#auth-pin-change-error');
    if (values.newPin !== values.newPinConfirm) {
      errorNode.textContent = 'Новые PIN-коды не совпадают.';
      form.querySelector('input[name="newPin"]').value = '';
      form.querySelector('input[name="newPinConfirm"]').value = '';
      form.querySelector('input[name="newPin"]')?.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
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
        form.dataset.submitting = 'false';
        button.disabled = false;
        form.querySelector('input[name="currentPin"]').value = '';
        form.querySelector('input[name="currentPin"]')?.focus();
      });
    return;
  }
  if (form.id === 'auth-password-change-form') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const errorNode = form.querySelector('#auth-password-change-error');
    if (values.newPassword !== values.newPasswordConfirm) {
      errorNode.textContent = 'Новые пароли не совпадают.';
      form.querySelector('input[name="newPassword"]').value = '';
      form.querySelector('input[name="newPasswordConfirm"]').value = '';
      form.querySelector('input[name="newPassword"]')?.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    button.disabled = true;
    errorNode.textContent = '';
    authJson('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword })
    })
      .then(() => window.location.reload())
      .catch((error) => {
        errorNode.textContent = error.message;
        form.dataset.submitting = 'false';
        button.disabled = false;
        form.querySelector('input[name="currentPassword"]').value = '';
        form.querySelector('input[name="currentPassword"]')?.focus();
      });
  }
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('.auth-pin-input');
  if (!input) return;
  input.value = input.value.replace(/\D/g, '').slice(0, 4);
  if (!/^\d{4}$/.test(input.value)) return;

  const form = input.form;
  if (form?.dataset.submitting === 'true') return;
  if (form?.id === 'auth-pin-login-form' || form?.id === 'auth-pin-setup-form') {
    queueMicrotask(() => {
      if (/^\d{4}$/.test(input.value) && form.dataset.submitting !== 'true') {
        form.requestSubmit();
      }
    });
  }
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
  if (event.target.closest('[data-auth-pin-close]')) closeNativeDialog(document.querySelector('#auth-pin-dialog'));
  if (event.target.closest('[data-auth-password-close]')) closeNativeDialog(document.querySelector('#auth-password-dialog'));
  if (event.target.closest('[data-auth-secret-close]')) closeNativeDialog(document.querySelector('#auth-secret-request-dialog'));
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action) closeAuthMenu();
  if (action === 'pin') showPinDialog();
  if (action === 'password') showPasswordDialog(false);
  if (action === 'logout') {
    authJson('/api/auth/logout', { method: 'POST' })
      .finally(() => window.location.reload());
  }
});
