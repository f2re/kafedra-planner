let latestPlanDetail = null;
let decorateTimer = null;
const pendingPlanDocuments = new Set();

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

function requestMethod(input, init) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestHeader(input, init, name) {
  const wanted = String(name || '').toLowerCase();
  const headers = init?.headers;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => String(key).toLowerCase() === wanted);
    return entry ? String(entry[1]) : null;
  }
  if (headers && typeof headers === 'object') {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
    return key ? String(headers[key]) : null;
  }
  if (input instanceof Request) return input.headers.get(name);
  return null;
}

function terminalDocumentStatus(status) {
  return ['processed', 'needs_review', 'failed'].includes(String(status || ''));
}

const beforeViewBridgeFetch = window.fetch.bind(window);
window.fetch = async function viewBridgeFetch(input, init = {}) {
  const method = requestMethod(input, init);
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);

  if (method === 'GET' && url.origin === window.location.origin) {
    const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    const documentId = documentMatch ? decodeURIComponent(documentMatch[1]) : null;
    if (documentId && pendingPlanDocuments.has(documentId)) {
      const statusResponse = await beforeViewBridgeFetch(
        `/api/plan-documents/${encodeURIComponent(documentId)}/status`,
        { method: 'GET' }
      );
      try {
        const status = await statusResponse.clone().json();
        if (terminalDocumentStatus(status.processing_status)) pendingPlanDocuments.delete(documentId);
      } catch {}
      return statusResponse;
    }
  }

  const response = await beforeViewBridgeFetch(input, init);
  try {
    if (url.origin === window.location.origin && method === 'POST' && url.pathname === '/api/documents') {
      const type = requestHeader(input, init, 'x-document-type');
      if (type === 'plan') {
        const payload = await response.clone().json();
        if (payload.documentId) pendingPlanDocuments.add(payload.documentId);
      }
    }
    if (
      url.origin === window.location.origin
      && method === 'POST'
      && /^\/api\/plan-templates\/[^/]+\/generate$/.test(url.pathname)
    ) {
      const payload = await response.clone().json();
      if (payload.generated_document_id) pendingPlanDocuments.add(payload.generated_document_id);
    }
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
