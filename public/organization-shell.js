function ensureOrganizationShellStyles() {
  if (document.querySelector('#organization-shell-styles')) return;
  const link = document.createElement('link');
  link.id = 'organization-shell-styles';
  link.rel = 'stylesheet';
  link.href = '/organization-shell.css';
  document.head.append(link);
}

function ensureOrganizationShell() {
  ensureOrganizationShellStyles();
  if (document.querySelector('#organization-shell-panel')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="organization-shell-backdrop" class="organization-shell-backdrop hidden"></div>
    <section id="organization-shell-panel" class="organization-shell-panel hidden"
      role="dialog" aria-modal="true" aria-labelledby="organization-shell-title">
      <div class="organization-shell-topline">
        <div><span class="eyebrow">Кафедра</span><strong id="organization-shell-title">Структура и назначения</strong></div>
        <button class="icon-button" type="button" data-organization-shell-close aria-label="Закрыть">×</button>
      </div>
      <div class="organization-shell-body admin-view active"></div>
    </section>
  `);
}

function ensureOrganizationMenu(payload) {
  if (payload?.authEnabled !== false && payload?.role !== 'admin') return;
  const menu = document.querySelector('.auth-user-menu');
  if (!menu || menu.querySelector('[data-auth-action="organization"]')) return;
  menu.insertAdjacentHTML('afterbegin', '<button type="button" data-auth-action="organization">Структура кафедры</button>');
}

function openOrganizationShell() {
  ensureOrganizationShell();
  document.querySelector('#organization-shell-panel')?.classList.remove('hidden');
  document.querySelector('#organization-shell-backdrop')?.classList.remove('hidden');
  document.body.classList.add('organization-shell-open');
  queueMicrotask(() => window.kafedraLoadOrganization?.());
}

function closeOrganizationShell() {
  document.querySelector('#organization-shell-panel')?.classList.add('hidden');
  document.querySelector('#organization-shell-backdrop')?.classList.add('hidden');
  document.body.classList.remove('organization-shell-open');
}

ensureOrganizationShell();
window.kafedraOpenOrganization = openOrganizationShell;
window.kafedraCloseOrganization = closeOrganizationShell;

window.addEventListener('kafedra-auth-changed', (event) => ensureOrganizationMenu(event.detail));
window.kafedraAuthReady?.then(ensureOrganizationMenu);

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
  if (action === 'organization') openOrganizationShell();
  if (event.target.closest('[data-organization-shell-close]') || event.target.id === 'organization-shell-backdrop') {
    closeOrganizationShell();
  }
});
