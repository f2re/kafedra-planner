import { meetingsState, $m, escMeeting, meetingDate, settingsReady } from './meetings-state.js';

export function renderSettingsSummary() {
  const target = $m('#meeting-settings-summary');
  if (!target) return;
  const s = meetingsState.settings;
  if (!settingsReady()) {
    target.innerHTML = '<div><strong>Шаблоны нужны только для новых документов</strong><span>Загруженный протокол создаёт заседание без настройки шаблонов. Настройте их, когда понадобится формировать новые протоколы и выписки.</span></div><button type="button" class="text-button" data-open-meeting-settings>Настроить</button>';
    target.classList.add('needs-setup');
    return;
  }
  target.classList.remove('needs-setup');
  target.innerHTML = `<div><strong>Параметры кафедры</strong><span>Кворум ${Number(s.quorum)} · ${escMeeting(s.chairperson_name)} — председатель · ${escMeeting(s.secretary_name)} — секретарь</span></div><button type="button" class="text-button" data-open-meeting-settings>Изменить</button>`;
}

function meetingStateLabel(meeting) {
  if (meeting.status === 'confirmed') return 'протокол сформирован';
  if (meeting.status === 'confirmed_auto') return 'загружен из документа';
  if (meeting.status === 'proposed') return 'нужно уточнить поля';
  return 'создано вручную';
}

function meetingCard(meeting) {
  return `<button class="meeting-card ${meeting.id === meetingsState.selectedMeetingId ? 'active' : ''}" type="button" data-meeting-id="${escMeeting(meeting.id)}">
    <span class="meeting-card-date">${escMeeting(meetingDate(meeting.meeting_date))}</span>
    <strong>Протокол №${escMeeting(meeting.protocol_number || '—')}</strong>
    <span>${escMeeting(meeting.title)}</span>
    <small>${Number(meeting.agenda_count || 0)} вопрос(а/ов) · ${escMeeting(meetingStateLabel(meeting))}</small>
  </button>`;
}

export function renderMeetingList() {
  const target = $m('#meetings-list');
  if (!target) return;
  target.innerHTML = meetingsState.meetings.length
    ? meetingsState.meetings.map(meetingCard).join('')
    : '<div class="empty-state">Заседаний пока нет. Загрузите готовый протокол или создайте заседание вручную.</div>';
}

function agendaPreview(item) {
  const pieces = [
    item.heard_text ? `<div><b>Слушали</b><span>${escMeeting(item.heard_text)}</span></div>` : null,
    item.discussed_text ? `<div><b>Обсудили</b><span>${escMeeting(item.discussed_text)}</span></div>` : null,
    item.decision_text ? `<div><b>Решили</b><span>${escMeeting(item.decision_text)}</span></div>` : null
  ].filter(Boolean).join('');
  return pieces || '<span class="agenda-empty-copy">Содержание вопроса ещё не заполнено.</span>';
}

function agendaItemHtml(item, index, total) {
  const checked = meetingsState.selectedForExtract.has(item.id) ? 'checked' : '';
  return `<article class="agenda-item" data-agenda-item="${escMeeting(item.id)}">
    <label class="agenda-select" title="Включить вопрос в выписку"><input type="checkbox" data-extract-item="${escMeeting(item.id)}" ${checked}><span>${Number(item.item_no)}</span></label>
    <div class="agenda-copy">
      ${item.source_label ? `<small class="agenda-source">Из источника: ${escMeeting(item.source_label)}</small>` : '<small class="agenda-source">Добавлен вручную</small>'}
      <h4>${escMeeting(item.title)}</h4>
      <div class="agenda-sections">${agendaPreview(item)}</div>
    </div>
    <div class="agenda-actions">
      <button type="button" class="icon-button" data-agenda-move="up" ${index === 0 ? 'disabled' : ''} aria-label="Поднять вопрос">↑</button>
      <button type="button" class="icon-button" data-agenda-move="down" ${index === total - 1 ? 'disabled' : ''} aria-label="Опустить вопрос">↓</button>
      <button type="button" class="secondary-button agenda-edit" data-agenda-edit>Изменить</button>
    </div>
  </article>`;
}

function documentHtml(document) {
  const label = document.document_kind === 'extract' ? 'Выписка' : 'Протокол';
  const questions = document.document_kind === 'extract' ? ` · вопросы ${escMeeting(document.question_numbers)}` : '';
  const template = document.template_display_name
    ? `<small>Шаблон: ${escMeeting(document.template_display_name)} · версия ${Number(document.template_version_no || 1)}</small>`
    : '';
  return `<a class="meeting-document" href="/api/documents/${encodeURIComponent(document.document_id)}/content?variant=original" target="_blank" rel="noopener">
    <span><strong>${label}${questions}</strong><small>${escMeeting(document.original_name)}</small>${template}</span><span aria-hidden="true">↓</span>
  </a>`;
}

export function renderMeetingDetail() {
  const target = $m('#meeting-detail');
  if (!target) return;
  const meeting = meetingsState.meeting;
  if (!meeting) {
    target.innerHTML = '<div class="empty-state">Выберите заседание слева или загрузите протокол.</div>';
    return;
  }
  const agenda = meeting.agenda || [];
  const selectedCount = [...meetingsState.selectedForExtract].filter((id) => agenda.some((item) => item.id === id)).length;
  const hasSource = Boolean(meeting.source_document_id);
  const canGenerate = settingsReady();
  target.innerHTML = `
    <div class="meeting-detail-head">
      <div><span class="meeting-kicker">${escMeeting(meetingDate(meeting.meeting_date))}</span><h3>Протокол №${escMeeting(meeting.protocol_number || '—')}</h3><p>${escMeeting(meeting.title)}</p></div>
      <div class="meetings-heading-actions">
        ${hasSource ? `<a class="secondary-button" href="/api/documents/${encodeURIComponent(meeting.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Исходный документ</a>` : ''}
        <button type="button" class="secondary-button" data-edit-meeting>Изменить</button>
      </div>
    </div>
    ${hasSource ? `<div class="meeting-settings-summary"><div><strong>Создано из протокола</strong><span>${escMeeting(meeting.source_original_name || 'Исходный файл сохранён')}. Автоматически заполненные поля можно исправить на месте.</span></div></div>` : ''}
    <div class="meeting-meta-strip">
      <span><b>Кворум</b> ${meeting.quorum_required || '—'}</span>
      <span><b>Председатель</b> ${escMeeting(meeting.chairperson_raw || '—')}</span>
      <span><b>Секретарь</b> ${escMeeting(meeting.secretary_raw || '—')}</span>
    </div>
    <div class="agenda-head">
      <div><h3>Повестка</h3><p>Вопросы нумеруются автоматически. Отметьте нужные пункты слева, чтобы сформировать выписку.</p></div>
      <div><button type="button" class="secondary-button" data-add-manual-question>Добавить вопрос</button><button type="button" class="primary-button" data-add-source-question>Из задач и планов</button></div>
    </div>
    <div class="agenda-list">${agenda.length ? agenda.map((item, index) => agendaItemHtml(item, index, agenda.length)).join('') : '<div class="empty-state">Повестка не распознана. Добавьте вопрос вручную — исходный протокол уже сохранён.</div>'}</div>
    <div class="meeting-document-actions">
      <div><strong>Документы заседания</strong><span>${hasSource ? 'Исходный протокол уже сохранён. Шаблоны нужны только для формирования нового файла.' : 'Протокол содержит всю повестку. Выписка — только отмеченные вопросы с исходными номерами.'}</span></div>
      <div><button type="button" class="secondary-button" data-generate-protocol ${agenda.length && canGenerate ? '' : 'disabled'}>Сформировать протокол</button><button type="button" class="primary-button" data-generate-extract ${selectedCount && canGenerate ? '' : 'disabled'}>Выписка · ${selectedCount}</button></div>
    </div>
    <div class="meeting-documents">${(meeting.documents || []).length ? meeting.documents.map(documentHtml).join('') : '<span class="meeting-documents-empty">Новых сформированных документов пока нет.</span>'}</div>
  `;
}
