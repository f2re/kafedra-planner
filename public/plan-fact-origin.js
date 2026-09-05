function markPreferenceOrigin(element, origin) {
  window.kafedraPreferenceOrigin?.mark?.(element, origin);
}

function viewSelect() {
  return document.querySelector('#plan-fact-view-select');
}

function viewRoot() {
  const select = viewSelect();
  return select?.closest('[data-plan-fact-tools], .plan-fact-tools, .plan-fact-toolbar, .view') || document.querySelector('[data-view-panel="plan-fact"]') || document;
}

function markSavedViewControls() {
  const select = viewSelect();
  if (!select?.value) return;
  const root = viewRoot();
  for (const control of root.querySelectorAll('input,select,textarea')) {
    if (control === select) continue;
    markPreferenceOrigin(control, 'saved');
  }
  markPreferenceOrigin(select, 'saved');
}

function scheduleMarkSavedView() {
  queueMicrotask(() => requestAnimationFrame(markSavedViewControls));
}

document.addEventListener('change', (event) => {
  if (event.target?.id === 'plan-fact-view-select') scheduleMarkSavedView();
}, true);

new MutationObserver(() => {
  if (viewSelect()?.value) scheduleMarkSavedView();
}).observe(document.body, { childList: true, subtree: true });

window.addEventListener('kafedra:view-changed', (event) => {
  if (event.detail?.view === 'plan-fact' || event.detail?.view === 'plans') scheduleMarkSavedView();
});

scheduleMarkSavedView();
