let latestPlanDetail = null;
let decorateTimer = null;

function nativePlansView(event) {
  const plansNav = event.target?.closest?.('[data-view="plans"]');
  const plansSource = event.target?.closest?.('[data-open-plan-source]');
  if (!plansNav && !plansSource) return;
  if (typeof window.kafedraSetView === 'function') window.kafedraSetView('plans');
}

function scheduleCalendarLinks() {
  clearTimeout(decorateTimer);
  decorateTimer = setTimeout(decorateCalendarLinks, 0);
}

function decorateCalendarLinks() {
  const plan = latestPlanDetail;
  if (!plan?.id || !Array.isArray(plan.items)) return;
  const activeCard = document.querySelector('.plan-card.active');
  if (activeCard?.dataset.planId && activeCard.dataset.planId !== plan.id) return;

  for (const item of plan.items) {
    const row = document.querySelector(`[data-plan-item-row="${CSS.escape(item.id)}"]`);
    const actions = row?.lastElementChild;
    if (!row || !actions) continue;
    const projections = (item.calendar_items || []).filter((entry) => entry.status !== 'cancelled');
    for (const projection of projections) {
      if (actions.querySelector(`[data-plan-calendar-item="${CSS.escape(projection.id)}"]`)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'row-button';
      button.dataset.planCalendarItem = projection.id;
      button.dataset.calendarItem = projection.id;
      button.textContent = projection.item_kind === 'task' ? 'Срок в календаре' : 'В календаре';
      actions.prepend(button);
    }
  }
}

const beforeViewBridgeFetch = window.fetch.bind(window);
window.fetch = async function viewBridgeFetch(input, init = {}) {
  const response = await beforeViewBridgeFetch(input, init);
  try {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.origin);
    if (
      method === 'GET'
      && url.origin === window.location.origin
      && /^\/api\/plans\/[^/]+$/.test(url.pathname)
    ) {
      response.clone().json().then((plan) => {
        latestPlanDetail = plan;
        scheduleCalendarLinks();
      }).catch(() => {});
    }
  } catch {}
  return response;
};

window.addEventListener('click', nativePlansView, true);
window.addEventListener('kafedra:view-changed', (event) => {
  if (event.detail?.view === 'plans') scheduleCalendarLinks();
});

const calendarLinksObserver = new MutationObserver(() => {
  if (latestPlanDetail) scheduleCalendarLinks();
});
calendarLinksObserver.observe(document.documentElement, { childList: true, subtree: true });
