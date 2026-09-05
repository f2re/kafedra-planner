let selectedPeriodicId = null;
let selectedTask = null;
let loadToken = 0;

function currentPersonId() {
  return window.kafedraAuthContext?.user?.person?.id
    || window.kafedraAuthContext?.user?.account?.person_id
    || null;
}

function canTransition(task) {
  const auth = window.kafedraAuthContext;
  if (!auth?.authEnabled) return true;
  if (['admin', 'manager'].includes(auth.role)) return true;
  return Boolean(currentPersonId() && task?.owner_person_id === currentPersonId());
}

async function api(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.code = data?.error?.code || null;
    throw error;
  }
  return data;
}

function ensureStyles() {
  if (document.querySelector('#periodic-completion-styles')) return;
  const style = document.createElement('style');
  style.id = 'periodic-completion-styles';
  style.textContent = `
    .periodic-completion-panel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0;padding:12px 14px;border:1px solid var(--border,#dce3ea);border-radius:14px;background:var(--surface-soft,#f8fafc)}
    .periodic-completion-panel span{color:var(--muted,#64748b);font-size:13px}.periodic-completion-panel button{margin-left:auto}
    @media(max-width:720px){.periodic-completion-panel button{width:100%;margin-left:0}}
  `;
  document.head.append(style);
}

function renderAction() {
  const body = document.querySelector('#ux-inspector-body');
  if (!body) return;
  body.querySelector('.periodic-completion-panel')?.remove();
  if (!selectedPeriodicId || !selectedTask || !canTransition(selectedTask)) return;
  if (selectedTask.status === 'cancelled') return;
  const completed = selectedTask.status === 'completed';
  const panel = document.createElement('div');
  panel.className = 'periodic-completion-panel';
  panel.dataset.periodicCompletionPanel = selectedTask.id;
  panel.innerHTML = `
    <span>${completed ? 'Задача выполнена. При необходимости её можно снова открыть.' : 'Файл и комментарий не обязательны.'}</span>
    <button class="${completed ? 'secondary-button' : 'primary-button'}" type="button" data-periodic-transition="${completed ? 'reopen' : 'complete'}" data-periodic-id="${selectedTask.id}">${completed ? 'Вернуть в работу' : 'Выполнено'}</button>
  `;
  const firstPanel = body.querySelector('.assignment-progress-panel,.work-responsibility,.assignment-evidence-panel');
  if (firstPanel) firstPanel.before(panel); else body.append(panel);
}

async function selectPeriodic(id) {
  const token = ++loadToken;
  selectedPeriodicId = id;
  selectedTask = null;
  try {
    const task = await api(`/api/periodic-tasks/${encodeURIComponent(id)}`);
    if (token !== loadToken || selectedPeriodicId !== id) return;
    selectedTask = task;
    renderAction();
  } catch {
    if (token === loadToken) renderAction();
  }
}

async function transition(button) {
  if (button.disabled) return;
  const id = button.dataset.periodicId;
  const action = button.dataset.periodicTransition;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = action === 'complete' ? 'Сохраняется…' : 'Возвращается…';
  try {
    const task = await api(`/api/periodic-tasks/${encodeURIComponent(id)}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action })
    });
    if (selectedPeriodicId === id) {
      selectedTask = task;
      renderAction();
    }
    if (typeof window.loadWork === 'function') await window.loadWork();
    window.dispatchEvent(new CustomEvent('kafedra:periodic-task-transitioned', {
      detail: { taskId: id, status: task.status }
    }));
  } catch (error) {
    button.disabled = false;
    button.textContent = previous;
    const toast = document.querySelector('#toast');
    if (toast) {
      toast.textContent = error.message;
      toast.classList.remove('hidden');
    }
  }
}

ensureStyles();

const inspectorBody = document.querySelector('#ux-inspector-body');
if (inspectorBody) {
  new MutationObserver(() => renderAction()).observe(inspectorBody, { childList: true, subtree: true });
}

document.addEventListener('click', (event) => {
  const transitionButton = event.target.closest('[data-periodic-transition]');
  if (transitionButton) {
    event.preventDefault();
    event.stopPropagation();
    transition(transitionButton);
    return;
  }
  const card = event.target.closest('[data-work-kind]');
  if (!card) return;
  if (card.dataset.workKind === 'periodic_task') selectPeriodic(card.dataset.workId);
  else {
    selectedPeriodicId = null;
    selectedTask = null;
    renderAction();
  }
}, true);
