// Accessibility of existing navigation and upload triggers; no new domain commands.
let pending = false;
function updateControls() {
  pending = false;
  for (const button of document.querySelectorAll('.nav-item[data-view],.mobile-tab[data-view]')) {
    const current = button.classList.contains('active');
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const button of document.querySelectorAll('.segment,.filter-chip')) {
    const active = button.classList.contains('active');
    if (button.matches('[role="tab"]')) {
      button.setAttribute('aria-selected', String(active));
      button.removeAttribute('aria-pressed');
    } else {
      button.setAttribute('aria-pressed', String(active));
    }
  }
  for (const input of document.querySelectorAll('label input[type=file][hidden]')) {
    const label = input.closest('label');
    label.setAttribute('role', 'button');
    label.tabIndex = input.disabled ? -1 : 0;
    label.setAttribute('aria-disabled', String(input.disabled));
    label.dataset.workspaceUpload = 'true';
  }
  document.documentElement.dataset.workspaceUiReady = 'true';
}
function schedule() {
  if (!pending) { pending = true; requestAnimationFrame(updateControls); }
}
document.addEventListener('keydown', event => {
  const label = event.target.closest?.('label[data-workspace-upload]');
  if (event.defaultPrevented || !label || event.target !== label || !['Enter',' '].includes(event.key)) return;
  event.preventDefault();
  const input = label.querySelector('input[type=file]');
  if (input && !input.disabled) input.click();
});
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','disabled'] });
updateControls();
