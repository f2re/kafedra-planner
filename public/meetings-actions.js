import { meetingsState, $m, meetingApi, closeMeetingModal, showMeetingNotice } from './meetings-state.js';
import { loadMeeting, loadMeetings } from './meetings-data.js';
import { renderMeetingDetail, renderSettingsSummary } from './meetings-render.js';
import { invalidatePlanMeetingLink } from './meetings-plan-links.js';
import { openAgendaModal, templateOptions } from './meetings-modals.js';

export async function uploadMeetingTemplateInput(input) {
  const file = input.files?.[0];
  if (!file) return;
  const kind = input.dataset.meetingTemplateUpload;
  if (!['protocol', 'extract'].includes(kind)) return;
  const response = await window.fetch(`/api/meeting-templates?kind=${encodeURIComponent(kind)}`, {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'x-file-name': encodeURIComponent(file.name)
    },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  const settingsData = await meetingApi('/api/meeting-settings');
  meetingsState.resources = settingsData.resources || meetingsState.resources;
  const form = $m('#meeting-settings-form');
  if (form) {
    const name = kind === 'protocol' ? 'protocolTemplateVersionId' : 'extractTemplateVersionId';
    const select = form.elements.namedItem(name);
    if (select) {
      select.innerHTML = templateOptions(data.version_id);
      select.value = data.version_id;
      // Программный выбор должен пройти тот же локальный UI-путь, что ручной.
      // Событие не загружает файл повторно: обработчик upload привязан только к
      // input[data-meeting-template-upload], а редактор профиля слушает select.
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  input.value = '';
  showMeetingNotice(data.duplicateRequest ? 'Этот шаблон уже загружен — выбран существующий файл.' : 'DOCX-шаблон загружен и выбран.');
}

export async function saveSettings(form) {
  const data = Object.fromEntries(new FormData(form));
  const payload = {
    protocolTemplateVersionId: data.protocolTemplateVersionId,
    extractTemplateVersionId: data.extractTemplateVersionId,
    quorum: Number(data.quorum),
    chairpersonPersonId: data.chairpersonPersonId,
    secretaryPersonId: data.secretaryPersonId
  };
  const result = await meetingApi('/api/meeting-settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  meetingsState.settings = result.settings;
  meetingsState.resources = result.resources;
  closeMeetingModal();
  renderSettingsSummary();
  showMeetingNotice('Параметры заседаний сохранены.');
}

export async function createMeetingFromForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const created = await meetingApi('/api/meetings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
  });
  closeMeetingModal();
  meetingsState.selectedForExtract.clear();
  await loadMeetings(created.id);
  showMeetingNotice('Заседание создано. Добавьте вопросы повестки.');
}

export async function editMeetingFromForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const updated = await meetingApi(`/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
  });
  closeMeetingModal();
  meetingsState.meeting = updated;
  await loadMeetings(updated.id);
  showMeetingNotice('Заседание обновлено.');
}

export async function saveAgendaForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const itemId = form.dataset.agendaId;
  const path = itemId
    ? `/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}/agenda/${encodeURIComponent(itemId)}`
    : `/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}/agenda`;
  const updated = await meetingApi(path, {
    method: itemId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
  });
  meetingsState.meeting = updated;
  closeMeetingModal();
  await loadMeetings(meetingsState.selectedMeetingId);
  showMeetingNotice(itemId ? 'Вопрос обновлён.' : 'Вопрос добавлен в повестку.');
}

export async function addSourceQuestion(button) {
  const updated = await meetingApi(`/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}/agenda`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceKind: button.dataset.sourceKind, sourceId: button.dataset.sourceId })
  });
  const newest = (updated.agenda || [])[updated.agenda.length - 1];
  invalidatePlanMeetingLink(button.dataset.sourceKind === 'plan_item' ? button.dataset.sourceId : null);
  meetingsState.meeting = updated;
  closeMeetingModal();
  await loadMeetings(meetingsState.selectedMeetingId);
  if (newest) openAgendaModal(meetingsState.meeting.agenda.find((item) => item.id === newest.id) || newest);
  showMeetingNotice('Вопрос добавлен из исходной задачи. Проверьте формулировку и заполните итог заседания.');
}

export async function deleteAgenda() {
  const form = $m('#agenda-item-form');
  const itemId = form?.dataset.agendaId;
  if (!itemId) return;
  const item = meetingsState.meeting?.agenda?.find((candidate) => candidate.id === itemId);
  if (!window.confirm(`Удалить вопрос №${item?.item_no || ''}? Остальные номера будут сдвинуты автоматически.`)) return;
  invalidatePlanMeetingLink(item?.source_kind === 'plan_item' ? item.source_id : null);
  const updated = await meetingApi(`/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}/agenda/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  meetingsState.meeting = updated;
  meetingsState.selectedForExtract.delete(itemId);
  closeMeetingModal();
  await loadMeetings(meetingsState.selectedMeetingId);
  showMeetingNotice('Вопрос удалён, нумерация повестки обновлена.');
}

export async function moveAgenda(button) {
  const card = button.closest('[data-agenda-item]');
  const updated = await meetingApi(`/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}/agenda/${encodeURIComponent(card.dataset.agendaItem)}/move`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ direction: button.dataset.agendaMove })
  });
  meetingsState.meeting = updated;
  renderMeetingDetail();
}

export async function generateDocument(kind) {
  const itemIds = kind === 'extract' ? [...meetingsState.selectedForExtract] : undefined;
  const generated = await meetingApi(`/api/meetings/${encodeURIComponent(meetingsState.selectedMeetingId)}/documents`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, itemIds })
  });
  await loadMeeting(meetingsState.selectedMeetingId, false);
  showMeetingNotice(generated.duplicateRequest
    ? 'Такой документ уже был сформирован — показан существующий файл.'
    : kind === 'extract' ? 'Выписка сформирована.' : 'Протокол сформирован.');
}
