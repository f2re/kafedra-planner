const nativeFetch = window.fetch.bind(window);

const uxState = {
  filters: loadFilters(),
  draggingId: null,
  draggedItem: null,
  inspected: null,
  draft: {
    documentVersionId: null,
    documentId: null,
    fields: [],
    checkedVersionId: null,
    restoring: false,
    timer: null
  }
};

function loadFilters() {
  try {
    const stored = JSON.parse(localStorage.getItem('kafedra-calendar-filters') || '{}');
    const categories = Array.isArray(stored.categories)
      ? stored.categories.filter((value) => ['science', 'education', 'organizational', 'everyday'].includes(value))
      : ['science', 'education', 'organizational', 'everyday'];
    return {
      categories: categories.length ? categories : ['science', 'education', 'organizational', 'everyday'],
      kind: ['all', 'event', 'task'].includes(stored.kind) ? stored.kind : 'all'
    };
  } catch {
    return { categories: ['science', 'education', 'organizational', 'everyday'], kind: 'all' };
  }
}

function saveFilters() {
  localStorage.setItem('kafedra-calendar-filters', JSON.stringify(uxState.filters));
}

window.fetch = function filteredFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return nativeFetch(input, init);
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin || !['/api/calendar', '/api/tasks'].includes(url.pathname)) {
    return nativeFetch(input, init);
  }
  const all = ['science', 'education', 'organizational', 'everyday'];
  if (uxState.filters.categories.length < all.length) {
    url.searchParams.delete('category');
    uxState.filters.categories.forEach((category) => url.searchParams.append('category', category));
  }
  if (url.pathname === '/api/calendar' && uxState.filters.kind !== 'all') {
    url.searchParams.set('kind', uxState.filters.kind);
  }
  const next = input instanceof Request
    ? new Request(url.toString(), input)
    : `${url.pathname}${url.search}${url.hash}`;
  return nativeFetch(next, init);
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const response = await nativeFetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateLabel(value) {
  if (!value) return 'Дата не указана';
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T09:00:00` : text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
    ...(/T/.test(text) ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function categoryLabel(value) {
  return {
    science: 'Наука',
    education: 'Образование',
    organizational: 'Организация',
    everyday: 'Повседневная'
  }[value] || value;
}

function statusLabel(value) {
  return {
    open: 'Открыта',
    completed: 'Выполнено',
    confirmed: 'Подтверждено',
    proposed: 'Предложено',
    cancelled: 'Отменено',
    processed: 'Готово',
    needs_review: 'Нужна проверка',
    failed: 'Ошибка'
  }[value] || value;
}

function ensureUx() {
  if (!$('#ux-next-styles')) {
    const link = document.createElement('link');
    link.id = 'ux-next-styles';
    link.rel = 'stylesheet';
    link.href = '/ux-next.css';
    document.head.append(link);
  }

  if (!$('#calendar-filterbar')) {
    const toolbar = $('.calendar-toolbar');
    toolbar?.insertAdjacentHTML('afterend', `
      <div id="calendar-filterbar" class="calendar-filterbar" aria-label="Фильтры календаря">
        <div class="filter-group" role="group" aria-label="Вид записей">
          <button type="button" class="filter-chip" data-filter-kind="all">Все записи</button>
          <button type="button" class="filter-chip" data-filter-kind="event">События</button>
          <button type="button" class="filter-chip" data-filter-kind="task">Задачи</button>
        </div>
        <div class="filter-divider"></div>
        <div class="filter-group" role="group" aria-label="Категории">
          <button type="button" class="filter-chip science" data-filter-category="science">Наука</button>
          <button type="button" class="filter-chip education" data-filter-category="education">Образование</button>
          <button type="button" class="filter-chip organizational" data-filter-category="organizational">Организация</button>
          <button type="button" class="filter-chip everyday" data-filter-category="everyday">Повседневная</button>
        </div>
      </div>
    `);
  }

  if (!$('#ux-inspector')) {
    document.body.insertAdjacentHTML('beforeend', `
      <aside id="ux-inspector" class="ux-inspector hidden" aria-label="Инспектор" aria-live="polite">
        <header class="ux-inspector-head">
          <div><div id="ux-inspector-eyebrow" class="eyebrow">Инспектор</div><h2 id="ux-inspector-title">Сведения</h2></div>
          <button id="ux-inspector-close" class="icon-button" type="button" aria-label="Закрыть инспектор">×</button>
        </header>
        <div id="ux-inspector-body" class="ux-inspector-body"></div>
        <footer id="ux-inspector-actions" class="ux-inspector-actions"></footer>
      </aside>
      <div id="ux-undo" class="ux-undo hidden" role="status" aria-live="polite">
        <span id="ux-undo-text"></span>
        <button id="ux-undo-button" type="button">Отменить</button>
      </div>
    `);
  }

  if (!$('#template-draft-banner')) {
    $('#wizard-step-1')?.insertAdjacentHTML('afterbegin', `
      <div id="template-draft-banner" class="template-draft-banner hidden">
        <div><strong>Найден сохранённый черновик</strong><span id="template-draft-time">Можно продолжить с прежними полями.</span></div>
        <div><button id="resume-template-draft" type="button" class="secondary-button">Продолжить</button><button id="discard-template-draft" type="button" class="text-button">Начать заново</button></div>
      </div>
    `);
  }

  renderFilterState();
  annotateCalendarItems();
  annotateDocumentRows();
}

function renderFilterState() {
  $$('[data-filter-kind]').forEach((button) => {
    const active = button.dataset.filterKind === uxState.filters.kind;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('[data-filter-category]').forEach((button) => {
    const active = uxState.filters.categories.includes(button.dataset.filterCategory);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function refreshCalendar() {
  const active = $('[data-calendar-mode].active') || $('[data-calendar-mode="month"]');
  active?.click();
}

function updateKindFilter(kind) {
  uxState.filters.kind = kind;
  saveFilters();
  renderFilterState();
  refreshCalendar();
}

function updateCategoryFilter(category) {
  const selected = new Set(uxState.filters.categories);
  if (selected.has(category)) selected.delete(category);
  else selected.add(category);
  if (!selected.size) {
    ['science', 'education', 'organizational', 'everyday'].forEach((item) => selected.add(item));
    showUndo('Хотя бы одна категория должна оставаться видимой.', null);
  }
  uxState.filters.categories = [...selected];
  saveFilters();
  renderFilterState();
  refreshCalendar();
}

function openInspector(title, eyebrow, body, actions = '') {
  $('#ux-inspector-title').textContent = title;
  $('#ux-inspector-eyebrow').textContent = eyebrow;
  $('#ux-inspector-body').innerHTML = body;
  $('#ux-inspector-actions').innerHTML = actions;
  $('#ux-inspector').classList.remove('hidden');
  document.body.classList.add('inspector-open');
  requestAnimationFrame(() => $('#ux-inspector-close').focus());
}

function closeInspector() {
  $('#ux-inspector').classList.add('hidden');
  document.body.classList.remove('inspector-open');
  uxState.inspected = null;
}

function evidenceRows(extraction) {
  const fieldMap = new Map((extraction.fields || []).map((field) => [field.key, field.label]));
  return Object.entries(extraction.values || {}).map(([key, value]) => {
    const evidence = extraction.evidence?.[key];
    const locator = evidence?.locator;
    const location = locator ? `строки ${locator.startLine}${locator.endLine !== locator.startLine ? `–${locator.endLine}` : ''}` : 'источник сохранён';
    return `<div class="inspector-value"><span>${escapeHtml(fieldMap.get(key) || key)}</span><strong>${escapeHtml(typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : value)}</strong><small>${escapeHtml(location)}</small></div>`;
  }).join('');
}

async function openCalendarInspector(itemId) {
  const item = await api(`/api/calendar/${encodeURIComponent(itemId)}`);
  uxState.inspected = { kind: 'calendar', item };
  const isTask = item.item_kind === 'task' || item.source_kind === 'decision';
  const source = item.source_kind === 'manual'
    ? 'Создано вручную'
    : item.source_kind === 'decision'
      ? 'Срок из решения протокола'
      : item.source_kind === 'meeting'
        ? 'Заседание из протокола'
        : `Источник: ${item.source_kind}`;
  openInspector(item.title, isTask ? 'Задача' : 'Событие', `
    <div class="inspector-hero ${escapeHtml(item.category)}">
      <span class="inspector-date">${escapeHtml(dateLabel(item.starts_at))}</span>
      <span class="status ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
    </div>
    <dl class="inspector-facts">
      <div><dt>Категория</dt><dd>${escapeHtml(categoryLabel(item.category))}</dd></div>
      <div><dt>Важность</dt><dd>${escapeHtml(item.importance)}</dd></div>
      <div><dt>Напоминание</dt><dd>${item.reminder_minutes == null ? 'Не задано' : `за ${item.reminder_minutes} мин.`}</dd></div>
      <div><dt>Источник</dt><dd>${escapeHtml(source)}</dd></div>
    </dl>
    ${item.description ? `<section class="inspector-section"><h3>Комментарий</h3><p>${escapeHtml(item.description)}</p></section>` : ''}
    ${item.source_kind !== 'manual' ? '<div class="source-note">Дата получена из документа. Изменение сохраняется в журнале и может быть отменено.</div>' : ''}
  `, `
    ${item.source_document_id ? `<button type="button" class="secondary-button" data-inspector-document="${escapeHtml(item.source_document_id)}">Открыть документ</button>` : ''}
    ${isTask ? `<button type="button" class="secondary-button" data-inspector-complete="${escapeHtml(item.id)}">${item.status === 'completed' ? 'Вернуть в работу' : 'Завершить'}</button>` : ''}
    <button type="button" class="primary-button" data-inspector-edit="${escapeHtml(item.id)}">Изменить</button>
  `);
}

function openEventEditor(item) {
  $('#event-form').reset();
  $('#event-id').value = item.id;
  $('#event-title').value = item.title;
  $('#event-kind').value = item.item_kind === 'task' || item.source_kind === 'decision' ? 'task' : 'event';
  $('#event-date').value = String(item.starts_at).slice(0, 10);
  $('#event-category').value = item.category || 'organizational';
  $('#event-importance').value = item.importance || 'normal';
  $('#event-reminder').value = item.reminder_minutes ?? '';
  $('#event-description').value = item.description || '';
  $('#event-sheet-title').textContent = item.item_kind === 'task' || item.source_kind === 'decision' ? 'Задача' : 'Событие';
  closeInspector();
  $('#sheet-backdrop').classList.remove('hidden');
  $('#event-sheet').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => $('#event-title').focus());
}

async function toggleInspectedTask(itemId) {
  const item = await api(`/api/calendar/${encodeURIComponent(itemId)}`);
  await api(`/api/calendar/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: item.status === 'completed' ? 'open' : 'completed', action: 'status' })
  });
  closeInspector();
  refreshCalendar();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} байт`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

async function openDocumentInspector(documentId) {
  const document = await api(`/api/documents/${encodeURIComponent(documentId)}`);
  uxState.inspected = { kind: 'document', document };
  const extractions = (document.templateExtractions || []).map((extraction) => `
    <section class="inspector-section extraction-card">
      <div class="inspector-section-head"><h3>${escapeHtml(extraction.template_name)}</h3><span>${Math.round((extraction.confidence || 0) * 100)}%</span></div>
      ${evidenceRows(extraction) || '<p class="muted">Значения не извлечены.</p>'}
      ${(extraction.missing || []).length ? `<div class="missing-note">Не найдено: ${escapeHtml(extraction.missing.map((item) => item.label).join(', '))}</div>` : ''}
    </section>
  `).join('');
  const meetings = (document.meetings || []).map((meeting) => `
    <section class="inspector-section">
      <h3>${escapeHtml(meeting.protocol_number ? `Протокол № ${meeting.protocol_number}` : meeting.title)}</h3>
      <p>${escapeHtml(meeting.meeting_date ? dateLabel(meeting.meeting_date) : 'Дата требует проверки')}</p>
      ${(meeting.agendaItems || []).slice(0, 5).map((item) => `<div class="agenda-mini"><strong>${item.item_no}. ${escapeHtml(item.title)}</strong><span>${(item.decisions || []).length} решений</span></div>`).join('')}
    </section>
  `).join('');
  const openReviews = (document.reviews || []).filter((item) => item.status === 'open');
  openInspector(document.title, 'Документ', `
    <div class="document-inspector-summary">
      <span class="status ${escapeHtml(document.processing_status)}">${escapeHtml(statusLabel(document.processing_status))}</span>
      <strong>${escapeHtml(document.original_name)}</strong>
      <small>${escapeHtml(document.detected_format)} · ${escapeHtml(formatBytes(document.size_bytes))}</small>
    </div>
    <dl class="inspector-facts">
      <div><dt>Тип</dt><dd>${escapeHtml(document.document_type)}</dd></div>
      <div><dt>SHA-256</dt><dd class="mono">${escapeHtml(String(document.sha256).slice(0, 16))}…</dd></div>
      <div><dt>Загружен</dt><dd>${escapeHtml(dateLabel(document.uploaded_at || document.created_at))}</dd></div>
      <div><dt>Вопросы</dt><dd>${openReviews.length}</dd></div>
    </dl>
    ${extractions || '<section class="inspector-section"><h3>Извлечённые поля</h3><p class="muted">Сохранённый шаблон ещё не применялся.</p></section>'}
    ${meetings}
    ${openReviews.length ? `<section class="inspector-section"><h3>Требует внимания</h3>${openReviews.map((item) => `<p>${escapeHtml(item.title)}: ${escapeHtml(item.proposed_action)}</p>`).join('')}</section>` : ''}
  `, `
    ${['processed', 'needs_review'].includes(document.processing_status) ? `<button type="button" class="primary-button" data-inspector-template="${escapeHtml(document.id)}">Создать шаблон</button>` : ''}
  `);
}

function annotateCalendarItems() {
  $$('[data-calendar-item]').forEach((element) => {
    element.draggable = true;
    element.classList.add('ux-draggable');
  });
}

async function annotateDocumentRows() {
  const table = $('#documents-table tbody');
  if (!table) return;
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length || rows.every((row) => row.dataset.documentId)) return;
  try {
    const { items } = await api('/api/documents?limit=500');
    rows.forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      row.dataset.documentId = item.id;
      const title = $('.document-title', row);
      if (title) {
        title.classList.add('document-open');
        title.tabIndex = 0;
        title.setAttribute('role', 'button');
        title.setAttribute('aria-label', `Открыть ${item.title}`);
      }
    });
  } catch {}
}

function preserveTime(oldValue, date) {
  const text = String(oldValue || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? date : `${date}${text.slice(10)}`;
}

async function moveCalendarItem(itemId, targetDate) {
  const item = await api(`/api/calendar/${encodeURIComponent(itemId)}`);
  if (String(item.starts_at).slice(0, 10) === targetDate) return;
  if (item.source_kind !== 'manual') {
    const accepted = window.confirm('Дата получена из документа. Перенести её и сохранить изменение в журнале?');
    if (!accepted) return;
  }
  const updated = await api(`/api/calendar/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      startsAt: preserveTime(item.starts_at, targetDate),
      action: 'reschedule'
    })
  });
  uxState.draggedItem = updated;
  showUndo(`«${updated.title}» перенесено на ${dateLabel(updated.starts_at)}.`, async () => {
    await api(`/api/calendar/${encodeURIComponent(updated.id)}/undo`, { method: 'POST' });
    refreshCalendar();
  });
  refreshCalendar();
}

function showUndo(message, action) {
  $('#ux-undo-text').textContent = message;
  $('#ux-undo-button').classList.toggle('hidden', !action);
  $('#ux-undo-button').onclick = action ? async () => {
    try { await action(); } finally { $('#ux-undo').classList.add('hidden'); }
  } : null;
  $('#ux-undo').classList.remove('hidden');
  clearTimeout(showUndo.timer);
  showUndo.timer = setTimeout(() => $('#ux-undo').classList.add('hidden'), action ? 8000 : 4200);
}

function selectedTemplateLine() {
  const element = $('.document-line.selected');
  if (!element) return null;
  return {
    number: Number(element.dataset.lineNumber),
    text: $('.line-text', element)?.textContent || ''
  };
}

function slugKey(value, index) {
  const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  const translit = [...String(value || '').toLocaleLowerCase('ru-RU')].map((char) => map[char] ?? char).join('');
  return translit.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${index + 1}`;
}

function fieldFromEditor() {
  const line = selectedTemplateLine();
  const label = $('#field-label')?.value.trim();
  if (!line || !label) return null;
  const strategy = $('#field-strategy').value;
  return {
    key: slugKey(label, uxState.draft.fields.length),
    label,
    type: $('#field-type').value,
    strategy,
    anchor: $('#field-anchor').value.trim(),
    endAnchor: strategy === 'between' ? $('#field-end-anchor').value.trim() : null,
    required: $('#field-required').checked,
    sample: line.text,
    sourceLineNumber: line.number
  };
}

function activeWizardStep() {
  const active = $('.wizard-step.active');
  return Number(active?.dataset.wizardStep || 1);
}

function draftPayload() {
  return {
    documentId: uxState.draft.documentId,
    documentVersionId: uxState.draft.documentVersionId,
    name: $('#template-name')?.value.trim() || '',
    documentType: $('#template-document-type')?.value.trim() || 'custom_document',
    filenameContains: $('#matcher-filename')?.value.trim() || '',
    requiredPhrases: ($('#matcher-phrases')?.value || '').split('\n').map((item) => item.trim()).filter(Boolean),
    fields: uxState.draft.fields,
    step: activeWizardStep()
  };
}

function scheduleDraftSave() {
  if (uxState.draft.restoring || !uxState.draft.documentVersionId) return;
  clearTimeout(uxState.draft.timer);
  uxState.draft.timer = setTimeout(async () => {
    const payload = draftPayload();
    try {
      await api('/api/templates/draft', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documentVersionId: uxState.draft.documentVersionId,
          payload,
          step: payload.step
        })
      });
      $('#template-selection-hint').textContent = 'Черновик сохранён';
    } catch {
      localStorage.setItem(`kafedra-template-draft:${uxState.draft.documentVersionId}`, JSON.stringify(payload));
      $('#template-selection-hint').textContent = 'Черновик сохранён в браузере';
    }
  }, 550);
}

async function detectTemplateSource() {
  if ($('#template-sheet')?.classList.contains('hidden')) return;
  const documentId = $('#template-document-select')?.value;
  if (!documentId || !$('#template-document-preview .document-line')) return;
  if (uxState.draft.documentId === documentId && uxState.draft.documentVersionId) return;
  try {
    const source = await api(`/api/templates/source?documentId=${encodeURIComponent(documentId)}`);
    uxState.draft.documentId = documentId;
    uxState.draft.documentVersionId = source.version_id;
    uxState.draft.fields = [];
    if (uxState.draft.checkedVersionId !== source.version_id) {
      uxState.draft.checkedVersionId = source.version_id;
      await offerDraft(source.version_id);
    }
  } catch {}
}

async function offerDraft(versionId) {
  let draft = null;
  try {
    draft = (await api(`/api/templates/draft?documentVersionId=${encodeURIComponent(versionId)}`)).draft;
  } catch {}
  if (!draft) {
    try {
      const payload = JSON.parse(localStorage.getItem(`kafedra-template-draft:${versionId}`) || 'null');
      if (payload) draft = { payload, updated_at: null };
    } catch {}
  }
  const banner = $('#template-draft-banner');
  banner.classList.toggle('hidden', !draft);
  if (!draft) return;
  banner._draft = draft;
  $('#template-draft-time').textContent = draft.updated_at
    ? `Сохранён ${dateLabel(draft.updated_at)}.`
    : 'Сохранён в этом браузере.';
}

async function restoreDraft(draft) {
  const payload = draft?.payload || {};
  uxState.draft.restoring = true;
  try {
    $('#template-name').value = payload.name || '';
    $('#template-document-type').value = payload.documentType || 'custom_document';
    $('#matcher-filename').value = payload.filenameContains || '';
    $('#matcher-phrases').value = (payload.requiredPhrases || []).join('\n');
    uxState.draft.fields = [];
    for (const field of payload.fields || []) {
      const line = $(`[data-line-number="${Number(field.sourceLineNumber)}"]`)
        || $$('.document-line').find((element) => $('.line-text', element)?.textContent === field.sample);
      if (!line) continue;
      line.click();
      $('#field-label').value = field.label || '';
      $('#field-type').value = field.type || 'string';
      $('#field-strategy').value = field.strategy || 'after_label';
      $('#field-anchor').value = field.anchor || '';
      $('#field-end-anchor').value = field.endAnchor || '';
      $('#field-required').checked = field.required !== false;
      $('#field-strategy').dispatchEvent(new Event('change', { bubbles: true }));
      $('#add-template-field').click();
      uxState.draft.fields.push(field);
    }
    $('#template-draft-banner').classList.add('hidden');
    showUndo('Черновик восстановлен.', null);
  } finally {
    uxState.draft.restoring = false;
  }
}

async function discardDraft() {
  const versionId = uxState.draft.documentVersionId;
  if (!versionId) return;
  await api(`/api/templates/draft?documentVersionId=${encodeURIComponent(versionId)}`, { method: 'DELETE' }).catch(() => {});
  localStorage.removeItem(`kafedra-template-draft:${versionId}`);
  $('#template-draft-banner').classList.add('hidden');
  uxState.draft.fields = [];
  showUndo('Черновик удалён.', null);
}

async function deleteSavedDraftLater() {
  const versionId = uxState.draft.documentVersionId;
  if (!versionId) return;
  setTimeout(async () => {
    if (!$('#template-sheet').classList.contains('hidden')) return;
    await api(`/api/templates/draft?documentVersionId=${encodeURIComponent(versionId)}`, { method: 'DELETE' }).catch(() => {});
    localStorage.removeItem(`kafedra-template-draft:${versionId}`);
  }, 1200);
}

const observer = new MutationObserver(() => {
  ensureUx();
  annotateCalendarItems();
  annotateDocumentRows();
  detectTemplateSource();
});
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

document.addEventListener('click', async (event) => {
  const kind = event.target.closest('[data-filter-kind]');
  if (kind) return updateKindFilter(kind.dataset.filterKind);
  const category = event.target.closest('[data-filter-category]');
  if (category) return updateCategoryFilter(category.dataset.filterCategory);

  const calendar = event.target.closest('[data-calendar-item]');
  if (calendar && !event.target.closest('#ux-inspector')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return openCalendarInspector(calendar.dataset.calendarItem).catch((error) => showUndo(error.message, null));
  }

  const documentTitle = event.target.closest('.document-open');
  if (documentTitle) {
    const documentId = documentTitle.closest('[data-document-id]')?.dataset.documentId;
    if (documentId) {
      event.preventDefault();
      return openDocumentInspector(documentId).catch((error) => showUndo(error.message, null));
    }
  }

  const edit = event.target.closest('[data-inspector-edit]');
  if (edit) return openEventEditor(uxState.inspected?.item || await api(`/api/calendar/${encodeURIComponent(edit.dataset.inspectorEdit)}`));
  const complete = event.target.closest('[data-inspector-complete]');
  if (complete) return toggleInspectedTask(complete.dataset.inspectorComplete);
  const sourceDocument = event.target.closest('[data-inspector-document]');
  if (sourceDocument) return openDocumentInspector(sourceDocument.dataset.inspectorDocument);
  const template = event.target.closest('[data-inspector-template]');
  if (template) {
    closeInspector();
    const existing = $(`[data-create-template="${CSS.escape(template.dataset.inspectorTemplate)}"]`);
    existing?.click();
  }

  if (event.target.closest('#ux-inspector-close')) closeInspector();
  if (event.target.closest('#resume-template-draft')) restoreDraft($('#template-draft-banner')._draft);
  if (event.target.closest('#discard-template-draft')) discardDraft();

  const addField = event.target.closest('#add-template-field');
  if (addField && !uxState.draft.restoring) {
    const field = fieldFromEditor();
    if (field) {
      uxState.draft.fields.push(field);
      scheduleDraftSave();
    }
  }
  const removeField = event.target.closest('[data-remove-field]');
  if (removeField && !uxState.draft.restoring) {
    uxState.draft.fields.splice(Number(removeField.dataset.removeField), 1);
    scheduleDraftSave();
  }
  if (event.target.closest('#wizard-next, #wizard-back, #preview-template')) scheduleDraftSave();
  if (event.target.closest('#save-template')) deleteSavedDraftLater();
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#ux-inspector').classList.contains('hidden')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeInspector();
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('document-open')) {
    event.preventDefault();
    event.target.click();
  }
}, true);

document.addEventListener('input', (event) => {
  if (event.target.closest('#template-sheet')) scheduleDraftSave();
});
document.addEventListener('change', (event) => {
  if (event.target.closest('#template-sheet')) scheduleDraftSave();
});

document.addEventListener('dragstart', (event) => {
  const item = event.target.closest('[data-calendar-item]');
  if (!item) return;
  uxState.draggingId = item.dataset.calendarItem;
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', uxState.draggingId);
});
document.addEventListener('dragend', (event) => {
  event.target.closest('[data-calendar-item]')?.classList.remove('dragging');
  $$('.drag-target').forEach((element) => element.classList.remove('drag-target'));
  uxState.draggingId = null;
});
document.addEventListener('dragover', (event) => {
  const target = event.target.closest('[data-calendar-date]');
  if (!target || !uxState.draggingId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  $$('.drag-target').forEach((element) => element.classList.toggle('drag-target', element === target));
});
document.addEventListener('drop', (event) => {
  const target = event.target.closest('[data-calendar-date]');
  if (!target || !uxState.draggingId) return;
  event.preventDefault();
  const itemId = uxState.draggingId;
  uxState.draggingId = null;
  $$('.drag-target').forEach((element) => element.classList.remove('drag-target'));
  moveCalendarItem(itemId, target.dataset.calendarDate).catch((error) => showUndo(error.message, null));
});

ensureUx();
refreshCalendar();
