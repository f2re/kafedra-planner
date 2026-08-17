function ensureManualCreatePlanButton() {
  const actions = document.querySelector('.plans-heading-actions');
  if (!actions || actions.querySelector('[data-manual-create-plan]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  button.dataset.manualCreatePlan = '1';
  button.textContent = 'Создать план';
  actions.insertBefore(button, actions.firstChild);
}

ensureManualCreatePlanButton();
new MutationObserver(ensureManualCreatePlanButton).observe(document.body, { childList: true, subtree: true });
