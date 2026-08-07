function nativePlansView(event) {
  const plansNav = event.target?.closest?.('[data-view="plans"]');
  const plansSource = event.target?.closest?.('[data-open-plan-source]');
  if (!plansNav && !plansSource) return;
  if (typeof window.kafedraSetView === 'function') window.kafedraSetView('plans');
}

window.addEventListener('click', nativePlansView, true);
