function adminResetStatus(message, error = false) {
  const node = document.querySelector('#admin-access-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = error ? '#a3222b' : '#4f5e74';
}

async function refreshAdminPanel() {
  const trigger = document.querySelector('[data-auth-action="admin"]');
  if (trigger) trigger.click();
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-admin-reset]');
  if (!button || typeof window.kafedraRequestSecret !== 'function') return;
  const row = button.closest('[data-account-id]');
  if (!row?.dataset.accountId) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const password = await window.kafedraRequestSecret({
    title: 'Сбросить пароль',
    description: 'Новый временный пароль потребуется сменить при следующем входе.',
    label: 'Новый временный пароль',
    submitLabel: 'Сбросить пароль',
    minLength: 12
  });
  if (password === null) return;

  button.disabled = true;
  try {
    const response = await window.fetch(
      `/api/admin/accounts/${encodeURIComponent(row.dataset.accountId)}/reset-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, mustChangePassword: true })
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    adminResetStatus('Пароль сброшен, прежние сессии завершены.');
    await refreshAdminPanel();
  } catch (error) {
    adminResetStatus(error.message || 'Не удалось сбросить пароль.', true);
  } finally {
    button.disabled = false;
  }
}, true);
