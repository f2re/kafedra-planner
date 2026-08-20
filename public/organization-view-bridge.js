const ORGANIZATION_VIEW = 'admin';

function ensureOrganizationViewStyles() {
  if (document.querySelector('#organization-view-bridge-styles')) return;
  const link = document.createElement('link');
  link.id = 'organization-view-bridge-styles';
  link.rel = 'stylesheet';
  link.href = '/organization-view-bridge.css';
  document.head.append(link);
}

function ensureOrganizationView() {
  ensureOrganizationViewStyles();
  const workspace = document.querySelector('main.workspace');
  if (!workspace) return null;

  let panel = document.querySelector('[data-view-panel="admin"]');
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'view organization-view';
    panel.dataset.viewPanel = ORGANIZATION_VIEW;
    panel.setAttribute('aria-label', 'Структура кафедры');
    workspace.append(panel);
  }

  const sidebar = document.querySelector('#navigation');
  if (sidebar && !sidebar.querySelector('[data-view="admin"]')) {
    const button = document.createElement('button');
    button.className = 'nav-item organization-view-trigger';
    button.type = 'button';
    button.dataset.view = ORGANIZATION_VIEW;
    button.innerHTML = '<span class="nav-icon" aria-hidden="true">⌘</span><span>Структура</span>';
    sidebar.append(button);
  }

  const mobile = document.querySelector('.mobile-tabs');
  if (mobile && !mobile.querySelector('[data-view="admin"]')) {
    const button = document.createElement('button');
    button.className = 'mobile-tab organization-view-trigger';
    button.type = 'button';
    button.dataset.view = ORGANIZATION_VIEW;
    button.innerHTML = '<span aria-hidden="true">⌘</span>Штат';
    mobile.append(button);
    mobile.classList.add('organization-five-tabs');
  }

  return panel;
}

function removeOrganizationView() {
  document.querySelectorAll('.organization-view-trigger').forEach((node) => node.remove());
  document.querySelector('.mobile-tabs')?.classList.remove('organization-five-tabs');
  document.querySelector('[data-view-panel="admin"]')?.remove();
}

function openOrganizationView() {
  const panel = ensureOrganizationView();
  if (!panel) return;

  document.querySelectorAll('.nav-item, .mobile-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === ORGANIZATION_VIEW);
  });
  document.querySelectorAll('[data-view-panel]').forEach((view) => {
    view.classList.toggle('active', view === panel);
  });

  const title = document.querySelector('#page-title');
  const subtitle = document.querySelector('#page-subtitle');
  if (title) title.textContent = 'Структура кафедры';
  if (subtitle) subtitle.textContent = 'Подразделения, должности и кадровая история';
  document.querySelector('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  window.dispatchEvent(new CustomEvent('kafedra:view-changed', {
    detail: { view: ORGANIZATION_VIEW }
  }));
  window.kafedraLoadOrganization?.();
}

function applyOrganizationAccess(payload) {
  if (payload?.authEnabled && payload?.role !== 'admin') {
    removeOrganizationView();
    return;
  }
  ensureOrganizationView();
}

function awaitAuthContext(attempt = 0) {
  const ready = window.kafedraAuthReady;
  if (ready?.then) {
    ready.then(applyOrganizationAccess).catch(() => {});
    return;
  }
  if (attempt < 100) {
    window.setTimeout(() => awaitAuthContext(attempt + 1), 25);
    return;
  }
  applyOrganizationAccess({ authEnabled: false });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-view="admin"]')) return;
  event.preventDefault();
  openOrganizationView();
});

window.addEventListener('kafedra-auth-changed', (event) => {
  applyOrganizationAccess(event.detail);
});

awaitAuthContext();
window.kafedraOpenOrganization = openOrganizationView;
