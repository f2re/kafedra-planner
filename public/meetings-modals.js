import { meetingsState, $m, escMeeting, meetingApi, openMeetingModal, settingsReady, showMeetingNotice } from './meetings-state.js';

function userOptions(selected) {
  return '<option value="">Выберите сотрудника</option>' + (meetingsState.resources.users || []).map((user) =>
    `<option value="${escMeeting(user.id)}" ${user.id === selected ? 'selected' : ''}>${escMeeting(user.display_name)}${user.position ? ` · ${escMeeting(user.position)}` : ''}</option>`
  ).join('');
}

export function templateOptions(selected) {
  return '<option value="">Выберите DOCX</option>' + (meetingsState.resources.templates || []).map((template) => {
    const label = [template.title, template.original_name].filter(Boolean).join(' · ');
    return `<option value="${escMeeting(template.version_id)}" ${template.version_id === selected ? 'selected' : ''}>${escMeeting(label || 'DOCX-шаблон')}</option>`;
  }).join('');
}

function templateUploadField(kind, title, selected) {
  const name = kind === 'protocol' ? 'protocolTemplateVersionId' : 'extractTemplateVersionId';
  return `<div class="meeting-template-field">
    <label class="field"><span>${escMeeting(title)}</span><select name="${name}" required>${templateOptions(selected)}</select></label>
    <label class="meeting-template-upload secondary-button">Загрузить DOCX<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-meeting-template-upload="${kind}" hidden></label>
  </div>`;
}

export function openSettingsModal() {
  const s = meetingsState.settings || {};
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Параметры кафедры</span><h3 id="meeting-settings-title">Настройки заседаний</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-settings-form" class="meeting-modal-body">
      <div class="meeting-form-two">
        ${templateUploadField('protocol', 'Шаблон протокола', s.protocol_template_version_id)}
        ${templateUploadField('extract', 'Шаблон выписки', s.extract_template_version_id)}
      </div>
      <p class="meeting-helper">В обоих DOCX нужен отдельный абзац <code>{{AGENDA}}</code>. Дополнительно можно использовать <code>{{PROTOCOL_NUMBER}}</code>, <code>{{MEETING_DATE}}</code>, <code>{{CHAIRPERSON}}</code>, <code>{{SECRETARY}}</code>, <code>{{QUORUM}}</code> и <code>{{DOCUMENT_KIND}}</code>.</p>
      <div class="meeting-form-three">
        <label class="field"><span>Кворум</span><input name="quorum" type="number" min="1" step="1" value="${escMeeting(s.quorum || '')}" required></label>
        <label class="field"><span>Председатель</span><select name="chairpersonPersonId" required>${userOptions(s.chairperson_person_id)}</select></label>
        <label class="field"><span>Секретарь</span><select name="secretaryPersonId" required>${userOptions(s.secretary_person_id)}</select></label>
      </div>
      ${!(meetingsState.resources.templates || []).length ? '<div class="meeting-callout">Загрузите два DOCX-шаблона прямо здесь. В каждом должен быть отдельный абзац {{AGENDA}}.</div>' : ''}
      ${!(meetingsState.resources.users || []).length ? '<div class="meeting-callout">Список сотрудников пуст. Добавьте пользователей/сотрудников кафедры.</div>' : ''}
      <div class="meeting-modal-actions"><span class="spacer"></span><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>
  `);
}

export function openCreateMeetingModal() {
  if (!settingsReady()) {
    showMeetingNotice('Сначала заполните параметры заседаний.');
    return openSettingsModal();
  }
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Новое заседание</span><h3>Дата и номер протокола</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-create-form" class="meeting-modal-body">
      <div class="meeting-form-two"><label class="field"><span>Дата</span><input name="meetingDate" type="date" value="${date}" required></label><label class="field"><span>Номер протокола</span><input name="protocolNumber" autocomplete="off" required placeholder="Например, 7"></label></div>
      <label class="field"><span>Название</span><input name="title" value="Заседание кафедры" required></label>
      <p class="meeting-helper">Председатель, секретарь, кворум и шаблоны копируются из настроек и сохраняются вместе с заседанием.</p>
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Создать</button></div>
    </form>
  `);
}

export function openEditMeetingModal() {
  const meeting = meetingsState.meeting;
  if (!meeting) return;
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Заседание</span><h3>Дата и номер</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-edit-form" class="meeting-modal-body">
      <div class="meeting-form-two"><label class="field"><span>Дата</span><input name="meetingDate" type="date" value="${escMeeting(meeting.meeting_date)}" required></label><label class="field"><span>Номер протокола</span><input name="protocolNumber" value="${escMeeting(meeting.protocol_number)}" required></label></div>
      <label class="field"><span>Название</span><input name="title" value="${escMeeting(meeting.title)}" required></label>
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>
  `);
}

export function openAgendaModal(item = null) {
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Вопрос ${item ? `№${Number(item.item_no)}` : ''}</span><h3>${item ? 'Содержание вопроса' : 'Новый вопрос повестки'}</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="agenda-item-form" data-agenda-id="${escMeeting(item?.id || '')}" class="meeting-modal-body">
      ${item?.source_label ? `<div class="meeting-source-note">Источник: <strong>${escMeeting(item.source_label)}</strong></div>` : ''}
      <label class="field"><span>Вопрос повестки</span><textarea name="title" rows="2" required placeholder="Например: О рассмотрении научной статьи…">${escMeeting(item?.title || '')}</textarea></label>
      <label class="field"><span>Слушали</span><textarea name="heardText" rows="3" placeholder="Кого заслушали и по существу вопроса">${escMeeting(item?.heard_text || '')}</textarea></label>
      <label class="field"><span>Обсудили</span><textarea name="discussedText" rows="3" placeholder="При необходимости">${escMeeting(item?.discussed_text || '')}</textarea></label>
      <label class="field"><span>Решили</span><textarea name="decisionText" rows="4" placeholder="Итоговое решение по этому вопросу">${escMeeting(item?.decision_text || '')}</textarea></label>
      <div class="meeting-modal-actions">${item ? '<button type="button" class="danger-text-button" data-delete-agenda>Удалить вопрос</button>' : ''}<span class="spacer"></span><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>
  `);
}

export async function openSourceModal() {
  const data = await meetingApi('/api/meeting-agenda-sources?limit=700');
  meetingsState.sources = data.items || [];
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Повестка</span><h3>Добавить из задач и планов</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <div class="meeting-modal-body">
      <label class="meeting-source-search"><span aria-hidden="true">⌕</span><input id="meeting-source-search" type="search" placeholder="Найдите статью, задачу или пункт плана"></label>
      <div id="meeting-source-list" class="meeting-source-list"></div>
    </div>
  `);
  renderSources('');
}

export function renderSources(query) {
  const target = $m('#meeting-source-list');
  if (!target) return;
  const q = String(query || '').trim().toLocaleLowerCase('ru-RU');
  const items = meetingsState.sources.filter((source) => !q || [source.title, source.questionTitle, source.label, source.meta].join(' ').toLocaleLowerCase('ru-RU').includes(q));
  target.innerHTML = items.length ? items.map((source) => `
    <button type="button" class="meeting-source-card" data-source-kind="${escMeeting(source.kind)}" data-source-id="${escMeeting(source.id)}">
      <span><strong>${escMeeting(source.questionTitle)}</strong><small>${escMeeting(source.label)}${source.meta ? ` · ${escMeeting(source.meta)}` : ''}</small></span><span aria-hidden="true">＋</span>
    </button>`).join('') : '<div class="empty-state">Подходящих открытых задач и пунктов планов нет.</div>';
}

