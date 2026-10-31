import { meetingsState, $m, escMeeting, meetingApi, openMeetingModal, settingsReady, showMeetingNotice } from './meetings-state.js';

function userOptions(selected) {
  return '<option value="">Выберите сотрудника</option>' + (meetingsState.resources.users || []).map((user) =>
    `<option value="${escMeeting(user.id)}" ${user.id === selected ? 'selected' : ''}>${escMeeting(user.display_name)}${user.position ? ` · ${escMeeting(user.position)}` : ''}</option>`
  ).join('');
}

function templateState(template) {
  return {
    ready: 'готов', legacy_compatible: 'совместимый', draft: 'черновик', needs_setup: 'требует настройки', error: 'ошибка'
  }[template.readiness] || null;
}

export function templateOptions(selected, kind = null) {
  const templates = (meetingsState.resources.templates || []).filter((template) =>
    !kind || !template.document_kind || template.document_kind === kind
  );
  return '<option value="">Выберите DOCX</option>' + templates.map((template) => {
    const label = [
      template.display_name || template.title,
      template.version_no ? `версия ${Number(template.version_no)}` : template.original_name,
      templateState(template)
    ].filter(Boolean).join(' · ');
    return `<option value="${escMeeting(template.version_id)}" ${template.version_id === selected ? 'selected' : ''}>${escMeeting(label || 'DOCX-шаблон')}</option>`;
  }).join('');
}

function templateUploadField(kind, title, selected) {
  const name = kind === 'protocol' ? 'protocolTemplateVersionId' : 'extractTemplateVersionId';
  return `<div class="meeting-template-field">
    <label class="field"><span>${escMeeting(title)}</span><select name="${name}" required>${templateOptions(selected, kind)}</select></label>
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
      <p class="meeting-helper">Загрузите обычный DOCX и назначьте поля непосредственно в предпросмотре. Старые шаблоны с {{AGENDA}} продолжают работать.</p>
      <div class="meeting-form-three">
        <label class="field"><span>Кворум</span><input name="quorum" type="number" min="1" step="1" value="${escMeeting(s.quorum || '')}" required></label>
        <label class="field"><span>Председатель</span><select name="chairpersonPersonId" required>${userOptions(s.chairperson_person_id)}</select></label>
        <label class="field"><span>Секретарь</span><select name="secretaryPersonId" required>${userOptions(s.secretary_person_id)}</select></label>
      </div>
      ${!(meetingsState.resources.templates || []).length ? '<div class="meeting-callout">Загрузите шаблон протокола и шаблон выписки. Для обычного DOCX после загрузки откройте «Настроить поля».</div>' : ''}
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
      <p class="meeting-helper">Председатель, секретарь, кворум и точные версии шаблонов копируются из настроек и сохраняются вместе с заседанием.</p>
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Создать</button></div>
    </form>
  `);
}

export function openEditMeetingModal() {
  const meeting = meetingsState.meeting;
  if (!meeting) return;
  const reviews = meeting.reviews || [];
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Заседание</span><h3>${reviews.length ? 'Исправить реквизиты' : 'Дата и номер'}</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-edit-form" class="meeting-modal-body">
      ${reviews.length ? `<div class="meeting-callout"><strong>Автоматика просит проверить:</strong> ${reviews.slice(0, 4).map((review) => escMeeting(review.title)).join(' · ')}</div>` : ''}
      <div class="meeting-form-two"><label class="field"><span>Дата</span><input name="meetingDate" type="date" value="${escMeeting(meeting.meeting_date || '')}" required></label><label class="field"><span>Номер протокола</span><input name="protocolNumber" value="${escMeeting(meeting.protocol_number || '')}" required></label></div>
      <label class="field"><span>Название</span><input name="title" value="${escMeeting(meeting.title || 'Заседание кафедры')}" required></label>
      ${meeting.source_document_id ? `<a class="meeting-source-link" href="/api/documents/${encodeURIComponent(meeting.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Открыть исходный протокол</a>` : ''}
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Сохранить исправления</button></div>
    </form>
  `);
}

export function openAgendaModal(item = null) {
  const decision = item?.decision || item?.decisions?.[0] || null;
  const relatedReviews = item ? (meetingsState.meeting?.reviews || []).filter((review) => {
    const context = review.context || {};
    return context.agendaId === item.id || context.existingAgendaId === item.id
      || context.decisionId === decision?.id
      || String(review.issue_code || '').includes(item.id)
      || (decision?.id && String(review.issue_code || '').includes(decision.id));
  }) : [];
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Вопрос ${item ? `№${Number(item.item_no)}` : ''}</span><h3>${relatedReviews.length ? 'Исправить распознанные данные' : item ? 'Содержание вопроса' : 'Новый вопрос повестки'}</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="agenda-item-form" data-agenda-id="${escMeeting(item?.id || '')}" class="meeting-modal-body">
      ${relatedReviews.length ? `<div class="meeting-callout"><strong>Нужно проверить:</strong> ${relatedReviews.map((review) => escMeeting(review.title)).join(' · ')}</div>` : ''}
      ${item?.source_label ? `<div class="meeting-source-note">Источник: <strong>${escMeeting(item.source_label)}</strong></div>` : ''}
      <label class="field"><span>Вопрос повестки</span><textarea name="title" rows="2" required placeholder="Например: О рассмотрении научной статьи…">${escMeeting(item?.title || '')}</textarea></label>
      <label class="field"><span>Слушали</span><textarea name="heardText" rows="3" placeholder="Кого заслушали и по существу вопроса">${escMeeting(item?.heard_text || '')}</textarea></label>
      <label class="field"><span>Обсудили</span><textarea name="discussedText" rows="3" placeholder="При необходимости">${escMeeting(item?.discussed_text || '')}</textarea></label>
      <label class="field"><span>Решили</span><textarea name="decisionText" rows="4" placeholder="Итоговое решение по этому вопросу">${escMeeting(item?.decision_text || decision?.text || '')}</textarea></label>
      <div class="meeting-form-two">
        <label class="field"><span>Ответственный</span><input name="responsibleRaw" value="${escMeeting(decision?.responsible_raw || '')}" placeholder="Фамилия, подразделение или роль"></label>
        <label class="field"><span>Срок</span><input name="dueDate" type="date" value="${escMeeting(decision?.due_date || '')}"></label>
      </div>
      <p class="meeting-helper">Сохранение обновит карточку, календарь и поиск. Исходный документ и автоматическое извлечение останутся в истории.</p>
      <div class="meeting-modal-actions">${item ? '<button type="button" class="danger-text-button" data-delete-agenda>Удалить вопрос</button>' : ''}<span class="spacer"></span><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
    </form>
  `);
}

export async function openSourceModal(defaultCategory = 'all') {
  const data = await meetingApi('/api/meeting-agenda-sources?limit=700');
  meetingsState.sources = data.items || [];
  meetingsState.currentSourceFilter = defaultCategory;
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Повестка заседания</span><h3>Добавить вопрос в повестку</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <div class="meeting-modal-body">
      <div class="meeting-source-tabs" role="tablist">
        <button type="button" class="meeting-source-tab ${defaultCategory === 'all' ? 'active' : ''}" data-source-filter="all">Все источники</button>
        <button type="button" class="meeting-source-tab ${defaultCategory === 'plan_item' ? 'active' : ''}" data-source-filter="plan_item">📋 Планы кафедры</button>
        <button type="button" class="meeting-source-tab ${defaultCategory === 'agenda_item' ? 'active' : ''}" data-source-filter="agenda_item">🏛️ Из других заседаний</button>
        <button type="button" class="meeting-source-tab ${defaultCategory === 'standard_template' ? 'active' : ''}" data-source-filter="standard_template">⭐ Типовые вопросы</button>
        <button type="button" class="meeting-source-tab ai-tab" data-source-action="ai-suggest">✨ Подобрать через ИИ</button>
      </div>
      <label class="meeting-source-search"><span aria-hidden="true">⌕</span><input id="meeting-source-search" type="search" placeholder="Поиск по названию, номеру протокола, теме..."></label>
      <div id="meeting-source-list" class="meeting-source-list"></div>
    </div>
  `);
  renderSources('', defaultCategory);

  const modalEl = $m('#meeting-modal');
  if (modalEl) {
    modalEl.querySelectorAll('[data-source-filter]').forEach((tab) => {
      tab.addEventListener('click', () => {
        modalEl.querySelectorAll('[data-source-filter]').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        meetingsState.currentSourceFilter = tab.dataset.sourceFilter;
        const q = $m('#meeting-source-search')?.value || '';
        renderSources(q, meetingsState.currentSourceFilter);
      });
    });
    modalEl.querySelector('[data-source-action="ai-suggest"]')?.addEventListener('click', () => {
      openAiAgendaModal();
    });
    const searchInput = modalEl.querySelector('#meeting-source-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        renderSources(e.target.value, meetingsState.currentSourceFilter || 'all');
      });
    }
  }
}

export function renderSources(query, category = 'all') {
  const target = $m('#meeting-source-list');
  if (!target) return;
  const q = String(query || '').trim().toLocaleLowerCase('ru-RU');
  const cat = category || meetingsState.currentSourceFilter || 'all';

  const items = meetingsState.sources.filter((source) => {
    if (cat !== 'all' && source.kind !== cat) return false;
    if (!q) return true;
    return [source.title, source.questionTitle, source.label, source.meta].join(' ').toLocaleLowerCase('ru-RU').includes(q);
  });

  target.innerHTML = items.length ? items.map((source) => `
    <button type="button" class="meeting-source-card" data-source-kind="${escMeeting(source.kind)}" data-source-id="${escMeeting(source.id)}">
      <span><strong>${escMeeting(source.questionTitle)}</strong><small>${escMeeting(source.label)}${source.meta ? ` · ${escMeeting(source.meta)}` : ''}</small></span><span aria-hidden="true">＋</span>
    </button>`).join('') : '<div class="empty-state">Подходящих источников в этой категории не найдено.</div>';
}

export async function openAiAgendaModal() {
  const meeting = meetingsState.meeting;
  const dateText = meeting?.meeting_date ? meeting.meeting_date : 'текущий месяц';
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>ИИ-ассистент</span><h3>✨ Подбор повестки заседания</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <div class="meeting-modal-body ai-agenda-modal-body">
      <p class="meeting-helper">ИИ сформирует рекомендованные вопросы заседания на основе планов кафедры на <strong>${escMeeting(dateText)}</strong>, нерешённых поручений и типового годового цикла.</p>
      <div id="ai-agenda-loading" class="assistant-progress-card">
        <div class="assistant-progress-spinner"></div>
        <span>ИИ анализирует планы и поручения кафедры...</span>
      </div>
      <div id="ai-agenda-results" class="ai-agenda-results hidden"></div>
    </div>
  `);
  try {
    const data = await meetingApi('/api/assistant/suggest-agenda', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meetingId: meeting?.id })
    });
    const loading = $m('#ai-agenda-loading');
    const results = $m('#ai-agenda-results');
    if (loading) loading.classList.add('hidden');
    if (!results) return;
    results.classList.remove('hidden');
    const topics = data.topics || [];
    if (!topics.length) {
      results.innerHTML = '<div class="empty-state">ИИ не сформировал вопросы. Попробуйте выбрать типовые вопросы вручную.</div>';
      return;
    }
    results.innerHTML = `
      <div class="ai-agenda-explanation">${escMeeting(data.explanation || 'Рекомендованный перечень вопросов повестки:')}</div>
      <div class="ai-agenda-list">
        ${topics.map((t, idx) => `
          <label class="ai-agenda-card">
            <input type="checkbox" name="aiAgendaSelect" value="${idx}" checked>
            <div class="ai-agenda-card-body">
              <strong>${escMeeting(t.title)}</strong>
              ${t.heardText ? `<div><b>Слушали:</b> ${escMeeting(t.heardText)}</div>` : ''}
              ${t.decisionText ? `<div><b>Постановили:</b> ${escMeeting(t.decisionText)}</div>` : ''}
              ${t.speaker ? `<small class="ai-agenda-speaker">Докладчик: ${escMeeting(t.speaker)}</small>` : ''}
            </div>
          </label>
        `).join('')}
      </div>
      <div class="meeting-modal-actions">
        <button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button>
        <span class="spacer"></span>
        <button type="button" class="primary-button" id="btn-apply-ai-agenda">Добавить выбранные (${topics.length}) в повестку</button>
      </div>
    `;
    const btnApply = results.querySelector('#btn-apply-ai-agenda');
    const checkboxes = results.querySelectorAll('input[name="aiAgendaSelect"]');
    const updateCount = () => {
      const selected = [...checkboxes].filter((c) => c.checked).length;
      if (btnApply) {
        btnApply.textContent = `Добавить выбранные (${selected}) в повестку`;
        btnApply.disabled = selected === 0;
      }
    };
    checkboxes.forEach((c) => c.addEventListener('change', updateCount));
    if (btnApply && meeting) {
      btnApply.addEventListener('click', async () => {
        btnApply.disabled = true;
        btnApply.textContent = 'Добавление...';
        const selectedIndices = [...checkboxes].filter((c) => c.checked).map((c) => Number(c.value));
        for (const idx of selectedIndices) {
          const t = topics[idx];
          try {
            await meetingApi(`/api/meetings/${encodeURIComponent(meeting.id)}/agenda`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                title: t.title,
                heardText: t.heardText || null,
                discussedText: t.discussedText || null,
                decisionText: t.decisionText || null,
                sourceKind: t.sourceKind || 'manual',
                sourceId: t.sourceId || null
              })
            });
          } catch {}
        }
        closeMeetingModal();
        showMeetingNotice(`В повестку добавлено ${selectedIndices.length} вопросов`);
        const { loadMeeting } = await import('./meetings-data.js');
        await loadMeeting(meeting.id);
      });
    }
  } catch (err) {
    const loading = $m('#ai-agenda-loading');
    if (loading) loading.innerHTML = `<p class="error-text">Не удалось получить рекомендации: ${escMeeting(err.message)}</p>`;
  }
}
