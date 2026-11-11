import { newPlanOperationId, planUploadKey } from './plan-upload-identity.js';
import { applyPreviewColumnWidths, createEventTemplateEditor, eventTerm, fieldInput, fieldValue, previewTable, templateFields } from './event-template-editor.js';

const today = new Date();
const state = {
  open: false, month: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`, draft: null, drafts: [], templates: [], eventTemplates: [], eventVersions: new Map(), plans: [],
  events: [], selected: new Set(), edits: new Map(), hasMore: false, nextOffset: 0,
  filters: { q: '', department: '', activityKind: '', planId: '', includeUndated: true },
  metadata: { title: '', templateId: '', eventTemplateVersionId: '', departmentText: '' }, tab: 'events', busy: false, requestSequence: 0, draftSequence: 0, listSequence: 0,
  createKey: newPlanOperationId(), pendingCreate: null, exportRequest: null, templateSource: null, templateAnalysis: null,
  detailsEdits: new Map(), designerDirty: false, suggestions: null, suggestedSelected: new Set(), suggestionBusy: false, suggestionSequence: 0, suggestionController: null, suggestionRequest: null
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const kinds = { methodological: 'Методическая работа', teaching: 'Занятия', science: 'Научная работа', organizational: 'Организационная работа', everyday: 'Повседневная работа' };
let templateEditor;
const directions = { education: 'Образование', science: 'Наука', organizational: 'Организация', everyday: 'Повседневная работа' };

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.error?.details;
    const detailText = Array.isArray(details?.missing) ? details.missing.slice(0, 8).map(item => `Строка ${item.position || item.row || '—'}: ${item.label || (item.fields || []).join(', ')}`).join('; ') : '';
    const error = new Error((data?.error?.message || `Не удалось выполнить действие (${response.status}).`) + (detailText ? ` ${detailText}` : ''));
    error.code = data?.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function monthTitle(month = state.month) {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1)));
}
function defaultTitle() { return `План работы кафедры · ${monthTitle()}`; }
function message(text = '', error = false) {
  const target = $('#collection-message');
  if (!target) return;
  target.textContent = text;
  target.setAttribute('role', error ? 'alert' : 'status');
  target.classList.toggle('collection-error', error);
}
function dates(item) { return eventTerm(item) || 'Без точного срока'; }
function locator(item) {
  const value = item?.evidence?.locator || {};
  if (value.sheet) return `Лист ${value.sheet}${value.row ? `, строка ${value.row}` : ''}`;
  if (value.table) return `Таблица ${value.table}${value.row ? `, строка ${value.row}` : ''}`;
  if (value.page) return `Страница ${value.page}${value.line ? `, строка ${value.line}` : ''}`;
  if (value.line) return `Строка ${value.line}`;
  return item.source_document_id ? 'Источник сохранён' : 'Создано вручную';
}
function sourceLinks(source) {
  if (!source) return '';
  return `<div class="collection-source"><button type="button" class="text-button" data-collection-action="source" data-source-id="${esc(source.plan_id)}">${esc(source.plan_title || 'Исходный план')}</button>
    ${source.source_document_id ? `<a href="/api/documents/${encodeURIComponent(source.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Документ</a>` : ''}<small>${esc(locator(source))}</small></div>`;
}
function ensureUi() {
  const view = $('[data-view-panel="plans"]');
  const heading = $('.plans-heading-actions', view || document);
  if (!view || !heading) return false;
  if (!$('#plan-collection-open')) {
    const button = document.createElement('button');
    button.id = 'plan-collection-open';
    button.className = 'secondary-button';
    button.type = 'button';
    button.textContent = 'Мероприятия и план на месяц';
    button.dataset.collectionAction = 'open';
    heading.append(button);
  }
  if (!$('#plan-collection')) {
    const section = document.createElement('section');
    section.id = 'plan-collection';
    section.className = 'plan-collection hidden';
    section.setAttribute('aria-label', 'Мероприятия и месячные планы');
    section.innerHTML = `
      <header class="collection-heading"><div><button type="button" class="text-button" data-collection-action="close">К исходным планам</button><h3 tabindex="-1">План на месяц</h3></div><button type="button" class="secondary-button" data-collection-action="refresh" data-collection-mutation>Обновить</button></header>
      <div id="collection-message" class="collection-message" role="status" aria-live="polite"></div>
      <form id="collection-plan-form" class="collection-plan-form">
        <label class="field"><span>Месяц</span><input id="collection-month" type="month" value="${state.month}" required></label>
        <label class="field"><span>Сохранённый план</span><select id="collection-saved"><option value="">Новый план на месяц</option></select></label>
        <label class="field collection-title-field"><span>Название плана</span><input id="collection-title" required maxlength="500"></label>
        <label class="field"><span>Поля и колонки</span><select id="collection-event-template"><option value="">Стандартные поля</option></select></label>
        <label class="field"><span>Образец DOCX</span><select id="collection-template"><option value="">Стандартная таблица</option></select></label>
        <p class="collection-help collection-title-field">Поля задают таблицу, DOCX-образец — шапку и подписи.</p>
        <div class="collection-plan-actions"><button type="button" class="secondary-button" data-collection-action="edit-event-template">Поля и вид документа</button><button type="submit" class="secondary-button" data-collection-mutation>Сохранить план</button><button type="button" class="secondary-button" data-collection-action="upload-template" data-collection-mutation>Загрузить образец</button><input id="collection-template-file" type="file" accept=".docx" hidden><button type="button" class="primary-button" data-collection-action="export" data-collection-mutation>Скачать DOCX</button></div>
        <p id="collection-export-warning" class="collection-help collection-title-field hidden"></p>
      </form>
      <section id="collection-event-template-designer" class="collection-designer hidden" aria-label="Визуальный редактор шаблона"></section>
      <section id="collection-template-review" class="collection-template-review hidden" aria-label="Настройка образца"></section>
      <div class="collection-tabs" role="tablist" aria-label="Состав месячного плана"><button id="collection-events-tab" type="button" role="tab" aria-selected="true" aria-controls="collection-events-panel" data-collection-action="events">Все мероприятия</button><button id="collection-members-tab" type="button" role="tab" aria-selected="false" aria-controls="collection-members-panel" data-collection-action="members">В плане · 0</button></div>
      <section id="collection-events-panel" role="tabpanel" aria-labelledby="collection-events-tab">
        <div class="collection-filters">
          <label class="field"><span>Найти мероприятие</span><input id="collection-q" type="search" placeholder="Название или содержание"></label>
          <label class="field"><span>Вид деятельности</span><select id="collection-activity"><option value="">Все виды</option>${Object.entries(kinds).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <label class="field"><span>Кафедра / подразделение</span><input id="collection-department" type="search" placeholder="По тексту плана и ответственным"></label>
          <label class="field"><span>Исходный план</span><select id="collection-source-plan"><option value="">Все планы</option></select></label>
        </div>
        <div class="collection-prefill-actions"><button type="button" class="primary-button" data-collection-action="suggest">Подобрать и заполнить</button><button type="button" class="text-button hidden" data-collection-action="cancel-suggest">Отменить подбор</button><span id="collection-suggest-status" role="status" aria-live="polite">Укажите кафедру — система предложит мероприятия для неё.</span></div>
        <div class="collection-selection"><label class="check-field"><input id="collection-undated" type="checkbox" checked><span>Показывать также мероприятия без точного срока</span></label><span id="collection-selection-count">Выбрано: 0</span><button type="button" class="primary-button" data-collection-action="add" data-collection-mutation disabled>Добавить выбранные</button></div>
        <section id="collection-suggestion-preview" class="collection-suggestion-preview hidden" aria-label="Предварительный подбор"></section>
        <div id="collection-events" aria-busy="false"></div><button type="button" class="secondary-button hidden" id="collection-load-more" data-collection-action="more">Показать ещё</button>
      </section>
      <section id="collection-members-panel" class="hidden" role="tabpanel" aria-labelledby="collection-members-tab"><p class="collection-help">Формулировки для выгрузки можно изменить здесь. Сроки и исполнение самого мероприятия редактируются в исходном плане.</p><div id="collection-members"></div></section>`;
    view.append(section);
  }
  if (!templateEditor) templateEditor = createEventTemplateEditor({ root: $('#collection-event-template-designer'), api, json, getItems: () => { const items = state.draft?.items?.filter(item => !item.unavailable) || []; return items.length ? items : state.events.filter(item => state.selected.has(item.id)); }, onDirty: value => { state.designerDirty = value; syncControls(); }, onSaved: async (saved, version) => {
    state.eventTemplates = [...state.eventTemplates.filter(item => item.id !== saved.id), saved]; state.eventVersions.set(version.id, version); state.metadata.eventTemplateVersionId = version.id; clearSuggestions(); renderSelectors(); renderMembers(); renderEvents(); message('Шаблон выбран. Сохраните месячный план, чтобы закрепить эту версию.');
  } });
  return true;
}
function setTab(tab) {
  state.tab = tab;
  for (const value of ['events', 'members']) {
    $(`#collection-${value}-panel`).classList.toggle('hidden', value !== tab);
    $(`#collection-${value}-tab`).setAttribute('aria-selected', String(value === tab));
    $(`#collection-${value}-tab`).tabIndex = value === tab ? 0 : -1;
  }
}
function syncControls() {
  const root = $('#plan-collection');
  if (!root) return;
  const previewOpen = !$('#collection-suggestion-preview').classList.contains('hidden');
  for (const selector of ['#collection-events', '#collection-selection-count', '[data-collection-action="add"]']) $(selector, root).classList.toggle('hidden', previewOpen);
  $('#collection-load-more').classList.toggle('hidden', previewOpen || !state.hasMore);
  const suggest = $('[data-collection-action="suggest"]', root);
  suggest.classList.toggle('primary-button', !previewOpen);
  suggest.classList.toggle('secondary-button', previewOpen);
  $$('[data-collection-mutation], #collection-plan-form input, #collection-plan-form select, .collection-filters input, .collection-filters select, #collection-undated, .collection-item-form input, .collection-item-form select, .collection-event-details input, .collection-event-details select, #collection-template-review input, #collection-template-review select', root).forEach(node => { node.disabled = state.busy; });
  templateEditor?.setExternalBusy(state.busy);
  $('[data-collection-action="edit-event-template"]', root).disabled = state.busy;
  const includedEvents = new Set((state.draft?.items || []).map(item => item.plan_item_id));
  $$('[data-collection-select]', root).forEach(node => { node.disabled = state.busy || includedEvents.has(node.dataset.collectionSelect); });
  $('[data-collection-action="add"]', root).disabled = state.busy || !state.selected.size;
  const unavailable = state.draft?.items?.some(item => item.unavailable);
  $('[data-collection-action="export"]', root).disabled = state.busy || !state.draft?.items?.length || Boolean(unavailable || state.draft?.templateUnavailable || state.draft?.eventTemplateUnavailable);
  const warning = $('#collection-export-warning');
  warning.textContent = state.draft?.eventTemplateUnavailable ? 'Закреплённая версия полей недоступна. Выберите другой шаблон и сохраните план.' : unavailable ? 'Для выгрузки восстановите доступ к источникам или исключите недоступные пункты из состава.' : state.draft?.templateUnavailable ? 'Сохранённый образец недоступен. Выберите другой образец или стандартную таблицу и сохраните план.' : '';
  warning.classList.toggle('hidden', !warning.textContent);
  const memberships = state.draft?.items || [];
  const firstId = memberships[0]?.id, lastId = memberships.at(-1)?.id;
  $$('[data-collection-action="up"], [data-collection-action="down"]', root).forEach(button => {
    button.disabled = state.busy || button.dataset.membership === (button.dataset.collectionAction === 'up' ? firstId : lastId);
  });
  $('[data-collection-action="suggest"]').disabled = state.suggestionBusy || !state.filters.department.trim() || state.busy || state.designerDirty;
  $('[data-collection-action="cancel-suggest"]').classList.toggle('hidden', !state.suggestionBusy);
  const includedSuggestions = new Set((state.draft?.items || []).map(item => item.plan_item_id));
  $$('[data-suggestion-select]').forEach(node => { node.disabled = state.busy || includedSuggestions.has(node.dataset.suggestionSelect); });
  $$('[data-details-readonly]').forEach(node => { node.disabled = true; });
  const approve = $('[data-collection-action="apply-suggestion"]'); if (approve) approve.disabled = state.busy || !state.suggestedSelected.size;
  const more = $('[data-collection-action="suggest-more"]'); if (more) more.disabled = state.busy || state.suggestionBusy;
  if (state.designerDirty) { $('[data-collection-action="export"]').disabled = true; warning.textContent = 'Сохраните изменения шаблона перед подбором или выгрузкой.'; warning.classList.remove('hidden'); }
  $('#collection-selection-count').textContent = `Выбрано: ${state.selected.size}`;
  $('#collection-members-tab').textContent = `В плане · ${state.draft?.items?.length || 0}`;
}
function renderSelectors() {
  const saved = $('#collection-saved');
  saved.innerHTML = '<option value="">Новый план на месяц</option>' + state.drafts.filter(draft => draft.month_key === state.month).map(draft => `<option value="${esc(draft.id)}">${esc(draft.title)}</option>`).join('');
  saved.value = state.draft?.id || '';
  $('#collection-month').value = state.month;
  $('#collection-title').value = state.metadata.title || defaultTitle();
  const templates = state.templates.filter(template => template.period_kind === 'monthly');
  const missingTemplate = state.metadata.templateId && !templates.some(template => template.id === state.metadata.templateId);
  $('#collection-template').innerHTML = '<option value="">Стандартная таблица</option>' + templates.map(template => `<option value="${esc(template.id)}">${esc(template.name)}</option>`).join('') + (missingTemplate ? `<option value="${esc(state.metadata.templateId)}">Сохранённый образец недоступен</option>` : '');
  $('#collection-template').value = state.metadata.templateId || '';
  for (const item of state.eventTemplates) { const version = item.currentVersion || { id: item.currentVersionId, templateId: item.id, version: item.version, title: item.title, definition: item.definition }; state.eventVersions.set(version.id, version); }
  const versions = state.eventTemplates.map(item => state.eventVersions.get(item.currentVersionId || item.currentVersion?.id)).filter(Boolean);
  const pinned = state.eventVersions.get(state.metadata.eventTemplateVersionId); if (pinned && !versions.some(item => item.id === pinned.id)) versions.push(pinned);
  $('#collection-event-template').innerHTML = '<option value="">Стандартные поля</option>' + versions.map(item => `<option value="${esc(item.id)}">${esc(item.title)} · версия ${item.version}</option>`).join('');
  $('#collection-event-template').value = state.metadata.eventTemplateVersionId || '';
  $('#collection-department').value = state.filters.department;
  $('#collection-source-plan').innerHTML = '<option value="">Все планы</option>' + state.plans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.title)}</option>`).join('');
  $('#collection-source-plan').value = state.filters.planId;
  syncControls();
}
function selectedEventTemplate() { return state.eventVersions.get(state.metadata.eventTemplateVersionId) || null; }
function metadataChanged(payload, draft) {
  return payload.title !== draft.title || (payload.templateId || null) !== (draft.template_id || null)
    || (payload.eventTemplateVersionId || null) !== (draft.event_template_version_id || null)
    || (payload.departmentText || '') !== (draft.department_text || '');
}
function renderEventDetails(source) {
  const custom = templateFields(selectedEventTemplate()).filter(field => field.source === 'custom');
  const edit = state.detailsEdits.get(source.id) || { location: source.location || '', customValues: source.customValues || {} };
  const disabled = source.canEditDetails ? '' : 'disabled data-details-readonly="true"';
  return `<details class="collection-event-details" data-event-details="${esc(source.id)}" ${state.detailsEdits.has(source.id) ? 'open' : ''}><summary>${source.location ? `Место: ${esc(source.location)}` : 'Место и дополнительные поля'}${state.detailsEdits.has(source.id) ? ' · есть правки' : ''}</summary><form data-event-details-form="${esc(source.id)}"><p class="collection-help">Данные мероприятия сохраняются в исходном плане и доступны в следующих месячных планах.</p><label class="field"><span>Место</span><input name="location" value="${esc(edit.location)}" maxlength="1000" ${disabled}></label>${custom.map(field => `<label class="field"><span>${esc(field.label)}</span>${fieldInput(field, edit.customValues[field.key] ?? '', { attributes: `data-event-custom-field="${esc(field.key)}" ${disabled}` })}</label>`).join('')}${source.canEditDetails ? '<button type="submit" class="secondary-button" data-collection-mutation>Сохранить данные мероприятия</button>' : '<p class="collection-help">Доступно только чтение данных этого мероприятия.</p>'}</form></details>`;
}
function readEventDetails(form) {
  const source = state.events.find(item => item.id === form.dataset.eventDetailsForm);
  const values = { location: $('[name="location"]', form).value, customValues: { ...(state.detailsEdits.get(source.id)?.customValues || source.customValues || {}) } };
  for (const node of $$('[data-event-custom-field]', form)) values.customValues[node.dataset.eventCustomField] = node.value;
  return values;
}
async function saveEventDetails(form) {
  const id = form.dataset.eventDetailsForm, source = state.events.find(item => item.id === id), values = readEventDetails(form);
  state.detailsEdits.set(id, values);
  const customValues = {}; for (const field of templateFields(selectedEventTemplate()).filter(field => field.source === 'custom')) if (Object.hasOwn(values.customValues, field.key) && String(values.customValues[field.key] ?? '') !== String(source.customValues?.[field.key] ?? '')) customValues[field.key] = values.customValues[field.key];
  await api(`/api/plan-events/${encodeURIComponent(id)}/details`, json('PATCH', { expectedRevision: source.detailsRevision || 0, templateVersionId: state.metadata.eventTemplateVersionId || null, location: values.location, customValues }));
  state.detailsEdits.delete(id); clearSuggestions();
  if (state.draft) acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`), { preserveMetadata: true });
  await loadEvents(); message('Данные мероприятия сохранены.');
}
function renderMemberFields(item, edit) {
  const template = selectedEventTemplate(), fields = template ? templateFields(template, true) : [
    { source: 'title', label: 'Формулировка для выгрузки', required: true }, { source: 'date', label: 'Срок в документе' },
    { source: 'responsible', label: 'Ответственный в документе' }, { source: 'location', label: 'Место в документе' },
    { source: 'result', label: 'Ожидаемый результат' }, { source: 'note', label: 'Примечание' }
  ];
  const names = { title: 'titleOverride', date: 'dateTextOverride', responsible: 'responsibleOverride', location: 'locationOverride', result: 'expectedResultOverride', note: 'note' };
  return fields.map(field => {
    if (field.source === 'activity') return `<div class="field"><span>${esc(field.label)}</span><p>${esc(kinds[item.effective?.activityKind] || kinds[item.source?.activity_kind] || '')}</p></div>`;
    const name = names[field.source], value = field.source === 'custom' ? (edit.customValues?.[field.key] ?? '') : (edit[name] ?? '');
    const missing = field.required && String(value).trim() === '';
    return `<label class="field ${field.source === 'title' ? 'collection-title-field' : ''}"><span>${esc(field.label)}${field.required ? ' *' : ''}</span>${fieldInput({ ...field, type: field.type || 'text' }, value, { name: name || '', attributes: field.source === 'custom' ? `data-monthly-custom-field="${esc(field.key)}"` : '', required: field.source === 'title' })}${missing ? '<small class="collection-required-hint">Заполните перед выгрузкой</small>' : ''}</label>`;
  }).join('');
}
function cancelSuggestion(showMessage = false) {
  state.suggestionSequence += 1; state.suggestionController?.abort(); state.suggestionController = null; state.suggestionBusy = false;
  if (showMessage) { $('#collection-suggest-status').textContent = 'Подбор остановлен. Сохранённые мероприятия не изменены.'; $('#collection-suggestion-preview')?.classList.add('hidden'); }
  if ($('#plan-collection')) syncControls();
}
function hideSuggestions() {
  $('#collection-suggestion-preview')?.classList.add('hidden');
  syncControls();
}
function clearSuggestions() {
  cancelSuggestion(); state.suggestions = null; state.suggestedSelected.clear(); state.suggestionRequest = null;
  hideSuggestions();
  if ($('#collection-suggest-status')) $('#collection-suggest-status').textContent = 'Укажите кафедру — система предложит мероприятия для неё.';
}
function suggestionParameters(offset = 0) {
  return { month: state.month, department: state.filters.department.trim(), eventTemplateVersionId: state.metadata.eventTemplateVersionId || null,
    includeUndated: state.filters.includeUndated, ...(state.filters.planId ? { planId: state.filters.planId } : {}), ...(state.filters.q ? { q: state.filters.q } : {}),
    ...(state.filters.activityKind ? { activityKind: state.filters.activityKind } : {}), offset };
}
function suggestionPreviewItem(item) {
  const source = item.source || {}, values = { ...(source.customValues || {}) };
  for (const [key, proposal] of Object.entries(item.suggestedFields?.customValues || {})) values[key] = proposal.value;
  return { source, effective: { title: source.title, dateText: source.starts_at || source.due_date ? dates(source) : '', responsibleRaw: source.responsible_raw || source.responsible_name || '', location: item.suggestedFields?.location?.value ?? source.location ?? '', customValues: values, expectedResult: source.expected_result || '', activityKind: source.activity_kind } };
}
function renderSuggestions() {
  const root = $('#collection-suggestion-preview'), result = state.suggestions;
  if (!result) { hideSuggestions(); return; }
  root.classList.remove('hidden');
  const included = new Set((state.draft?.items || []).map(item => item.plan_item_id));
  const selected = result.items.filter(item => state.suggestedSelected.has(item.planItemId));
  const fields = templateFields(selectedEventTemplate(), true);
  const selectedPreview = selected.map(suggestionPreviewItem);
  root.innerHTML = `<header class="collection-designer-heading"><div><h4 tabindex="-1">Предварительный подбор</h4><p class="collection-help">${result.method === 'rules' ? 'Подбор по тексту и данным источников. Локальная модель не использовалась.' : 'Мероприятия предварительно отсортированы с помощью локальной модели. Проверьте основания выбора.'} Отмечены рекомендуемые строки; остальные доступны ниже.</p></div><button type="button" class="text-button" data-collection-action="hide-suggestions" data-collection-mutation>К списку мероприятий</button></header>${result.warnings?.length ? `<ul class="collection-help">${result.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}${selectedEventTemplate() ? previewTable(selectedEventTemplate().definition, selectedPreview, { caption: state.metadata.title || defaultTitle() }) : ''}
    <div class="collection-suggestion-list">${result.items.length ? result.items.map(item => {
      const source = item.source || {}, isIncluded = included.has(item.planItemId), preview = suggestionPreviewItem(item);
      const prepared = fields.filter(field => field.source === 'custom' || field.source === 'location').map(field => { const value = fieldValue(field, preview); const proposal = field.source === 'location' ? item.suggestedFields?.location : item.suggestedFields?.customValues?.[field.key]; return `<div><dt>${esc(field.label)}</dt><dd>${String(value ?? '').trim() ? esc(value) : '<span class="collection-empty-cell">Не указано в источнике</span>'}${proposal ? `<small>Из источника: «${esc(proposal.quote)}»</small>` : ''}</dd></div>`; }).join('');
      return `<article class="collection-suggestion-row" data-suggestion-event="${esc(item.planItemId)}"><label class="collection-suggestion-choice"><input type="checkbox" data-suggestion-select="${esc(item.planItemId)}" ${isIncluded || state.suggestedSelected.has(item.planItemId) ? 'checked' : ''} ${isIncluded ? 'disabled' : ''}><span><strong>${esc(source.title)}</strong><small>${isIncluded ? 'Уже в плане' : ({ recommended: 'Рекомендуется', review: 'Требует решения', other: 'Другие мероприятия' })[item.relevance] || 'Требует решения'} · ${esc(dates(source))}</small></span></label><p>${esc(item.reason)}</p>${item.quote ? `<details><summary>Основание в источнике</summary><blockquote>${esc(item.quote)}</blockquote>${sourceLinks(source)}</details>` : sourceLinks(source)}${prepared ? `<dl class="collection-proposed-fields">${prepared}</dl>` : ''}</article>`;
    }).join('') : '<p>Для выбранного периода мероприятий нет.</p>'}</div>
    <div class="collection-plan-actions"><span>Выбрано: ${state.suggestedSelected.size}</span><button type="button" class="primary-button" data-collection-action="apply-suggestion" data-collection-mutation>Принять выбранные</button>${result.hasMore ? '<button type="button" class="secondary-button" data-collection-action="suggest-more">Подобрать следующую часть</button>' : ''}</div><p class="collection-help">После принятия откроется заполненный план. Формулировки и дополнительные поля можно уточнить перед выгрузкой. Исходные мероприятия не изменяются.</p>`;
  applyPreviewColumnWidths(root);
  syncControls();
  for (const node of $$('[data-suggestion-select]')) if (included.has(node.dataset.suggestionSelect)) node.disabled = true;
}
async function suggestEvents(append = false) {
  if (state.suggestionBusy || state.busy) return;
  if (!state.filters.department.trim()) { message('Укажите кафедру или подразделение для подбора.', true); $('#collection-department').focus(); return; }
  if (state.designerDirty) { message('Сохраните шаблон перед подбором.', true); return; }
  const params = suggestionParameters(append ? state.suggestions?.nextOffset || 0 : 0), signature = JSON.stringify(params);
  if (state.suggestionRequest?.signature !== signature) state.suggestionRequest = { signature, key: `plan-suggestion-ui:${newPlanOperationId()}` };
  const sequence = ++state.suggestionSequence; state.suggestionBusy = true;
  const controller = new AbortController(); state.suggestionController = controller;
  let failed = false;
  message();
  $('#collection-suggest-status').textContent = 'Подбираем мероприятия и заполняем доступные поля…'; syncControls();
  try {
    const result = await api('/api/plan-events/suggest', { ...json('POST', { ...params, idempotencyKey: state.suggestionRequest.key }), signal: controller.signal });
    if (sequence !== state.suggestionSequence) return;
    const included = new Set((state.draft?.items || []).map(item => item.plan_item_id));
    if (!append) { state.suggestedSelected.clear(); state.suggestions = { ...result, items: [], runs: [] }; }
    const priorIds = new Set(state.suggestions.items.map(item => item.planItemId));
    state.suggestions.items.push(...(result.items || []).filter(item => !priorIds.has(item.planItemId)));
    state.suggestions.runs.push({ runId: result.runId, ids: (result.items || []).map(item => item.planItemId) });
    state.suggestions.hasMore = result.hasMore; state.suggestions.nextOffset = result.nextOffset;
    state.suggestions.warnings = [...new Set([...(state.suggestions.warnings || []), ...(result.warnings || [])])];
    if (state.suggestions.method !== result.method) state.suggestions.method = 'mixed';
    for (const item of result.items || []) if (item.relevance === 'recommended' && !included.has(item.planItemId)) state.suggestedSelected.add(item.planItemId);
    renderSuggestions();
    $('#collection-suggest-status').textContent = `Подбор готов: ${state.suggestions.items.length} мероприятий, рекомендовано ${state.suggestedSelected.size}.${result.hasMore ? ' Доступна следующая часть.' : ''}`;
    $('#collection-suggestion-preview h4')?.focus();
  } catch (error) { if (sequence === state.suggestionSequence && error.name !== 'AbortError') { failed = true; hideSuggestions(); $('#collection-suggest-status').textContent = 'Подбор не завершён. Повторите запрос или выберите мероприятия из списка; сохранённые данные не изменены.'; message(error.message, true); } }
  finally { if (sequence === state.suggestionSequence) { state.suggestionBusy = false; state.suggestionController = null; syncControls(); if (failed && state.open && state.tab === 'events') $('[data-collection-action="suggest"]')?.focus(); } }
}
async function applySuggestions() {
  if (!state.suggestions || !state.suggestedSelected.size) return;
  const proposal = state.suggestions, selected = new Set(state.suggestedSelected);
  const runs = proposal.runs.map(run => ({ runId: run.runId, ids: run.ids.filter(id => selected.has(id)) })).filter(run => run.ids.length);
  const context = { sequence: state.suggestionSequence, parameters: JSON.stringify(suggestionParameters()), createKey: state.createKey };
  let draftId = state.draft?.id || null;
  const isCurrent = () => state.suggestions === proposal && state.suggestionSequence === context.sequence
    && JSON.stringify(suggestionParameters()) === context.parameters && state.createKey === context.createKey
    && (!draftId || state.draft?.id === draftId);
  const requireCurrent = () => { if (!isCurrent()) throw new Error('Контекст подбора изменился. Откройте сохранённый план, чтобы проверить результат принятия.'); };
  await saveMetadata([], { isCurrent });
  requireCurrent(); draftId = state.draft.id;
  let applied = 0; const failures = [];
  for (const run of runs) {
    requireCurrent();
    const result = await api(`/api/monthly-plans/${encodeURIComponent(draftId)}/apply-suggestion`, json('POST', { runId: run.runId, planItemIds: run.ids, expectedRevision: state.draft.revision }));
    requireCurrent();
    acceptDraft(result.draft || result);
    for (const row of result.results || []) {
      if (['added', 'existing', 'applied'].includes(row.status)) { state.suggestedSelected.delete(row.planItemId); applied += 1; }
      else if (row.status === 'error') failures.push(row.message || 'Одно мероприятие не добавлено.');
    }
    for (const item of state.draft.items || []) if (!item.unavailable) { state.suggestedSelected.delete(item.plan_item_id); state.selected.delete(item.plan_item_id); }
  }
  requireCurrent(); renderSuggestions(); setTab('members');
  message(failures.length ? `Сохранено ${applied}. ${failures.join(' ')}` : 'Выбранные мероприятия приняты. Проверьте заполненные поля и скачайте документ.', Boolean(failures.length));
}

function renderEvents() {
  const included = new Set((state.draft?.items || []).filter(item => !item.unavailable).map(item => item.plan_item_id));
  $('#collection-events').innerHTML = state.events.length ? `<table class="collection-table"><thead><tr><th><span class="sr-only">Выбор</span></th><th>Мероприятие</th><th>Срок</th><th>Ответственный</th><th>Источник</th></tr></thead><tbody>${state.events.map(item => `<tr data-collection-event="${esc(item.id)}">
    <td class="collection-choice"><input type="checkbox" data-collection-select="${esc(item.id)}" aria-label="Выбрать: ${esc(item.title)}" ${included.has(item.id) ? 'checked disabled' : state.selected.has(item.id) ? 'checked' : ''}></td>
    <td><strong>${esc(item.title)}</strong><small>${esc(kinds[item.activity_kind] || directions[item.direction] || 'Мероприятие')}${included.has(item.id) ? ' · Уже в плане' : ''}</small>${renderEventDetails(item)}</td>
    <td data-label="Срок">${esc(dates(item))}</td><td data-label="Ответственный">${esc(item.responsible_raw || item.responsible_name || 'Не указан')}</td><td>${sourceLinks(item)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">Мероприятий по этим условиям нет. Измените фильтры или загрузите исходные планы.</div>';
  syncControls();
}
function sourceMemberEdit(source) {
  return { titleOverride: source.title || '', dateTextOverride: source.starts_at || source.due_date ? dates(source) : '', responsibleOverride: source.responsible_raw || '', expectedResultOverride: source.expected_result || '', locationOverride: source.location || '', customValues: source.customValues || {} };
}
function memberEdit(item) {
  const inherited = sourceMemberEdit(item.source || {}), effective = item.effective || {};
  return state.edits.get(item.id) || {
    titleOverride: effective.title ?? item.title_override ?? inherited.titleOverride,
    dateTextOverride: effective.dateText ?? item.date_text_override ?? inherited.dateTextOverride,
    responsibleOverride: effective.responsibleRaw ?? item.responsible_override ?? inherited.responsibleOverride,
    expectedResultOverride: effective.expectedResult ?? item.expected_result_override ?? inherited.expectedResultOverride,
    note: item.note || '', locationOverride: effective.location ?? item.location_override ?? inherited.locationOverride, customValues: { ...(effective.customValues || inherited.customValues) }
  };
}
function renderMembers() {
  const items = state.draft?.items || [];
  $('#collection-members').innerHTML = items.length ? items.map((item, index) => {
    if (item.unavailable) return `<article class="collection-member"><strong>Источник недоступен</strong><p>Пункт сохранён в составе. Его данные и выгрузка недоступны без доступа к источнику.</p><button type="button" class="text-button" data-collection-action="remove" data-membership="${esc(item.id)}" data-collection-mutation>Исключить из месячного плана</button></article>`;
    const edit = memberEdit(item), source = item.source || {}, effective = item.effective || {};
    return `<article class="collection-member" data-collection-member="${esc(item.id)}"><header><div><strong>${index + 1}. ${esc(effective.title || source.title)}</strong>${sourceLinks(source)}</div><div class="collection-order"><button type="button" class="text-button" data-collection-action="up" data-membership="${esc(item.id)}" data-collection-mutation ${index ? '' : 'disabled'} aria-label="Поднять: ${esc(effective.title || source.title)}">Выше</button><button type="button" class="text-button" data-collection-action="down" data-membership="${esc(item.id)}" data-collection-mutation ${index === items.length - 1 ? 'disabled' : ''} aria-label="Опустить: ${esc(effective.title || source.title)}">Ниже</button><button type="button" class="text-button" data-collection-action="remove" data-membership="${esc(item.id)}" data-collection-mutation>Исключить</button></div></header>
      <form class="collection-item-form" data-membership="${esc(item.id)}">${renderMemberFields(item, edit)}<div class="collection-item-actions"><button type="submit" class="secondary-button" data-collection-mutation>Сохранить формулировки</button><button type="button" class="text-button" data-collection-action="reset-item" data-membership="${esc(item.id)}" data-collection-mutation>Как в источнике</button>${state.edits.has(item.id) ? '<span>Есть несохранённые правки</span>' : ''}</div></form></article>`;
  }).join('') : '<div class="empty-state">Выберите мероприятия из общего списка и добавьте их в этот план.</div>';
  templateEditor?.refreshPreview();
  syncControls();
}
async function loadEvents(append = false) {
  const sequence = ++state.requestSequence;
  const target = $('#collection-events');
  target.setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ month: state.month, limit: '100', offset: String(append ? state.nextOffset : 0), includeUndated: state.filters.includeUndated ? '1' : '0' });
  for (const [key, value] of Object.entries(state.filters)) if (key !== 'includeUndated' && value) params.set(key, value);
  try {
    const payload = await api(`/api/plan-events?${params}`);
    if (sequence !== state.requestSequence) return;
    state.events = append ? [...state.events, ...payload.items.filter(item => !state.events.some(existing => existing.id === item.id))] : payload.items || [];
    state.hasMore = Boolean(payload.hasMore);
    state.nextOffset = payload.nextOffset ?? state.events.length;
    renderEvents();
  } catch (error) { if (sequence === state.requestSequence) message(error.message, true); }
  finally { if (sequence === state.requestSequence) target.setAttribute('aria-busy', 'false'); }
}
async function reloadLists() {
  const sequence = ++state.listSequence;
  const [drafts, templates, plans, eventTemplates] = await Promise.all([api(`/api/monthly-plans?month=${encodeURIComponent(state.month)}&limit=500`), api('/api/plan-templates?limit=300'), api('/api/plans?status=active&limit=1000'), api('/api/event-templates')]);
  if (sequence !== state.listSequence) return;
  state.drafts = drafts.items || []; state.templates = templates.items || []; state.plans = plans.items || []; state.eventTemplates = eventTemplates.items || [];
  renderSelectors();
}
async function open() {
  if (!ensureUi()) return;
  state.open = true;
  $('[data-view-panel="plans"]').classList.add('collection-open');
  $('#plan-collection').classList.remove('hidden');
  if (!state.metadata.title) state.metadata.title = defaultTitle();
  $('#plan-collection h3').focus();
  setTab(state.tab);
  renderSelectors(); renderMembers();
  await Promise.all([reloadLists(), loadEvents()]);
}
function close() {
  cancelSuggestion();
  state.open = false;
  $('[data-view-panel="plans"]')?.classList.remove('collection-open');
  $('#plan-collection')?.classList.add('hidden');
  $('#plan-collection-open')?.focus();
}
function acceptDraft(draft, { preserveMetadata = false } = {}) {
  const pending = preserveMetadata ? { metadata: { ...state.metadata }, filters: { ...state.filters } } : null;
  state.draft = draft;
  state.month = draft.month_key;
  state.metadata = { title: draft.title, templateId: draft.template_id || '', eventTemplateVersionId: draft.event_template_version_id || '', departmentText: draft.department_text || '' };
  if (draft.eventTemplate) state.eventVersions.set(draft.eventTemplate.id, draft.eventTemplate);
  state.filters.department = state.metadata.departmentText;
  if (pending) { state.metadata = pending.metadata; state.filters = pending.filters; }
  state.exportRequest = null;
  const index = state.drafts.findIndex(item => item.id === draft.id);
  if (index < 0) state.drafts.unshift(draft); else state.drafts[index] = draft;
  renderSelectors(); renderMembers(); renderEvents();
}
async function mutate(action, { focusOnSuccess = '' } = {}) {
  if (state.busy) return;
  state.busy = true; syncControls(); message('Сохраняем…');
  let completed = false;
  try { await action(); completed = true; }
  catch (error) {
    message(`${error.message}${/revision|stale|conflict/.test(error.code || '') ? ' Обновите сохранённый план перед повторной попыткой. Ваши формулировки оставлены в редакторе.' : ''}`, true);
  } finally { state.busy = false; syncControls(); if (completed && state.open && focusOnSuccess) $(focusOnSuccess)?.focus(); }
}
function metadataPayload() {
  const title = $('#collection-title').value.trim();
  if (!title) throw new Error('Укажите название месячного плана.');
  state.metadata = { title, templateId: $('#collection-template').value, eventTemplateVersionId: $('#collection-event-template').value, departmentText: state.filters.department };
  return { title, templateId: state.metadata.templateId || null, eventTemplateVersionId: state.metadata.eventTemplateVersionId || null, departmentText: state.metadata.departmentText };
}
async function saveMetadata(planItemIds = [], { isCurrent = () => true } = {}) {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('Контекст плана изменился. Сохранённый результат доступен в списке месячных планов.'); };
  requireCurrent();
  const payload = metadataPayload();
  if (!state.draft) {
    state.pendingCreate ||= { month: state.month, ...payload, planItemIds, idempotencyKey: `monthly-ui:${state.createKey}` };
    let draft;
    try { draft = await api('/api/monthly-plans', json('POST', state.pendingCreate)); }
    catch (error) { if (error.status && error.status < 500) state.pendingCreate = null; throw error; }
    requireCurrent();
    state.pendingCreate = null;
    acceptDraft(draft);
    if (metadataChanged(payload, draft)) {
      state.metadata = { title: payload.title, templateId: payload.templateId || '', eventTemplateVersionId: payload.eventTemplateVersionId || '', departmentText: payload.departmentText || '' };
      renderSelectors();
      const updated = await api(`/api/monthly-plans/${encodeURIComponent(draft.id)}`, json('PATCH', { ...payload, expectedRevision: draft.revision }));
      requireCurrent(); acceptDraft(updated);
    }
    if (draft.duplicateRequest) {
      const included = new Set(state.draft.items.filter(item => !item.unavailable).map(item => item.plan_item_id));
      const missing = planItemIds.filter(id => !included.has(id));
      const recovered = planItemIds.filter(id => included.has(id)).map(planItemId => ({ planItemId, status: 'existing' }));
      if (missing.length) {
        const result = await api(`/api/monthly-plans/${encodeURIComponent(draft.id)}/items`, json('POST', { planItemIds: missing, expectedRevision: state.draft.revision }));
        requireCurrent(); acceptDraft(result.draft);
        return [...recovered, ...result.results];
      }
      return recovered;
    }
    return draft.results || [];
  }
  const changed = metadataChanged(payload, state.draft);
  if (changed) { const updated = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`, json('PATCH', { ...payload, expectedRevision: state.draft.revision })); requireCurrent(); acceptDraft(updated); }
  if (!planItemIds.length) return [];
  const result = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/items`, json('POST', { planItemIds, expectedRevision: state.draft.revision }));
  requireCurrent(); acceptDraft(result.draft);
  return result.results || [];
}
async function addSelected() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const results = await saveMetadata(ids);
  for (const result of results) if (['added', 'existing'].includes(result.status)) state.selected.delete(result.planItemId);
  for (const item of state.draft.items || []) if (!item.unavailable) state.selected.delete(item.plan_item_id);
  const failures = results.filter(result => result.status === 'error');
  renderEvents();
  if (failures.length) message(`Добавлено ${results.length - failures.length}. Не добавлено ${failures.length}: ${failures.map(item => item.message).filter(Boolean).join(' ')}`, true);
  else { setTab('members'); message(`Мероприятия добавлены в «${state.draft.title}».`); }
}
function editFromForm(form) {
  const item = state.draft.items.find(member => member.id === form.dataset.membership), values = { ...memberEdit(item), customValues: { ...memberEdit(item).customValues } };
  for (const key of ['titleOverride', 'dateTextOverride', 'responsibleOverride', 'expectedResultOverride', 'note', 'locationOverride']) { const node = $(`[name="${key}"]`, form); if (node) values[key] = node.value; }
  for (const node of $$('[data-monthly-custom-field]', form)) values.customValues[node.dataset.monthlyCustomField] = node.value;
  return values;
}
async function saveItem(form, reset = false) {
  const id = form.dataset.membership;
  const values = { titleOverride: null, dateTextOverride: null, responsibleOverride: null, expectedResultOverride: null, note: null, locationOverride: null, customValues: null };
  const enteredValues = reset ? null : editFromForm(form);
  await saveMetadata();
  if (!reset) {
    const item = state.draft.items.find(member => member.id === id);
    const inherited = sourceMemberEdit(item.source || {});
    const entered = Object.fromEntries(Object.entries(enteredValues).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    if (!entered.titleOverride) throw new Error('Укажите формулировку мероприятия.');
    for (const [field, column] of Object.entries({ titleOverride: 'title_override', dateTextOverride: 'date_text_override', responsibleOverride: 'responsible_override', expectedResultOverride: 'expected_result_override', locationOverride: 'location_override' })) {
      const keepEmptyOverride = entered[field] === '' && item[column] !== null && item[column] !== undefined;
      values[field] = entered[field] === inherited[field].trim() && !keepEmptyOverride ? null : entered[field];
    }
    values.note = entered.note;
    values.customValues = {};
    for (const field of templateFields(selectedEventTemplate()).filter(field => field.source === 'custom')) { if (Object.hasOwn(entered.customValues || {}, field.key)) { const value = String(entered.customValues[field.key] ?? '').trim(); if (value === String(item.effective?.customValues?.[field.key] ?? '')) continue; values.customValues[field.key] = value !== '' && value === String(inherited.customValues[field.key] ?? '') ? null : value; } }
  }
  const draft = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/items/${encodeURIComponent(id)}`, json('PATCH', { ...values, expectedRevision: state.draft.revision }));
  state.edits.delete(id); acceptDraft(draft); message('Формулировки сохранены.');
}
async function removeItem(id) {
  const draft = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/items/${encodeURIComponent(id)}?expectedRevision=${state.draft.revision}`, { method: 'DELETE' });
  state.edits.delete(id); acceptDraft(draft, { preserveMetadata: true }); message('Мероприятие исключено из месячного плана. Оно остаётся в исходном плане и календаре.');
}
async function moveItem(id, delta) {
  const ids = state.draft.items.map(item => item.id), index = ids.indexOf(id), target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`, json('PATCH', { expectedRevision: state.draft.revision, orderedItemIds: ids })), { preserveMetadata: true });
  message('Порядок мероприятий сохранён.');
}
async function exportDraft() {
  if (state.designerDirty) throw new Error('Сохраните шаблон перед выгрузкой.');
  if (state.edits.size && state.draft.items.some(item => state.edits.has(item.id))) throw new Error('Сохраните формулировки изменённых строк перед выгрузкой.');
  await saveMetadata();
  const signature = `${state.draft.id}:${state.draft.revision}`;
  if (state.exportRequest?.signature !== signature) state.exportRequest = { signature, key: `monthly-export:${newPlanOperationId()}` };
  message('Формируем DOCX…');
  const result = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/export`, json('POST', { expectedRevision: state.draft.revision, idempotencyKey: state.exportRequest.key }));
  const url = result.downloadUrl || `/api/documents/${encodeURIComponent(result.documentId)}/content?variant=original`;
  const link = document.createElement('a'); link.href = url; link.download = ''; link.textContent = 'Скачать подготовленный DOCX';
  $('#collection-message').replaceChildren(document.createTextNode('Документ готов. '), link);
  link.click();
}
function renderTemplateReview(analysis) {
  const root = $('#collection-template-review');
  root.classList.remove('hidden');
  const periods = (analysis.periodCandidates || []).map((period, index) => ({ ...period, index })).filter(period => period.kind === 'monthly');
  const tables = analysis.tableCandidates || [];
  root.innerHTML = `<h4>Уточните образец</h4><p>Исходный DOCX сохранён. Выберите подпись месяца и таблицу мероприятий.</p><a href="/api/documents/${encodeURIComponent(state.templateSource.documentId)}/content?variant=original" target="_blank" rel="noopener">Открыть исходный образец</a>
    ${!periods.length || !tables.length ? '<p role="alert">Не найден заголовок месяца или простая таблица мероприятий. Добавьте в DOCX заголовок «План на ноябрь 2026 года» и таблицу с колонками «Мероприятие», «Срок», затем загрузите исправленный образец. До этого доступна стандартная таблица.</p>' : `<form id="collection-template-form"><div class="collection-filters"><label class="field"><span>Подпись месяца</span><select name="periodIndex">${periods.map(period => `<option value="${period.index}">${esc(period.text)}</option>`).join('')}</select></label><label class="field"><span>Таблица мероприятий</span><select name="tableIndex" id="collection-template-table">${tables.map((table, index) => `<option value="${index}">Таблица ${table.tableIndex} · ${table.rowCount} строк</option>`).join('')}</select></label><label class="field"><span>Название образца</span><input name="name" value="${esc(state.templateSource.name)}" required></label></div><div id="collection-template-columns"></div><div class="collection-plan-actions"><button type="submit" class="primary-button" data-collection-mutation>Сохранить образец</button><button type="button" class="text-button" data-collection-action="cancel-template">Закрыть</button></div></form>`}`;
  renderTemplateColumns();
}
function renderTemplateColumns() {
  const root = $('#collection-template-columns');
  if (!root) return;
  const table = state.templateAnalysis?.tableCandidates?.[Number($('#collection-template-table').value)];
  if (!table) return;
  const labels = { number: 'Номер', title: 'Мероприятие', date: 'Срок', deadline: 'Контрольный срок', responsible: 'Ответственный', result: 'Результат', description: 'Примечание', direction: 'Направление', status: 'Состояние' };
  const headers = table.preview?.[0]?.cells || [];
  root.innerHTML = `<div class="collection-template-preview"><table class="collection-table"><tbody>${(table.preview || []).map(row => `<tr>${row.cells.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="collection-filters">${Array.from({ length: table.columnCount }, (_, index) => {
    const field = Object.entries(table.columns || {}).find(([, column]) => Number(column) === index + 1)?.[0] || '';
    return `<label class="field"><span>${esc(headers[index] || `Колонка ${index + 1}`)}</span><select data-template-column="${index + 1}"><option value="">Очистить колонку</option>${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === field ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  }).join('')}</div>`;
}
async function saveTemplate(config = null, name = state.templateSource.name) {
  const template = await api('/api/plan-templates', json('POST', { documentId: state.templateSource.documentId, planKind: 'department', name, ...(config ? { config } : {}) }));
  if (template.period_kind !== 'monthly') throw new Error('Для месячного плана нужен образец с подписью месяца.');
  state.templates = [...state.templates.filter(item => item.id !== template.id), template];
  state.metadata.templateId = template.id;
  $('#collection-template-review').classList.add('hidden');
  renderSelectors();
  message('Образец сохранён. Его можно выбирать для следующих месяцев. Сохраните план, чтобы закрепить выбор.');
}
async function uploadTemplate(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.docx')) throw new Error('Для образца выберите файл DOCX.');
  const prior = state.templateSource;
  if (!prior || prior.file !== file) state.templateSource = { file, name: file.name.replace(/\.docx$/i, ''), key: null };
  const source = state.templateSource;
  if (!source.documentId) {
    source.key ||= await planUploadKey(file, 'monthly-template');
    const uploaded = await api('/api/documents', { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-document-type': 'plan_template', 'idempotency-key': source.key }, body: file });
    source.documentId = uploaded.documentId;
  }
  try {
    const analysis = await api('/api/plan-templates/analyze', json('POST', { documentId: source.documentId, planKind: 'department' }));
    state.templateAnalysis = analysis;
    if (analysis.ready && analysis.detectedPeriod?.kind === 'monthly') await saveTemplate();
    else { renderTemplateReview(analysis); message('Образец сохранён. Уточните его структуру.'); }
  } catch (error) {
    const root = $('#collection-template-review');
    root.classList.remove('hidden');
    root.innerHTML = `<p>Исходный образец сохранён. Повторите настройку без загрузки файла.</p><button type="button" class="secondary-button" data-collection-action="retry-template" data-collection-mutation>Повторить настройку</button><a href="/api/documents/${encodeURIComponent(source.documentId)}/content?variant=original" target="_blank" rel="noopener">Исходный образец</a>`;
    throw error;
  }
}
async function saveTemplateMapping(form) {
  const data = new FormData(form), analysis = state.templateAnalysis;
  const period = analysis.periodCandidates[Number(data.get('periodIndex'))], table = analysis.tableCandidates[Number(data.get('tableIndex'))];
  if (!period || !table?.templateRow) throw new Error('Выберите подпись месяца и таблицу с примером строки.');
  const columns = {}, clearColumns = [];
  for (const select of $$('[data-template-column]', form)) {
    if (!select.value) clearColumns.push(Number(select.dataset.templateColumn));
    else if (columns[select.value]) throw new Error('Каждому полю должна соответствовать одна колонка.');
    else columns[select.value] = Number(select.dataset.templateColumn);
  }
  const anchor = { ...period, kind: 'monthly', sourceYearStart: period.yearStart, sourceYearEnd: period.yearEnd, sourceMonth: period.month, sourceMonthText: period.sourceMonthText, monthCase: period.monthCase };
  await saveTemplate({ planKind: 'department', periodKind: 'monthly', periodAnchors: [anchor], tableIndex: table.tableIndex, headerRow: table.headerRow, templateRow: table.templateRow, dataStartRow: table.dataStartRow, dataEndRow: table.dataEndRow, columns, clearColumns, allowUnmappedColumns: true }, String(data.get('name') || '').trim());
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-collection-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.collectionAction, id = button.dataset.membership;
  if (action === 'open') open().catch(error => message(error.message, true));
  else if (action === 'close') close();
  else if (action === 'events' || action === 'members') setTab(action);
  else if (action === 'more') loadEvents(true);
  else if (action === 'source') { close(); window.kafedraOpenPlan?.(button.dataset.sourceId); }
  else if (action === 'edit-event-template') templateEditor.open(selectedEventTemplate());
  else if (action === 'suggest') suggestEvents();
  else if (action === 'suggest-more') suggestEvents(true);
  else if (action === 'cancel-suggest') { cancelSuggestion(true); $('[data-collection-action="suggest"]')?.focus(); }
  else if (action === 'apply-suggestion') mutate(applySuggestions, { focusOnSuccess: '#collection-members-tab' });
  else if (action === 'hide-suggestions') { cancelSuggestion(); hideSuggestions(); ($('[data-collection-select]:checked:not(:disabled)') || $('[data-collection-select]:not(:disabled)') || $('#collection-q'))?.focus(); }
  else if (action === 'upload-template') $('#collection-template-file').click();
  else if (action === 'retry-template') mutate(() => uploadTemplate(state.templateSource.file));
  else if (action === 'refresh') mutate(async () => {
    clearSuggestions();
    if (state.draft) acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`), { preserveMetadata: true });
    await reloadLists(); await loadEvents(); message('Данные обновлены. Несохранённые формулировки оставлены в редакторе.');
  });
  else if (action === 'cancel-template') $('#collection-template-review').classList.add('hidden');
  else if (action === 'add') mutate(addSelected);
  else if (action === 'export') mutate(exportDraft);
  else if (action === 'remove') mutate(() => removeItem(id));
  else if (action === 'up' || action === 'down') mutate(() => moveItem(id, action === 'up' ? -1 : 1));
  else if (action === 'reset-item') mutate(() => saveItem(button.closest('form'), true));
});
document.addEventListener('submit', event => {
  const form = event.target;
  if (form.id === 'collection-plan-form') { event.preventDefault(); mutate(async () => { await saveMetadata(); message('Месячный план сохранён.'); }); }
  else if (form.matches('[data-event-details-form]')) { event.preventDefault(); mutate(() => saveEventDetails(form)); }
  else if (form.matches('.collection-item-form')) { event.preventDefault(); mutate(() => saveItem(form)); }
  else if (form.id === 'collection-template-form') { event.preventDefault(); mutate(() => saveTemplateMapping(form)); }
});
document.addEventListener('keydown', event => {
  if (!event.target.closest('.collection-tabs') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tab = event.key === 'Home' ? 'events' : event.key === 'End' ? 'members' : state.tab === 'events' ? 'members' : 'events';
  setTab(tab); $(`#collection-${tab}-tab`).focus();
});
let filterTimer;
document.addEventListener('input', event => {
  const node = event.target, form = node.closest('.collection-item-form');
  if (form) state.edits.set(form.dataset.membership, editFromForm(form));
  const detailsForm = node.closest('[data-event-details-form]'); if (detailsForm) state.detailsEdits.set(detailsForm.dataset.eventDetailsForm, readEventDetails(detailsForm));
  if (node.id === 'collection-title') state.metadata.title = node.value;
  if (['collection-q', 'collection-department'].includes(node.id)) {
    state.filters[node.id === 'collection-q' ? 'q' : 'department'] = node.value.trim();
    if (node.id === 'collection-department') state.metadata.departmentText = node.value.trim();
    clearSuggestions();
    clearTimeout(filterTimer); filterTimer = setTimeout(() => loadEvents(), 250);
  }
});
document.addEventListener('change', event => {
  const node = event.target;
  if (node.matches('[data-collection-select]')) { if (node.checked) state.selected.add(node.dataset.collectionSelect); else state.selected.delete(node.dataset.collectionSelect); syncControls(); templateEditor?.refreshPreview(); }
  else if (node.matches('[data-suggestion-select]')) { const id = node.dataset.suggestionSelect; if (node.checked) state.suggestedSelected.add(id); else state.suggestedSelected.delete(id); renderSuggestions(); $(`[data-suggestion-select="${CSS.escape(id)}"]`)?.focus(); }
  else if (node.id === 'collection-event-template') { state.metadata.eventTemplateVersionId = node.value; clearSuggestions(); renderMembers(); renderEvents(); templateEditor?.refreshPreview(); }
  else if (node.id === 'collection-template') state.metadata.templateId = node.value;
  else if (node.id === 'collection-template-table') renderTemplateColumns();
  else if (node.id === 'collection-template-file') { const file = node.files?.[0]; mutate(() => uploadTemplate(file)); node.value = ''; }
  else if (node.id === 'collection-month') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(node.value)) return;
    clearSuggestions();
    state.month = node.value; state.draft = null; state.pendingCreate = null; state.metadata.title = defaultTitle(); state.createKey = newPlanOperationId(); state.selected.clear();
    state.draftSequence += 1;
    renderSelectors(); renderMembers(); reloadLists().catch(error => message(error.message, true)); loadEvents(); message('Выберите мероприятия для нового месяца.');
  } else if (node.id === 'collection-saved') {
    clearSuggestions();
    const id = node.value;
    if (!id) { state.draftSequence += 1; state.draft = null; state.pendingCreate = null; state.metadata.title = defaultTitle(); state.createKey = newPlanOperationId(); renderSelectors(); renderMembers(); renderEvents(); }
    else {
      const sequence = ++state.draftSequence;
      api(`/api/monthly-plans/${encodeURIComponent(id)}`).then(draft => {
        if (sequence !== state.draftSequence) return;
        acceptDraft(draft); loadEvents(); message('Открыт сохранённый месячный план.');
      }).catch(error => message(error.message, true));
    }
  } else if (['collection-activity', 'collection-source-plan', 'collection-undated'].includes(node.id)) {
    clearSuggestions();
    if (node.id === 'collection-activity') state.filters.activityKind = node.value;
    if (node.id === 'collection-source-plan') state.filters.planId = node.value;
    if (node.id === 'collection-undated') state.filters.includeUndated = node.checked;
    loadEvents();
  }
});
window.addEventListener('kafedra:plan-imported', () => { if (state.open) { reloadLists().catch(error => message(error.message, true)); loadEvents(); } });
window.addEventListener('kafedra:plan-open', () => { if (state.open) close(); });
document.addEventListener('template-editor-closed', () => $('[data-collection-action="edit-event-template"]')?.focus());
window.addEventListener('beforeunload', event => { if (state.edits.size || state.detailsEdits.size || state.designerDirty) { event.preventDefault(); event.returnValue = ''; } });
if (!$('#plan-collection-styles')) { const style = document.createElement('link'); style.id = 'plan-collection-styles'; style.rel = 'stylesheet'; style.href = '/plan-collection.css'; document.head.append(style); }
if (!ensureUi()) {
  const observer = new MutationObserver(() => { if (ensureUi()) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
}
