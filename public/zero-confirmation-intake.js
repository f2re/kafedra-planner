const INTAKE_OBJECT_TIMEOUT_MS = 60_000;
const INTAKE_POLL_MS = 650;
const pendingDocuments = new Map();
const processedDocuments = new Set();
const intakeFetch = window.fetch.bind(window);

function requestUrl(input) {
  try {
    return new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  } catch {
    return null;
  }
}

function requestMethod(input, init) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function responseDocumentId(payload) {
  return String(
    payload?.documentId
      || payload?.document_id
      || payload?.document?.id
      || payload?.item?.id
      || payload?.id
      || ''
  ).trim();
}

function activeView() {
  return document.querySelector('[data-view-panel].active')?.dataset.viewPanel || null;
}

function sourceDocumentId(item) {
  return String(
    item?.source_document_id
      || item?.sourceDocumentId
      || item?.origin_document_id
      || item?.originDocumentId
      || item?.source_document_version?.document_id
      || item?.sourceDocumentVersion?.documentId
      || item?.source_document?.id
      || item?.sourceDocument?.id
      || ''
  ).trim();
}

function meetingDocumentIds(item) {
  const ids = new Set();
  const add = (value) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  add(sourceDocumentId(item));
  add(item?.protocol_document_id);
  add(item?.protocolDocumentId);
  for (const document of item?.documents || item?.meeting_documents || []) {
    add(document?.document_id || document?.documentId || document?.id);
  }
  return ids;
}

async function getJson(path) {
  const response = await intakeFetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
}

function rows(payload) {
  return Array.isArray(payload) ? payload : payload?.items || payload?.plans || payload?.meetings || [];
}

async function findPlan(documentId) {
  const payload = await getJson('/api/plans?status=all&limit=1000');
  return rows(payload).find((item) => sourceDocumentId(item) === documentId) || null;
}

async function findMeeting(documentId) {
  const payload = await getJson('/api/meetings?status=all&limit=1000');
  return rows(payload).find((item) => meetingDocumentIds(item).has(documentId)) || null;
}

function ensureNotice() {
  let notice = document.querySelector('#intake-object-notice');
  if (notice) return notice;
  notice = document.createElement('div');
  notice.id = 'intake-object-notice';
  notice.className = 'intake-object-notice hidden';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  document.body.append(notice);
  if (!document.querySelector('#intake-object-notice-styles')) {
    const style = document.createElement('style');
    style.id = 'intake-object-notice-styles';
    style.textContent = `
      .intake-object-notice{position:fixed;right:20px;bottom:20px;z-index:1200;max-width:min(420px,calc(100vw - 32px));padding:12px 14px;border-radius:14px;background:rgba(20,24,31,.94);color:#fff;box-shadow:0 12px 34px rgba(0,0,0,.24);font-size:14px;line-height:1.35}
      .intake-object-notice.hidden{display:none}
      @media (max-width:720px){.intake-object-notice{left:16px;right:16px;bottom:78px;max-width:none}}
    `;
    document.head.append(style);
  }
  return notice;
}

function announce(message, timeout = 5200) {
  const notice = ensureNotice();
  notice.textContent = message;
  notice.classList.remove('hidden');
  clearTimeout(notice._hideTimer);
  notice._hideTimer = setTimeout(() => notice.classList.add('hidden'), timeout);
}

async function openPlan(plan) {
  const id = String(plan?.id || '').trim();
  if (!id) return false;
  window.kafedraSetView?.('plans');
  await window.loadPlans?.();
  if (window.plansState && 'selectedPlanId' in window.plansState) {
    window.plansState.selectedPlanId = id;
    await window.loadPlans?.();
  }
  const selector = `[data-plan-id="${CSS.escape(id)}"]`;
  const card = document.querySelector(selector);
  if (card) card.click();
  window.kafedraOpenPlan?.(id);
  announce('План создан и уже открыт. Исправьте только те поля, где автоматика ошиблась.');
  return true;
}

async function openMeeting(meeting) {
  const id = String(meeting?.id || '').trim();
  if (!id) return false;
  window.kafedraSetView?.('meetings');
  await window.loadMeetings?.();
  const card = document.querySelector(`[data-meeting-id="${CSS.escape(id)}"]`);
  if (card) card.click();
  if (typeof window.kafedraOpenMeeting === 'function') await window.kafedraOpenMeeting(id);
  else if (typeof window.showMeeting === 'function') await window.showMeeting(id);
  announce('Заседание создано и уже открыто. Подтверждение импорта не требуется.');
  return true;
}

function dispatchReady(detail) {
  window.dispatchEvent(new CustomEvent('kafedra:intake-object-ready', { detail }));
}

async function resolveDocument(documentId, contextView, startedAt) {
  while (Date.now() - startedAt < INTAKE_OBJECT_TIMEOUT_MS) {
    const [plan, meeting] = await Promise.all([
      findPlan(documentId).catch(() => null),
      findMeeting(documentId).catch(() => null)
    ]);
    if (plan || meeting) {
      processedDocuments.add(documentId);
      pendingDocuments.delete(documentId);
      const kind = plan ? 'plan' : 'meeting';
      const object = plan || meeting;
      dispatchReady({ documentId, kind, objectId: object.id, object });
      const batch = [...pendingDocuments.keys()].length > 0;
      if (!batch) {
        if (kind === 'plan') await openPlan(object);
        else await openMeeting(object);
      } else {
        announce('Документы обработаны. Созданные планы и заседания уже доступны в рабочих разделах.');
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, INTAKE_POLL_MS));
  }
  pendingDocuments.delete(documentId);
  dispatchReady({ documentId, kind: null, objectId: null, timedOut: true });
  if (['plans', 'meetings'].includes(contextView)) {
    announce('Документ сохранён. Обработка продолжается в фоне; рабочий объект появится автоматически.');
  }
}

function scheduleDocument(documentId, contextView) {
  if (!documentId || processedDocuments.has(documentId) || pendingDocuments.has(documentId)) return;
  const startedAt = Date.now();
  pendingDocuments.set(documentId, { contextView, startedAt });
  setTimeout(() => resolveDocument(documentId, contextView, startedAt).catch(() => {
    pendingDocuments.delete(documentId);
  }), 200);
}

window.fetch = async function zeroConfirmationIntakeFetch(input, init = {}) {
  const method = requestMethod(input, init);
  const url = requestUrl(input);
  const contextView = activeView();
  const response = await intakeFetch(input, init);
  if (
    method === 'POST'
      && url?.origin === window.location.origin
      && url.pathname === '/api/documents'
      && response.ok
  ) {
    response.clone().json().then((payload) => {
      scheduleDocument(responseDocumentId(payload), contextView);
    }).catch(() => {});
  }
  return response;
};

window.kafedraResolveIntakeDocument = (documentId) => {
  scheduleDocument(String(documentId || '').trim(), activeView());
};
