import { meetingsState, $m, escMeeting, meetingDate, settingsReady } from './meetings-state.js';

export function renderSettingsSummary() {
  const target = $m('#meeting-settings-summary');
  if (!target) return;
  const s = meetingsState.settings;
  if (!settingsReady()) {
    target.innerHTML = '<div><strong>Формирование новых документов не настроено</strong><span>Загруженные протоколы уже можно разбирать и исправлять. Шаблоны нужны только для создания протоколов и выписок.</span></div><button type="button" class="text-button" data-open-meeting-settings>Настроить</button>';
    target.classList.add('needs-setup');
    return;
  }
  target.classList.remove('needs-setup');
  target.innerHTML = `<div><strong>Параметры кафедры</strong><span>Кворум ${Number(s.quorum)} · ${escMeeting(s.chairperson_name)} — председатель · ${escMeeting(s.secretary_name)} — секретарь</span></div><button type="button" class="text-button" data-open-meeting-settings>Изменить</button>`;
}

function meetingCard(meeting) {
  const reviews = Number(meeting.open_review_count || 0);
  const state = reviews
    ? `<span class="meeting-review-badge">Проверить · ${reviews}</span>`
    : '<span class="meeting-ready-badge">Готово</span>';
  const outside = meeting.outside_selected_year ? '<small>Открыто из импорта другого года</small>' : '';
  return `<button class="meeting-card ${meeting.id === meetingsState.selectedMeetingId ? 'active' : ''} ${reviews ? 'needs-review' : ''}" type="button" data-meeting-id="${escMeeting(meeting.id)}">
    <span class="meeting-card-date">${escMeeting(meetingDate(meeting.meeting_date))}</span>
    <strong>Протокол №${escMeeting(meeting.protocol_number || '—')}</strong>
    <span>${escMeeting(meeting.title || 'Заседание кафедры')}</span>
    <small>${Number(meeting.agenda_count || 0)} вопрос(а/ов) · ${Number(meeting.document_count || 0)} сформировано</small>
    ${outside}${state}
  </button>`;
}

export function renderMeetingList() {
  const target = $m('#meetings-list');
  if (!target) return;
  target.innerHTML = meetingsState.meetings.length
    ? meetingsState.meetings.map(meetingCard).join('')
    : `<div class="empty-state">За ${escMeeting(meetingsState.selectedYear)} год заседаний пока нет. Загрузите сразу все протоколы или создайте заседание вручную.</div>`;
}

function agendaHasReview(item) {
  return (meetingsState.meeting?.reviews || []).some((review) => {
    const context = review.context || {};
    return context.agendaId === item.id || context.existingAgendaId === item.id
      || context.decisionId === item.decision?.id
      || String(review.issue_code || '').includes(item.id)
      || (item.decision?.id && String(review.issue_code || '').includes(item.decision.id));
  });
}

function agendaPreview(item) {
  const decision = item.decision || item.decisions?.[0] || null;
  const pieces = [
    item.heard_text ? `<div><b>Слушали</b><span>${escMeeting(item.heard_text)}</span></div>` : null,
    item.discussed_text ? `<div><b>Обсудили</b><span>${escMeeting(item.discussed_text)}</span></div>` : null,
    item.decision_text ? `<div><b>Решили</b><span>${escMeeting(item.decision_text)}</span></div>` : null,
    decision?.responsible_raw ? `<div><b>Ответственный</b><span>${escMeeting(decision.responsible_raw)}</span></div>` : null,
    decision?.due_date ? `<div><b>Срок</b><span>${escMeeting(meetingDate(decision.due_date))}</span></div>` : null
  ].filter(Boolean).join('');
  return pieces || '<span class="agenda-empty-copy">Содержание вопроса ещё не заполнено.</span>';
}

function agendaItemHtml(item, index, total) {
  const checked = meetingsState.selectedForExtract.has(item.id) ? 'checked' : '';
  const review = agendaHasReview(item);
  return `<article class="agenda-item ${review ? 'needs-review' : ''}" data-agenda-item="${escMeeting(item.id)}">
    <label class="agenda-select" title="Включить вопрос в выписку"><input type="checkbox" data-extract-item="${escMeeting(item.id)}" ${checked}><span>${Number(item.item_no)}</span></label>
    <div class="agenda-copy">
      ${item.source_label ? `<small class="agenda-source">Из источника: ${escMeeting(item.source_label)}</small>` : '<small class="agenda-source">Добавлен вручную</small>'}
      ${review ? '<span class="agenda-review-label">Нужно проверить</span>' : ''}
      <h4>${escMeeting(item.title)}</h4>
      <div class="agenda-sections">${agendaPreview(item)}</div>
    </div>
    <div class="agenda-actions">
      <button type="button" class="icon-button" data-agenda-move="up" ${index === 0 ? 'disabled' : ''} aria-label="Поднять вопрос">↑</button>
      <button type="button" class="icon-button" data-agenda-move="down" ${index === total - 1 ? 'disabled' : ''} aria-label="Опустить вопрос">↓</button>
      <button type="button" class="secondary-button agenda-edit" data-agenda-edit>${review ? 'Исправить' : 'Изменить'}</button>
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

function reviewSummary(meeting) {
  const reviews = meeting.reviews || [];
  if (!reviews.length) return '';
  return `<section class="meeting-review-summary" aria-label="Что нужно проверить">
    <div><strong>Нужно проверить ${reviews.length}</strong><span>Исходник сохранён. Исправьте только сомнительные поля — остальные данные уже используются.</span></div>
    <ul>${reviews.slice(0, 5).map((review) => `<li>${escMeeting(review.title)}</li>`).join('')}</ul>
    ${meeting.source_document_id ? `<a class="secondary-button" href="/api/documents/${encodeURIComponent(meeting.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Открыть исходник</a>` : ''}
  </section>`;
}

export function renderMeetingDetail() {
  const target = $m('#meeting-detail');
  if (!target) return;
  const meeting = meetingsState.meeting;
  if (!meeting) {
    target.innerHTML = '<div class="empty-state">Выберите заседание слева.</div>';
    return;
  }
  const agenda = meeting.agenda || [];
  const selectedCount = [...meetingsState.selectedForExtract].filter((id) => agenda.some((item) => item.id === id)).length;
  const hasReviews = Number(meeting.open_review_count || 0) > 0;
  target.innerHTML = `
    <div class="meeting-detail-head">
      <div><span class="meeting-kicker">${escMeeting(meetingDate(meeting.meeting_date))}</span><h3>Протокол №${escMeeting(meeting.protocol_number || '—')}</h3><p>${escMeeting(meeting.title || 'Заседание кафедры')}</p></div>
      <button type="button" class="${hasReviews ? 'primary-button' : 'secondary-button'}" data-edit-meeting>${hasReviews ? 'Исправить реквизиты' : 'Изменить'}</button>
    </div>
    ${reviewSummary(meeting)}
    <div class="meeting-meta-strip">
      <span><b>Кворум</b> ${meeting.quorum_required || '—'}</span>
      <span><b>Председатель</b> ${escMeeting(meeting.chairperson_raw || '—')}</span>
      <span><b>Секретарь</b> ${escMeeting(meeting.secretary_raw || '—')}</span>
      ${meeting.source_document_id ? `<a href="/api/documents/${encodeURIComponent(meeting.source_document_id)}/content?variant=original" target="_blank" rel="noopener"><b>Источник</b> ${escMeeting(meeting.source_original_name || meeting.source_document_title || 'Открыть')}</a>` : ''}
    </div>
    <div class="agenda-head">
      <div><h3>Повестка</h3><p>Проверьте отмеченные вопросы. Ответственный и срок решения редактируются вместе с формулировкой.</p></div>
      <div><button type="button" class="secondary-button" data-add-manual-question>Добавить вопрос</button><button type="button" class="primary-button" data-add-source-question>Из задач и планов</button></div>
    </div>
    <div class="agenda-list">${agenda.length ? agenda.map((item, index) => agendaItemHtml(item, index, agenda.length)).join('') : '<div class="empty-state">Повестка не распознана. Добавьте вопросы вручную; исходный протокол останется доступен.</div>'}</div>
    <div class="meeting-document-actions">
      <div><strong>Документы заседания</strong><span>Протокол содержит всю повестку. Выписка — только отмеченные вопросы с исходными номерами.</span></div>
      <div><button type="button" class="secondary-button" data-generate-protocol ${agenda.length ? '' : 'disabled'}>Сформировать протокол</button><button type="button" class="primary-button" data-generate-extract ${selectedCount ? '' : 'disabled'}>Выписка · ${selectedCount}</button></div>
    </div>
    <div class="meeting-documents">${(meeting.documents || []).length ? meeting.documents.map(documentHtml).join('') : '<span class="meeting-documents-empty">Сформированных документов пока нет.</span>'}</div>
  `;
}
