import { newPlanOperationId, planUploadKey } from './plan-upload-identity.js';

const today = new Date();
const state = {
  open: false, month: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`, draft: null, drafts: [], templates: [], plans: [],
  events: [], selected: new Set(), edits: new Map(), hasMore: false, nextOffset: 0,
  filters: { q: '', department: '', activityKind: '', planId: '', includeUndated: true },
  metadata: { title: '', templateId: '' }, tab: 'events', busy: false, requestSequence: 0, draftSequence: 0, listSequence: 0,
  createKey: newPlanOperationId(), pendingCreate: null, exportRequest: null, templateSource: null, templateAnalysis: null
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const kinds = { methodological: 'Методическая работа', teaching: 'Занятия', science: 'Научная работа', organizational: 'Организационная работа', everyday: 'Повседневная работа' };
const directions = { education: 'Образование', science: 'Наука', organizational: 'Организация', everyday: 'Повседневная работа' };

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Не удалось выполнить действие (${response.status}).`);
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
function dates(item) {
  const format = value => value ? String(value).slice(0, 10).split('-').reverse().join('.') : '';
  if (item.starts_at && item.ends_at && item.starts_at !== item.ends_at) return `${format(item.starts_at)} — ${format(item.ends_at)}`;
  if (item.due_date) return `до ${format(item.due_date)}`;
  return item.starts_at ? format(item.starts_at) : 'Без точного срока';
}
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
        <label class="field"><span>Образец DOCX</span><select id="collection-template"><option value="">Стандартная таблица</option></select></label>
        <div class="collection-plan-actions"><button type="submit" class="secondary-button" data-collection-mutation>Сохранить план</button><button type="button" class="secondary-button" data-collection-action="upload-template" data-collection-mutation>Загрузить образец</button><input id="collection-template-file" type="file" accept=".docx" hidden><button type="button" class="primary-button" data-collection-action="export" data-collection-mutation>Скачать DOCX</button></div>
        <p id="collection-export-warning" class="collection-help collection-title-field hidden"></p>
      </form>
      <section id="collection-template-review" class="collection-template-review hidden" aria-label="Настройка образца"></section>
      <div class="collection-tabs" role="tablist" aria-label="Состав месячного плана"><button id="collection-events-tab" type="button" role="tab" aria-selected="true" aria-controls="collection-events-panel" data-collection-action="events">Все мероприятия</button><button id="collection-members-tab" type="button" role="tab" aria-selected="false" aria-controls="collection-members-panel" data-collection-action="members">В плане · 0</button></div>
      <section id="collection-events-panel" role="tabpanel" aria-labelledby="collection-events-tab">
        <div class="collection-filters">
          <label class="field"><span>Найти мероприятие</span><input id="collection-q" type="search" placeholder="Название или содержание"></label>
          <label class="field"><span>Вид деятельности</span><select id="collection-activity"><option value="">Все виды</option>${Object.entries(kinds).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <label class="field"><span>Кафедра / подразделение</span><input id="collection-department" type="search" placeholder="По тексту плана и ответственным"></label>
          <label class="field"><span>Исходный план</span><select id="collection-source-plan"><option value="">Все планы</option></select></label>
        </div>
        <div class="collection-selection"><label class="check-field"><input id="collection-undated" type="checkbox" checked><span>Показывать также мероприятия без точного срока</span></label><span id="collection-selection-count">Выбрано: 0</span><button type="button" class="primary-button" data-collection-action="add" data-collection-mutation disabled>Добавить выбранные</button></div>
        <div id="collection-events" aria-busy="false"></div><button type="button" class="secondary-button hidden" id="collection-load-more" data-collection-action="more">Показать ещё</button>
      </section>
      <section id="collection-members-panel" class="hidden" role="tabpanel" aria-labelledby="collection-members-tab"><p class="collection-help">Формулировки для выгрузки можно изменить здесь. Сроки и исполнение самого мероприятия редактируются в исходном плане.</p><div id="collection-members"></div></section>`;
    view.append(section);
  }
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
  $$('[data-collection-mutation], #collection-plan-form input, #collection-plan-form select, .collection-item-form input, #collection-template-review input, #collection-template-review select', root).forEach(node => { node.disabled = state.busy; });
  $('[data-collection-action="add"]', root).disabled = state.busy || !state.selected.size;
  const unavailable = state.draft?.items?.some(item => item.unavailable);
  $('[data-collection-action="export"]', root).disabled = state.busy || !state.draft?.items?.length || Boolean(unavailable || state.draft?.templateUnavailable);
  const warning = $('#collection-export-warning');
  warning.textContent = unavailable ? 'Для выгрузки восстановите доступ к источникам или исключите недоступные пункты из состава.' : state.draft?.templateUnavailable ? 'Сохранённый образец недоступен. Выберите другой образец или стандартную таблицу и сохраните план.' : '';
  warning.classList.toggle('hidden', !warning.textContent);
  const memberships = state.draft?.items || [];
  const firstId = memberships[0]?.id, lastId = memberships.at(-1)?.id;
  $$('[data-collection-action="up"], [data-collection-action="down"]', root).forEach(button => {
    button.disabled = state.busy || button.dataset.membership === (button.dataset.collectionAction === 'up' ? firstId : lastId);
  });
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
  $('#collection-source-plan').innerHTML = '<option value="">Все планы</option>' + state.plans.map(plan => `<option value="${esc(plan.id)}">${esc(plan.title)}</option>`).join('');
  $('#collection-source-plan').value = state.filters.planId;
  syncControls();
}
function renderEvents() {
  const included = new Set((state.draft?.items || []).filter(item => !item.unavailable).map(item => item.plan_item_id));
  $('#collection-events').innerHTML = state.events.length ? `<table class="collection-table"><thead><tr><th><span class="sr-only">Выбор</span></th><th>Мероприятие</th><th>Срок</th><th>Ответственный</th><th>Источник</th></tr></thead><tbody>${state.events.map(item => `<tr data-collection-event="${esc(item.id)}">
    <td class="collection-choice"><input type="checkbox" data-collection-select="${esc(item.id)}" aria-label="Выбрать: ${esc(item.title)}" ${included.has(item.id) ? 'checked disabled' : state.selected.has(item.id) ? 'checked' : ''}></td>
    <td><strong>${esc(item.title)}</strong><small>${esc(kinds[item.activity_kind] || directions[item.direction] || 'Мероприятие')}${included.has(item.id) ? ' · Уже в плане' : ''}</small></td>
    <td data-label="Срок">${esc(dates(item))}</td><td data-label="Ответственный">${esc(item.responsible_raw || item.responsible_name || 'Не указан')}</td><td>${sourceLinks(item)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">Мероприятий по этим условиям нет. Измените фильтры или загрузите исходные планы.</div>';
  $('#collection-load-more').classList.toggle('hidden', !state.hasMore);
  syncControls();
}
function sourceMemberEdit(source) {
  return { titleOverride: source.title || '', dateTextOverride: source.starts_at || source.due_date ? dates(source) : '', responsibleOverride: source.responsible_raw || '', expectedResultOverride: source.expected_result || '' };
}
function memberEdit(item) {
  const inherited = sourceMemberEdit(item.source || {}), effective = item.effective || {};
  return state.edits.get(item.id) || {
    titleOverride: effective.title ?? item.title_override ?? inherited.titleOverride,
    dateTextOverride: effective.dateText ?? item.date_text_override ?? inherited.dateTextOverride,
    responsibleOverride: effective.responsibleRaw ?? item.responsible_override ?? inherited.responsibleOverride,
    expectedResultOverride: effective.expectedResult ?? item.expected_result_override ?? inherited.expectedResultOverride,
    note: item.note || ''
  };
}
function renderMembers() {
  const items = state.draft?.items || [];
  $('#collection-members').innerHTML = items.length ? items.map((item, index) => {
    if (item.unavailable) return `<article class="collection-member"><strong>Источник недоступен</strong><p>Пункт сохранён в составе. Его данные и выгрузка недоступны без доступа к источнику.</p><button type="button" class="text-button" data-collection-action="remove" data-membership="${esc(item.id)}" data-collection-mutation>Исключить из месячного плана</button></article>`;
    const edit = memberEdit(item), source = item.source || {}, effective = item.effective || {};
    return `<article class="collection-member" data-collection-member="${esc(item.id)}"><header><div><strong>${index + 1}. ${esc(effective.title || source.title)}</strong>${sourceLinks(source)}</div><div class="collection-order"><button type="button" class="text-button" data-collection-action="up" data-membership="${esc(item.id)}" data-collection-mutation ${index ? '' : 'disabled'} aria-label="Поднять: ${esc(effective.title || source.title)}">Выше</button><button type="button" class="text-button" data-collection-action="down" data-membership="${esc(item.id)}" data-collection-mutation ${index === items.length - 1 ? 'disabled' : ''} aria-label="Опустить: ${esc(effective.title || source.title)}">Ниже</button><button type="button" class="text-button" data-collection-action="remove" data-membership="${esc(item.id)}" data-collection-mutation>Исключить</button></div></header>
      <form class="collection-item-form" data-membership="${esc(item.id)}"><label class="field collection-title-field"><span>Формулировка для выгрузки</span><input name="titleOverride" value="${esc(edit.titleOverride)}" required></label><label class="field"><span>Срок в документе</span><input name="dateTextOverride" value="${esc(edit.dateTextOverride)}"></label><label class="field"><span>Ответственный в документе</span><input name="responsibleOverride" value="${esc(edit.responsibleOverride)}"></label><label class="field"><span>Ожидаемый результат</span><input name="expectedResultOverride" value="${esc(edit.expectedResultOverride)}"></label><label class="field"><span>Примечание</span><input name="note" value="${esc(edit.note)}"></label><div class="collection-item-actions"><button type="submit" class="secondary-button" data-collection-mutation>Сохранить формулировки</button><button type="button" class="text-button" data-collection-action="reset-item" data-membership="${esc(item.id)}" data-collection-mutation>Как в источнике</button>${state.edits.has(item.id) ? '<span>Есть несохранённые правки</span>' : ''}</div></form></article>`;
  }).join('') : '<div class="empty-state">Выберите мероприятия из общего списка и добавьте их в этот план.</div>';
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
  const [drafts, templates, plans] = await Promise.all([api(`/api/monthly-plans?month=${encodeURIComponent(state.month)}&limit=500`), api('/api/plan-templates?limit=300'), api('/api/plans?status=active&limit=1000')]);
  if (sequence !== state.listSequence) return;
  state.drafts = drafts.items || []; state.templates = templates.items || []; state.plans = plans.items || [];
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
  state.open = false;
  $('[data-view-panel="plans"]')?.classList.remove('collection-open');
  $('#plan-collection')?.classList.add('hidden');
  $('#plan-collection-open')?.focus();
}
function acceptDraft(draft) {
  state.draft = draft;
  state.month = draft.month_key;
  state.metadata = { title: draft.title, templateId: draft.template_id || '' };
  state.exportRequest = null;
  const index = state.drafts.findIndex(item => item.id === draft.id);
  if (index < 0) state.drafts.unshift(draft); else state.drafts[index] = draft;
  renderSelectors(); renderMembers(); renderEvents();
}
async function mutate(action) {
  if (state.busy) return;
  state.busy = true; syncControls(); message('Сохраняем…');
  try { await action(); }
  catch (error) {
    message(`${error.message}${/revision|stale|conflict/.test(error.code || '') ? ' Обновите сохранённый план перед повторной попыткой. Ваши формулировки оставлены в редакторе.' : ''}`, true);
  } finally { state.busy = false; syncControls(); }
}
function metadataPayload() {
  const title = $('#collection-title').value.trim();
  if (!title) throw new Error('Укажите название месячного плана.');
  state.metadata = { title, templateId: $('#collection-template').value };
  return { title, templateId: state.metadata.templateId || null };
}
async function saveMetadata(planItemIds = []) {
  const payload = metadataPayload();
  if (!state.draft) {
    state.pendingCreate ||= { month: state.month, ...payload, planItemIds, idempotencyKey: `monthly-ui:${state.createKey}` };
    let draft;
    try { draft = await api('/api/monthly-plans', json('POST', state.pendingCreate)); }
    catch (error) { if (error.status && error.status < 500) state.pendingCreate = null; throw error; }
    state.pendingCreate = null;
    acceptDraft(draft);
    if (payload.title !== draft.title || (payload.templateId || null) !== (draft.template_id || null)) {
      state.metadata = { title: payload.title, templateId: payload.templateId || '' };
      renderSelectors();
      acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(draft.id)}`, json('PATCH', { ...payload, expectedRevision: draft.revision })));
    }
    if (draft.duplicateRequest) {
      const included = new Set(state.draft.items.filter(item => !item.unavailable).map(item => item.plan_item_id));
      const missing = planItemIds.filter(id => !included.has(id));
      const recovered = planItemIds.filter(id => included.has(id)).map(planItemId => ({ planItemId, status: 'existing' }));
      if (missing.length) {
        const result = await api(`/api/monthly-plans/${encodeURIComponent(draft.id)}/items`, json('POST', { planItemIds: missing, expectedRevision: state.draft.revision }));
        acceptDraft(result.draft);
        return [...recovered, ...result.results];
      }
      return recovered;
    }
    return draft.results || [];
  }
  const metadataChanged = payload.title !== state.draft.title || (payload.templateId || null) !== (state.draft.template_id || null);
  if (metadataChanged) acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`, json('PATCH', { ...payload, expectedRevision: state.draft.revision })));
  if (!planItemIds.length) return [];
  const result = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/items`, json('POST', { planItemIds, expectedRevision: state.draft.revision }));
  acceptDraft(result.draft);
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
  return Object.fromEntries(['titleOverride', 'dateTextOverride', 'responsibleOverride', 'expectedResultOverride', 'note'].map(key => [key, $(`[name="${key}"]`, form)?.value || '']));
}
async function saveItem(form, reset = false) {
  const id = form.dataset.membership;
  const values = { titleOverride: null, dateTextOverride: null, responsibleOverride: null, expectedResultOverride: null, note: null };
  if (!reset) {
    const item = state.draft.items.find(member => member.id === id);
    const inherited = sourceMemberEdit(item.source || {});
    const entered = Object.fromEntries(Object.entries(editFromForm(form)).map(([key, value]) => [key, value.trim()]));
    if (!entered.titleOverride) throw new Error('Укажите формулировку мероприятия.');
    for (const [field, column] of Object.entries({ titleOverride: 'title_override', dateTextOverride: 'date_text_override', responsibleOverride: 'responsible_override', expectedResultOverride: 'expected_result_override' })) {
      const keepEmptyOverride = entered[field] === '' && item[column] !== null && item[column] !== undefined;
      values[field] = entered[field] === inherited[field].trim() && !keepEmptyOverride ? null : entered[field];
    }
    values.note = entered.note;
  }
  const draft = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/items/${encodeURIComponent(id)}`, json('PATCH', { ...values, expectedRevision: state.draft.revision }));
  state.edits.delete(id); acceptDraft(draft); message('Формулировки сохранены.');
}
async function removeItem(id) {
  const draft = await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}/items/${encodeURIComponent(id)}?expectedRevision=${state.draft.revision}`, { method: 'DELETE' });
  state.edits.delete(id); acceptDraft(draft); message('Мероприятие исключено из месячного плана. Оно остаётся в исходном плане и календаре.');
}
async function moveItem(id, delta) {
  const ids = state.draft.items.map(item => item.id), index = ids.indexOf(id), target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`, json('PATCH', { expectedRevision: state.draft.revision, orderedItemIds: ids })));
  message('Порядок мероприятий сохранён.');
}
async function exportDraft() {
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
  else if (action === 'upload-template') $('#collection-template-file').click();
  else if (action === 'retry-template') mutate(() => uploadTemplate(state.templateSource.file));
  else if (action === 'refresh') mutate(async () => {
    const metadata = { ...state.metadata };
    if (state.draft) acceptDraft(await api(`/api/monthly-plans/${encodeURIComponent(state.draft.id)}`));
    state.metadata = metadata;
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
  if (node.id === 'collection-title') state.metadata.title = node.value;
  if (['collection-q', 'collection-department'].includes(node.id)) {
    state.filters[node.id === 'collection-q' ? 'q' : 'department'] = node.value.trim();
    clearTimeout(filterTimer); filterTimer = setTimeout(() => loadEvents(), 250);
  }
});
document.addEventListener('change', event => {
  const node = event.target;
  if (node.matches('[data-collection-select]')) { if (node.checked) state.selected.add(node.dataset.collectionSelect); else state.selected.delete(node.dataset.collectionSelect); syncControls(); }
  else if (node.id === 'collection-template') state.metadata.templateId = node.value;
  else if (node.id === 'collection-template-table') renderTemplateColumns();
  else if (node.id === 'collection-template-file') { const file = node.files?.[0]; mutate(() => uploadTemplate(file)); node.value = ''; }
  else if (node.id === 'collection-month') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(node.value)) return;
    state.month = node.value; state.draft = null; state.pendingCreate = null; state.metadata.title = defaultTitle(); state.createKey = newPlanOperationId(); state.selected.clear();
    state.draftSequence += 1;
    renderSelectors(); renderMembers(); reloadLists().catch(error => message(error.message, true)); loadEvents(); message('Выберите мероприятия для нового месяца.');
  } else if (node.id === 'collection-saved') {
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
    if (node.id === 'collection-activity') state.filters.activityKind = node.value;
    if (node.id === 'collection-source-plan') state.filters.planId = node.value;
    if (node.id === 'collection-undated') state.filters.includeUndated = node.checked;
    loadEvents();
  }
});
window.addEventListener('kafedra:plan-imported', () => { if (state.open) { reloadLists().catch(error => message(error.message, true)); loadEvents(); } });
window.addEventListener('kafedra:plan-open', () => { if (state.open) close(); });
window.addEventListener('beforeunload', event => { if (state.edits.size) { event.preventDefault(); event.returnValue = ''; } });
if (!$('#plan-collection-styles')) { const style = document.createElement('link'); style.id = 'plan-collection-styles'; style.rel = 'stylesheet'; style.href = '/plan-collection.css'; document.head.append(style); }
if (!ensureUi()) {
  const observer = new MutationObserver(() => { if (ensureUi()) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
}
