import { meetingsState, $m, ensureMeetingsUi, closeMeetingModal, meetingApi, showMeetingNotice } from './meetings-state.js';
import { activateMeetingsView } from './meetings-view.js';
import { openAgendaModal, openCreateMeetingModal, openEditMeetingModal, openSettingsModal, openSourceModal, renderSources } from './meetings-modals.js';
import { addSourceQuestion, createMeetingFromForm, deleteAgenda, editMeetingFromForm, generateDocument, moveAgenda, saveAgendaForm, saveSettings, uploadMeetingTemplateInput } from './meetings-actions.js';
import { schedulePlanMeetingLinks } from './meetings-plan-links.js';
import { loadMeeting, loadMeetings } from './meetings-data.js';
import { renderMeetingDetail } from './meetings-render.js';

function setProtocolUploadBusy(busy) {
  meetingsState.upload.inProgress = busy;
  const button = $m('#meeting-source-upload-button');
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? 'Обрабатывается…' : 'Загрузить протокол';
}

function protocolIdempotencyKey(file) {
  return encodeURIComponent(`meeting-protocol:${file.name}:${file.size}:${file.lastModified}`);
}

async function findMeetingByDocument(documentId) {
  const data = await meetingApi('/api/meetings?limit=500');
  return (data.items || []).find((item) => item.source_document_id === documentId) || null;
}

async function uploadProtocol(file) {
  if (!file || meetingsState.upload.inProgress) return;
  setProtocolUploadBusy(true);
  showMeetingNotice(`Сохраняется «${file.name}»…`);
  try {
    const response = await meetingApi('/api/documents', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        'x-document-type': 'protocol',
        'idempotency-key': protocolIdempotencyKey(file)
      },
      body: file
    });
    meetingsState.upload.documentId = response.documentId;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const document = await meetingApi(`/api/documents/${encodeURIComponent(response.documentId)}`);
      if (['processed', 'needs_review', 'failed'].includes(document.processing_status)) {
        if (document.processing_status === 'failed') {
          throw new Error('Протокол сохранён, но автоматический разбор завершился ошибкой. Исходный файл доступен в документах.');
        }
        const created = await findMeetingByDocument(response.documentId);
        if (!created) {
          await loadMeetings();
          showMeetingNotice('Файл сохранён. Заседание не удалось распознать автоматически — исходник доступен в документах.');
          return;
        }
        await loadMeetings(created.id);
        showMeetingNotice(document.processing_status === 'needs_review'
          ? 'Заседание создано. Исправьте только отмеченные неоднозначности.'
          : 'Заседание и повестка созданы автоматически.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const created = await findMeetingByDocument(response.documentId);
    if (created) {
      await loadMeetings(created.id);
      showMeetingNotice('Заседание создано. Фоновая обработка документов продолжается.');
    } else {
      await loadMeetings();
      showMeetingNotice('Протокол принят. Обработка продолжается на сервере.');
    }
  } finally {
    setProtocolUploadBusy(false);
    const input = $m('#meeting-source-upload-input');
    if (input) input.value = '';
  }
}

document.addEventListener('click', (event) => {
  const meetingNav = event.target.closest('[data-view="meetings"]');
  if (meetingNav) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activateMeetingsView();
    return;
  }
  if (event.target.closest('#meeting-source-upload-button')) {
    $m('#meeting-source-upload-input')?.click();
    return;
  }
  if (event.target.closest('[data-open-meeting-settings]') || event.target.closest('#meeting-settings-button')) return openSettingsModal();
  if (event.target.closest('#meeting-create-button')) return openCreateMeetingModal();
  if (event.target.closest('[data-close-meeting-modal]') || event.target.id === 'meeting-modal-backdrop') return closeMeetingModal();
  const linked = event.target.closest('[data-open-linked-meeting]');
  if (linked) {
    activateMeetingsView(linked.dataset.openLinkedMeeting);
    return;
  }
  const card = event.target.closest('[data-meeting-id]');
  if (card) return loadMeeting(card.dataset.meetingId).catch((error) => showMeetingNotice(error.message));
  if (event.target.closest('[data-edit-meeting]')) return openEditMeetingModal();
  if (event.target.closest('[data-add-manual-question]')) return openAgendaModal();
  if (event.target.closest('[data-add-source-question]')) return openSourceModal().catch((error) => showMeetingNotice(error.message));
  const source = event.target.closest('[data-source-kind][data-source-id]');
  if (source) return addSourceQuestion(source).catch((error) => showMeetingNotice(error.message));
  const edit = event.target.closest('[data-agenda-edit]');
  if (edit) {
    const id = edit.closest('[data-agenda-item]')?.dataset.agendaItem;
    const item = meetingsState.meeting?.agenda?.find((candidate) => candidate.id === id);
    if (item) openAgendaModal(item);
    return;
  }
  const move = event.target.closest('[data-agenda-move]');
  if (move) return moveAgenda(move).catch((error) => showMeetingNotice(error.message));
  if (event.target.closest('[data-delete-agenda]')) return deleteAgenda().catch((error) => showMeetingNotice(error.message));
  if (event.target.closest('[data-generate-protocol]')) return generateDocument('protocol').catch((error) => showMeetingNotice(error.message));
  if (event.target.closest('[data-generate-extract]')) return generateDocument('extract').catch((error) => showMeetingNotice(error.message));
}, true);

document.addEventListener('change', (event) => {
  const sourceInput = event.target.closest('#meeting-source-upload-input');
  if (sourceInput) {
    uploadProtocol(sourceInput.files?.[0]).catch((error) => showMeetingNotice(error.message));
    return;
  }
  const templateInput = event.target.closest('[data-meeting-template-upload]');
  if (templateInput) {
    uploadMeetingTemplateInput(templateInput).catch((error) => showMeetingNotice(error.message));
    return;
  }
  const checkbox = event.target.closest('[data-extract-item]');
  if (!checkbox) return;
  if (checkbox.checked) meetingsState.selectedForExtract.add(checkbox.dataset.extractItem);
  else meetingsState.selectedForExtract.delete(checkbox.dataset.extractItem);
  renderMeetingDetail();
}, true);

document.addEventListener('input', (event) => {
  if (event.target.id === 'meeting-source-search') renderSources(event.target.value);
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id === 'meeting-settings-form') {
    event.preventDefault();
    saveSettings(event.target).catch((error) => showMeetingNotice(error.message));
  }
  if (event.target.id === 'meeting-create-form') {
    event.preventDefault();
    createMeetingFromForm(event.target).catch((error) => showMeetingNotice(error.message));
  }
  if (event.target.id === 'meeting-edit-form') {
    event.preventDefault();
    editMeetingFromForm(event.target).catch((error) => showMeetingNotice(error.message));
  }
  if (event.target.id === 'agenda-item-form') {
    event.preventDefault();
    saveAgendaForm(event.target).catch((error) => showMeetingNotice(error.message));
  }
}, true);

window.addEventListener('kafedra:view-changed', (event) => {
  if (event.detail?.view !== 'meetings') meetingsState.active = false;
  if (event.detail?.view === 'plans') schedulePlanMeetingLinks();
});

const planDetail = $m('#plan-detail');
if (planDetail) {
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes].some((node) =>
      node.nodeType === 1 && (node.matches?.('[data-plan-item-row]') || node.querySelector?.('[data-plan-item-row]'))
    ))) schedulePlanMeetingLinks();
  }).observe(planDetail, { childList: true, subtree: true });
}

ensureMeetingsUi();
window.kafedraOpenMeeting = (meetingId) => activateMeetingsView(meetingId);
