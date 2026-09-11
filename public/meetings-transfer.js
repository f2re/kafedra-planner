import { meetingsState, $m, escMeeting, meetingApi, meetingDate, openMeetingModal, closeMeetingModal, showMeetingNotice, selectMeetingYear } from './meetings-state.js';
import { loadMeetings } from './meetings-data.js';
import { invalidatePlanMeetingLink, schedulePlanMeetingLinks } from './meetings-plan-links.js';

export function openAgendaTransferModal(item) {
  if (!item || !meetingsState.meeting) return;
  const sourceMeetingId = meetingsState.meeting.id;
  const requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Вопрос №${Number(item.item_no)}</span><h3 id="meeting-transfer-title">Перенести в другое заседание</h3></div><button type="button" class="icon-button" data-close-meeting-modal aria-label="Закрыть">×</button></header>
    <form id="meeting-transfer-form" class="meeting-modal-body">
      <p class="meeting-helper">${escMeeting(item.title)}</p>
      <label class="field"><span>Поиск по номеру, дате или названию</span><input name="query" type="search" autocomplete="off" placeholder="Например, 2027-01 или номер протокола"></label>
      <label class="field"><span>Заседание назначения · все годы</span><select name="targetMeetingId" required><option value="">Загрузка заседаний…</option></select></label>
      <p class="meeting-helper" data-transfer-hint>Вопрос добавится в конец повестки. Решения, сроки и связь с планом сохранятся. Старые документы не изменятся.</p>
      <p class="meeting-helper" data-transfer-error role="alert" hidden></p>
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><span class="spacer"></span><button type="submit" class="primary-button" disabled>Перенести вопрос</button></div>
    </form>
  `);
  $m('#meeting-modal').setAttribute('aria-labelledby', 'meeting-transfer-title');
  const form = $m('#meeting-transfer-form');
  const search = form.elements.namedItem('query');
  const select = form.elements.namedItem('targetMeetingId');
  const submit = form.querySelector('[type="submit"]');
  const errorField = form.querySelector('[data-transfer-error]');
  const hint = form.querySelector('[data-transfer-hint]');
  let serial = 0;
  let timer;
  let pending = false;
  let completed = false;
  function showError(message) { errorField.textContent = message; errorField.hidden = !message; }
  async function searchMeetings() {
    const request = ++serial;
    const selected = select.value;
    try {
      const data = await meetingApi(`/api/meetings?limit=100&q=${encodeURIComponent(search.value.trim())}`);
      if (request !== serial || !form.isConnected || pending || completed) return;
      const items = (data.items || []).filter((meeting) => meeting.id !== sourceMeetingId);
      select.innerHTML = `<option value="">${items.length ? 'Выберите заседание' : 'Других заседаний не найдено'}</option>` + items.map((meeting) =>
        `<option value="${escMeeting(meeting.id)}">${escMeeting(meetingDate(meeting.meeting_date))} · №${escMeeting(meeting.protocol_number || '—')} · ${Number(meeting.agenda_count || 0)} вопросов</option>`
      ).join('');
      if (items.some((meeting) => meeting.id === selected)) select.value = selected;
      submit.disabled = !select.value;
      if (!items.length) hint.textContent = 'Уточните поиск. Если нужного заседания ещё нет, создайте его кнопкой «Новое заседание» и повторите перенос.';
      else hint.textContent = `${data.items.length === 100 ? 'Показаны первые 100 заседаний; уточните поиск. ' : ''}Вопрос добавится в конец повестки. Решения, сроки и связь с планом сохранятся. Старые документы не изменятся.`;
      showError('');
    } catch (error) { if (request === serial && form.isConnected) showError(error.message); }
  }
  search.addEventListener('input', () => {
    ++serial;
    clearTimeout(timer);
    timer = setTimeout(searchMeetings, 200);
  });
  select.addEventListener('change', () => { submit.disabled = !select.value || pending || completed; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || completed || !select.value) return;
    pending = true;
    ++serial;
    clearTimeout(timer);
    submit.disabled = true;
    search.disabled = true;
    select.disabled = true;
    submit.textContent = 'Перенос…';
    showError('');
    try {
      const result = await meetingApi(`/api/meetings/${encodeURIComponent(sourceMeetingId)}/agenda/${encodeURIComponent(item.id)}/transfer`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetMeetingId: select.value, requestId })
      });
      completed = true;
      for (const meeting of [result.sourceMeeting, result.targetMeeting]) {
        for (const question of meeting.agenda || []) {
          if (question.source_kind === 'plan_item') invalidatePlanMeetingLink(question.source_id);
        }
      }
      if (item.source_kind === 'plan_item') invalidatePlanMeetingLink(item.source_id);
      schedulePlanMeetingLinks();
      meetingsState.selectedForExtract.clear();
      const destination = result.currentMeetingId === result.targetMeeting.id ? result.targetMeeting
        : await meetingApi(`/api/meetings/${encodeURIComponent(result.currentMeetingId)}`);
      selectMeetingYear(destination.meeting_date);
      closeMeetingModal();
      await loadMeetings(destination.id);
      window.dispatchEvent(new CustomEvent('kafedra:meeting-updated', { detail: { meetingId: destination.id } }));
      showMeetingNotice(`Вопрос перенесён в протокол №${destination.protocol_number || '—'}. Решения и сроки сохранены.`);
    } catch (error) {
      if (completed) {
        closeMeetingModal();
        showMeetingNotice('Перенос сохранён. Не удалось обновить экран — откройте заседание повторно.');
      } else showError(error.message);
    } finally {
      pending = false;
      search.disabled = completed;
      select.disabled = completed;
      submit.disabled = completed || !select.value;
      submit.textContent = 'Перенести вопрос';
    }
  });
  searchMeetings();
  requestAnimationFrame(() => search.focus());
}
