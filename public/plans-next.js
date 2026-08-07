const plansState = {
  plans: [], templates: [], people: [], calendarSources: new Map(), auth: null, templateAnalysis: null
};

const p$ = (selector, root = document) => root.querySelector(selector);
const p$$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function scopeLabel(scope) {
  return {
    department: 'План кафедры', faculty: 'План факультета', personal: 'Личный план',
    unit: 'План подразделения', organization: 'План организации'
  }[scope] || 'План';
}

function formatDate(value) {
  if (!value) return 'Без даты';
  const date = new Date(`${String(value).slice(0, 10)}T09:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric'
  }).format(date);
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD'].includes(method) && plansState.auth?.csrfToken) headers['x-csrf-token'] = plansState.auth.csrfToken;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function toast(message, isError = false) {
  const node = p$('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.classList.add('hidden'); node.classList.remove('error'); }, isError ? 6000 : 4000);
}

function ensureUi() {
  if (!p$('#plans-next-styles')) {
    const link = document.createElement('link');
    link.id = 'plans-next-styles'; link.rel = 'stylesheet'; link.href = '/plans-next.css'; document.head.append(link);
  }
  if (!p$('#navigation [data-view="plans"]')) {
    p$('#navigation [data-view="templates"]')?.insertAdjacentHTML('beforebegin',
      '<button class="nav-item" data-view="plans"><span class="nav-icon" aria-hidden="true">▥</span><span>Планы</span></button>');
  }
  if (!p$('.mobile-tabs [data-view="plans"]')) {
    p$('.mobile-tabs [data-view="templates"]')?.insertAdjacentHTML('beforebegin',
      '<button class="mobile-tab" data-view="plans"><span>▥</span>Планы</button>');
  }
  if (!p$('[data-view-panel="plans"]')) {
    p$('[data-view-panel="templates"]')?.insertAdjacentHTML('beforebegin', `
      <section class="view plans-view" data-view-panel="plans">
        <div class="section-heading plans-heading">
          <div><h2>Планы</h2><p>Планы кафедры, факультета и сотрудников. Сроки связаны с исходным документом и автоматически появляются в календаре.</p></div>
          <div class="plans-heading-actions"><button id="plan-upload" class="secondary-button" type="button">Загрузить план</button><button id="plan-generate" class="primary-button" type="button">Сформировать по шаблону</button></div>
        </div>
        <section class="surface-panel plans-filters">
          <label class="plans-query"><span>⌕</span><input id="plans-q" type="search" placeholder="Мероприятие, ответственный, результат…"></label>
          <select id="plans-scope"><option value="">Все планы</option><option value="department">Кафедра</option><option value="faculty">Факультет</option><option value="personal">Личные</option><option value="unit">Подразделение</option><option value="organization">Организация</option></select>
          <input id="plans-period" type="search" placeholder="2026 или 2026/27">
          <select id="plans-direction"><option value="">Все направления</option><option value="education">Образование</option><option value="science">Наука</option><option value="organizational">Организация</option></select>
          <input id="plans-responsible" type="search" placeholder="Ответственный">
          <button id="plans-reset" class="text-button" type="button">Сбросить</button>
        </section>
        <div class="plans-layout">
          <section class="surface-panel"><div class="plans-panel-head"><strong>Текущие планы</strong><span id="plans-count">0</span></div><div id="plans-list" class="plans-list"></div></section>
          <aside class="surface-panel"><div class="plans-panel-head"><strong>Шаблоны формирования</strong><button id="plan-template-upload" class="text-button" type="button">Добавить DOCX</button></div><div id="plan-templates" class="plan-templates"></div></aside>
        </div>
      </section>`);
  }
  if (!p$('#plans-dialog')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="plans-dialog-backdrop" class="plans-dialog-backdrop hidden"></div>
      <section id="plans-dialog" class="plans-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="plans-dialog-title">
        <header><div><div id="plans-dialog-eyebrow" class="eyebrow">Планы</div><h2 id="plans-dialog-title">План</h2></div><button id="plans-dialog-close" class="icon-button" type="button" aria-label="Закрыть">×</button></header>
        <div id="plans-dialog-body" class="plans-dialog-body"></div>
      </section>`);
  }
}

function activateView() {
  ensureUi(); document.body.classList.add('plans-active');
  p$$('.nav-item,.mobile-tab').forEach((item) => item.classList.toggle('active', item.dataset.view === 'plans'));
  p$$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'plans'));
  p$('#page-title').textContent = 'Планы'; p$('#page-subtitle').textContent = 'Формирование, загрузка, поиск и календарные сроки';
  p$('#calendar-mode-switch')?.classList.add('hidden');
  refresh().catch((error) => toast(error.message, true));
}

function openDialog(title, html, eyebrow = 'Планы') {
  p$('#plans-dialog-title').textContent = title; p$('#plans-dialog-eyebrow').textContent = eyebrow;
  p$('#plans-dialog-body').innerHTML = html; p$('#plans-dialog').classList.remove('hidden'); p$('#plans-dialog-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeDialog() {
  p$('#plans-dialog')?.classList.add('hidden'); p$('#plans-dialog-backdrop')?.classList.add('hidden');
  if (p$('#plans-dialog-body')) p$('#plans-dialog-body').innerHTML = '';
  document.body.style.overflow = ''; plansState.templateAnalysis = null;
}

function params() {
  const out = new URLSearchParams({ limit: '500' });
  for (const [key, selector] of [['q','#plans-q'],['scope','#plans-scope'],['period','#plans-period'],['direction','#plans-direction'],['responsible','#plans-responsible']]) {
    const value = p$(selector)?.value.trim(); if (value) out.set(key, value);
  }
  return out;
}

function planHtml(item) {
  const owner = item.owner_name || item.owner_raw;
  return `<button class="plan-card" type="button" data-plan-id="${esc(item.id)}"><div><span class="plan-scope ${esc(item.plan_scope)}">${esc(scopeLabel(item.plan_scope))}</span><span class="plan-period">${esc(item.period_key || 'Год не определён')}</span></div><strong>${esc(item.title)}</strong><small>${Number(item.item_count || 0)} пунктов${owner ? ` · ${esc(owner)}` : ''}${Number(item.undated_count || 0) ? ` · <b>без срока ${Number(item.undated_count)}</b>` : ''}</small><small>${esc(item.original_name || 'Исходный документ')}</small></button>`;
}
function templateHtml(item) {
  return `<article class="plan-template-card"><div><strong>${esc(item.name)}</strong><small>${esc(scopeLabel(item.plan_scope))} · ${item.period_kind === 'academic_year' ? 'учебный год' : 'календарный год'}</small><small>Год: ${esc(item.year_token || '—')} · таблица ${Number(item.table_index)}</small></div><button class="secondary-button" type="button" data-plan-use-template="${esc(item.id)}">Использовать</button></article>`;
}
function render() {
  p$('#plans-count').textContent = String(plansState.plans.length);
  p$('#plans-list').innerHTML = plansState.plans.length ? plansState.plans.map(planHtml).join('') : '<div class="empty-state">Планы по этим условиям не найдены.</div>';
  p$('#plan-templates').innerHTML = plansState.templates.length ? plansState.templates.map(templateHtml).join('') : '<div class="empty-state compact">Добавьте DOCX-образец плана. Система сама найдёт год и таблицу.</div>';
}
async function refresh() {
  const [plans, templates, sources] = await Promise.all([api(`/api/plans?${params()}`), api('/api/plan-templates'), api('/api/plans/calendar-sources?limit=10000')]);
  plansState.plans = plans.items || []; plansState.templates = templates.items || [];
  plansState.calendarSources = new Map((sources.items || []).map((item) => [item.calendar_item_id, item]));
  render(); annotateCalendar();
}

async function loadPeople() {
  try {
    const { items = [] } = await api('/api/people');
    if (!plansState.auth?.authEnabled || plansState.auth?.role === 'admin') plansState.people = items;
    else {
      const allowed = new Set([plansState.auth?.user?.person?.id, ...(plansState.auth?.subordinates || []).map((x) => x.id)].filter(Boolean));
      plansState.people = items.filter((x) => allowed.has(x.id));
    }
  } catch { plansState.people = []; }
}
function ownerOptions() {
  return `<option value="">Определить из документа</option>${plansState.people.map((p) => `<option value="${esc(p.id)}">${esc(p.display_name || p.displayName)}</option>`).join('')}`;
}

function uploadDialog() {
  openDialog('Загрузить готовый план', `<form id="plan-upload-form" class="plans-form">
    <label class="field full"><span>Файл плана</span><input id="plan-file" type="file" accept=".docx,.xlsx,.odt,.ods,.pdf,.txt,.md" required></label>
    <label class="field"><span>Источник</span><select id="plan-import-scope"><option value="auto">Определить автоматически</option><option value="department">Кафедра</option><option value="faculty">Факультет</option><option value="personal">Личный</option><option value="unit">Подразделение</option><option value="organization">Организация</option></select></label>
    <label class="field"><span>Период</span><select id="plan-import-kind"><option value="">Определить автоматически</option><option value="calendar_year">Календарный год</option><option value="academic_year">Учебный год</option></select></label>
    <label class="field"><span>Год</span><input id="plan-import-period" placeholder="2026 или 2026/27"></label>
    <label id="plan-import-owner-field" class="field hidden"><span>Сотрудник</span><select id="plan-import-owner">${ownerOptions()}</select></label>
    <p class="plans-note full">Источник и год можно не задавать. Если они неоднозначны, документ и найденные пункты сохранятся, а оператор получит один вопрос в разделе «Проверка».</p>
    <div class="plans-actions full"><button class="secondary-button" type="button" data-plan-close>Отмена</button><button class="primary-button" type="submit">Загрузить и разобрать</button></div></form>`, 'Импорт плана');
}
function templateUploadDialog() {
  openDialog('Добавить DOCX-шаблон', `<form id="plan-template-file-form" class="plans-form"><label class="field full"><span>DOCX-образец</span><input id="plan-template-file" type="file" accept=".docx" required></label><p class="plans-note full">Год, таблица, заголовок и строка-образец будут найдены автоматически. Перед сохранением найденные настройки можно исправить.</p><div class="plans-actions full"><button class="secondary-button" type="button" data-plan-close>Отмена</button><button class="primary-button" type="submit">Проанализировать</button></div></form>`, 'Новый шаблон');
}
function col(label, key, value) { return `<label class="field"><span>${label}</span><input name="col-${key}" type="number" min="1" value="${Number(value || 0) || ''}" placeholder="—"></label>`; }
function templateSettings(analysis) {
  plansState.templateAnalysis = analysis; const map = analysis.columnMap || {};
  openDialog('Проверить шаблон', `<form id="plan-template-settings" class="plans-form"><input type="hidden" name="documentId" value="${esc(analysis.documentId)}">
    <label class="field full"><span>Название</span><input name="name" value="${esc(analysis.title || 'Шаблон плана')}" required></label>
    <label class="field"><span>Вид плана</span><select name="planScope"><option value="department">Кафедра</option><option value="faculty">Факультет</option><option value="personal">Личный</option><option value="unit">Подразделение</option><option value="organization">Организация</option></select></label>
    <label class="field"><span>Тип года</span><select name="periodKind"><option value="calendar_year">Календарный</option><option value="academic_year">Учебный</option></select></label>
    <label class="field full"><span>Что заменять новым годом</span><input name="yearToken" value="${esc(analysis.yearToken || '')}" placeholder="2025 или {{year}}" required><small>При формировании это значение заменяется на выбранный год.</small></label>
    <div class="plans-detected full"><strong>Найдено автоматически</strong><span>таблица ${Number(analysis.tableIndex)} · заголовок ${Number(analysis.headerRow)} · строка-образец ${Number(analysis.sampleRow)} · ${Math.round(Number(analysis.confidence || 0) * 100)}%</span></div>
    <label class="field"><span>Таблица</span><input name="tableIndex" type="number" min="1" value="${Number(analysis.tableIndex)}"></label><label class="field"><span>Заголовок</span><input name="headerRow" type="number" min="1" value="${Number(analysis.headerRow)}"></label><label class="field"><span>Строка-образец</span><input name="sampleRow" type="number" min="1" value="${Number(analysis.sampleRow)}"></label>
    <div class="full"><h3 class="plans-subtitle">Столбцы таблицы</h3><div class="plans-form cols">${col('№','number',map.number)}${col('Мероприятие','title',map.title)}${col('Дата','date',map.date)}${col('Срок','due',map.due)}${col('Ответственный','responsible',map.responsible)}${col('Результат','result',map.result)}${col('Направление','direction',map.direction)}</div></div>
    ${(analysis.warnings || []).length ? `<div class="plans-warning full">${analysis.warnings.map(esc).join('<br>')}</div>` : ''}
    <div class="plans-actions full"><button class="secondary-button" type="button" data-plan-close>Отмена</button><button class="primary-button" type="submit">Сохранить шаблон</button></div></form>`, 'Настройка DOCX');
}
function rowHtml(index) {
  return `<tr data-plan-row><td><input name="number" value="${index + 1}"></td><td><input name="title" placeholder="Мероприятие" required></td><td><input name="startsAt" type="date"></td><td><input name="dueDate" type="date"></td><td><input name="responsible" placeholder="ФИО"></td><td><input name="result" placeholder="Результат"></td><td><select name="direction"><option value="organizational">Организация</option><option value="education">Образование</option><option value="science">Наука</option></select></td><td><button class="icon-button" type="button" data-plan-remove-row>×</button></td></tr>`;
}
function generationDialog(templateId = '') {
  if (!plansState.templates.length) { templateUploadDialog(); toast('Сначала добавьте DOCX-шаблон.'); return; }
  const selected = plansState.templates.find((x) => x.id === templateId) || plansState.templates[0]; const year = new Date().getFullYear();
  openDialog('Сформировать план', `<form id="plan-generation-form" class="plans-generation"><div class="plans-form generation-meta">
    <label class="field"><span>Шаблон</span><select id="gen-template">${plansState.templates.map((x) => `<option value="${esc(x.id)}" ${x.id === selected.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Вид плана</span><select id="gen-scope"><option value="department">Кафедра</option><option value="faculty">Факультет</option><option value="personal">Личный</option><option value="unit">Подразделение</option><option value="organization">Организация</option></select></label>
    <label class="field"><span>Тип года</span><select id="gen-kind"><option value="calendar_year">Календарный</option><option value="academic_year">Учебный</option></select></label>
    <label class="field"><span>Год</span><input id="gen-period" value="${selected.period_kind === 'academic_year' ? `${year}/${String(year + 1).slice(-2)}` : year}" required></label>
    <label id="gen-owner-field" class="field hidden"><span>Сотрудник</span><select id="gen-owner">${ownerOptions()}</select></label></div>
    <div class="plans-table-head"><div><strong>Пункты плана</strong><small>Строки попадут в DOCX по стилю строки-образца.</small></div><button id="plan-add-row" class="secondary-button" type="button">Добавить строку</button></div>
    <div class="plans-table-wrap"><table class="plans-entry"><thead><tr><th>№</th><th>Мероприятие</th><th>Дата</th><th>Срок</th><th>Ответственный</th><th>Результат</th><th>Направление</th><th></th></tr></thead><tbody id="plan-rows">${rowHtml(0)}</tbody></table></div>
    <div class="plans-actions"><button class="secondary-button" type="button" data-plan-close>Отмена</button><button class="primary-button" type="submit">Сформировать DOCX</button></div></form>`, 'Новый план');
  p$('#gen-scope').value = selected.plan_scope; p$('#gen-kind').value = selected.period_kind; toggleGenOwner();
}
function toggleImportOwner() { p$('#plan-import-owner-field')?.classList.toggle('hidden', p$('#plan-import-scope')?.value !== 'personal'); }
function toggleGenOwner() { p$('#gen-owner-field')?.classList.toggle('hidden', p$('#gen-scope')?.value !== 'personal'); }

async function upload(endpoint, file, headers = {}) {
  return api(endpoint, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'idempotency-key': crypto.randomUUID(), ...headers }, body: file });
}
async function waitDocument(id, timeout = 45000) {
  const started = Date.now(); while (Date.now() - started < timeout) {
    const item = await api(`/api/documents/${encodeURIComponent(id)}`);
    if (['processed','needs_review','failed'].includes(item.processing_status)) return item;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('Документ сохранён, но обработка ещё продолжается. Результат появится в разделе автоматически.');
}
async function submitImport(form) {
  const file = p$('#plan-file').files?.[0]; if (!file) return; const headers = {};
  const scope = p$('#plan-import-scope').value, kind = p$('#plan-import-kind').value, period = p$('#plan-import-period').value.trim(), owner = p$('#plan-import-owner')?.value;
  if (scope !== 'auto') headers['x-plan-scope'] = scope; if (kind) headers['x-plan-period-kind'] = kind; if (period) headers['x-plan-period'] = period; if (scope === 'personal' && owner) headers['x-plan-owner-person-id'] = owner;
  const button = p$('[type="submit"]', form); button.disabled = true; button.textContent = 'Разбор плана…';
  const result = await upload('/api/plans/file', file, headers); const document = await waitDocument(result.documentId); closeDialog(); await refresh();
  toast(document.processing_status === 'needs_review' ? 'План загружен. Часть данных требует проверки.' : 'План загружен, сроки добавлены в календарь.');
}
async function submitTemplateFile(form) {
  const file = p$('#plan-template-file').files?.[0]; if (!file) return; const button = p$('[type="submit"]', form); button.disabled = true; button.textContent = 'Анализ…';
  const result = await upload('/api/plan-templates/file', file); await waitDocument(result.documentId);
  templateSettings(await api('/api/plan-templates/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: result.documentId }) }));
}
function formColumnMap(form) {
  const data = new FormData(form), map = {}; for (const key of ['number','title','date','due','responsible','result','direction']) { const value = Number(data.get(`col-${key}`) || 0); if (value > 0) map[key] = value; } return map;
}
async function submitTemplateSettings(form) {
  const d = new FormData(form); await api('/api/plan-templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    documentId: d.get('documentId'), name: String(d.get('name') || '').trim(), planScope: d.get('planScope'), periodKind: d.get('periodKind'), yearToken: String(d.get('yearToken') || '').trim(), yearLocator: plansState.templateAnalysis?.yearLocator || {}, tableIndex: Number(d.get('tableIndex')), headerRow: Number(d.get('headerRow')), sampleRow: Number(d.get('sampleRow')), columnMap: formColumnMap(form)
  }) }); closeDialog(); await refresh(); toast('Шаблон сохранён. Год будет подставляться автоматически.');
}
function generationItems() {
  return p$$('[data-plan-row]').map((row) => { const value = (name) => p$(`[name="${name}"]`, row)?.value.trim() || ''; return { number: value('number'), title: value('title'), startsAt: value('startsAt') || null, dueDate: value('dueDate') || null, responsible: value('responsible'), result: value('result'), direction: value('direction') || 'organizational' }; }).filter((x) => x.title);
}
async function submitGeneration(form) {
  const items = generationItems(); if (!items.length) throw new Error('Добавьте хотя бы один пункт плана.'); const button = p$('[type="submit"]', form); button.disabled = true; button.textContent = 'Формирование…';
  const result = await api(`/api/plan-templates/${encodeURIComponent(p$('#gen-template').value)}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planScope: p$('#gen-scope').value, periodKind: p$('#gen-kind').value, periodKey: p$('#gen-period').value.trim(), ownerPersonId: p$('#gen-scope').value === 'personal' ? p$('#gen-owner')?.value || null : null, items, idempotencyKey: crypto.randomUUID() }) });
  const document = await waitDocument(result.documentId); closeDialog(); await refresh(); toast(document.processing_status === 'needs_review' ? 'DOCX сформирован. Некоторые поля требуют проверки.' : 'DOCX сформирован, разобран и добавлен в календарь.');
}

function itemEvidence(item) {
  const ev = item.evidence || {}; if (ev.kind === 'plan_table_row') return `Таблица ${ev.table} · строка ${ev.row}`; if (ev.line) return `Строка ${ev.line}`; return 'Источник сохранён';
}
function itemsHtml(plan) {
  const items = plan.items || []; return `<section class="inspector-section"><div class="inspector-section-head"><h3>Мероприятия и сроки</h3><span>${items.length}</span></div>${items.length ? items.map((item) => `<article class="plan-item"><div><strong>${esc(item.title)}</strong><span>${esc(item.source_item_no || item.item_kind)}</span></div><p>${item.starts_at ? `Дата: ${esc(formatDate(item.starts_at))}` : ''}${item.due_date ? `${item.starts_at ? ' · ' : ''}Срок: ${esc(formatDate(item.due_date))}` : ''}</p><small>${esc(item.responsible_name || item.responsible_raw || 'Ответственный не указан')} · ${esc(itemEvidence(item))}</small></article>`).join('') : '<div class="empty-state">Пункты не извлечены; исходный документ сохранён.</div>'}</section>`;
}
async function openPlan(id) {
  const plan = await api(`/api/plans/${encodeURIComponent(id)}`), inspector = p$('#ux-inspector');
  if (!inspector) return openDialog(plan.title, itemsHtml(plan), scopeLabel(plan.plan_scope));
  p$('#ux-inspector-eyebrow').textContent = `${scopeLabel(plan.plan_scope)}${plan.period_key ? ` · ${plan.period_key}` : ''}`; p$('#ux-inspector-title').textContent = plan.title;
  p$('#ux-inspector-body').innerHTML = `<dl class="inspector-facts"><div><dt>Источник</dt><dd>${esc(scopeLabel(plan.plan_scope))}</dd></div><div><dt>Период</dt><dd>${esc(plan.period_key || 'Требует проверки')}</dd></div><div><dt>Владелец</dt><dd>${esc(plan.owner_name || plan.owner_raw || 'Общий план')}</dd></div></dl>${itemsHtml(plan)}`;
  p$('#ux-inspector-actions').innerHTML = `<a class="secondary-button" href="/api/documents/${encodeURIComponent(plan.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Исходный файл</a>`; inspector.classList.remove('hidden'); document.body.classList.add('inspector-open');
}
async function openCalendarSource(calendarId, source) {
  const item = await api(`/api/calendar/${encodeURIComponent(calendarId)}`), inspector = p$('#ux-inspector'); if (!inspector) return openPlan(source.plan_id);
  p$('#ux-inspector-eyebrow').textContent = item.item_kind === 'task' ? 'Срок из плана' : 'Событие из плана'; p$('#ux-inspector-title').textContent = item.title;
  p$('#ux-inspector-body').innerHTML = `<dl class="inspector-facts"><div><dt>Источник</dt><dd>${esc(source.scopeLabel)}</dd></div><div><dt>План</dt><dd>${esc(source.plan_title)}</dd></div><div><dt>Период</dt><dd>${esc(source.period_key || 'Не указан')}</dd></div><div><dt>Ответственный</dt><dd>${esc(source.responsible_raw || 'Не указан')}</dd></div></dl><div class="source-note">Дата связана с исходным пунктом плана; документ и доказательство сохранены.</div>`;
  p$('#ux-inspector-actions').innerHTML = `<button class="primary-button" type="button" data-open-plan="${esc(source.plan_id)}">Открыть план</button><a class="secondary-button" href="/api/documents/${encodeURIComponent(source.source_document_id)}/content?variant=original" target="_blank" rel="noopener">Исходный файл</a>`; inspector.classList.remove('hidden'); document.body.classList.add('inspector-open');
}
function annotateCalendar() {
  for (const node of p$$('[data-calendar-item]')) {
    const source = plansState.calendarSources.get(node.dataset.calendarItem); node.classList.toggle('from-plan', Boolean(source));
    if (source) { node.dataset.planOrigin = source.scopeLabel.replace(/^План\s+/u, ''); node.title = `Источник: ${source.scopeLabel}${source.period_key ? ` · ${source.period_key}` : ''}`; }
    else delete node.dataset.planOrigin;
  }
}

let filterTimer;
function scheduleRefresh() { clearTimeout(filterTimer); filterTimer = setTimeout(() => refresh().catch((error) => toast(error.message, true)), 250); }

window.addEventListener('click', (event) => {
  if (event.target.closest('[data-view="plans"]')) { event.preventDefault(); event.stopImmediatePropagation(); activateView(); return; }
  if (event.target.closest('[data-view]')) document.body.classList.remove('plans-active');
  const calendar = event.target.closest('[data-calendar-item]'), source = calendar ? plansState.calendarSources.get(calendar.dataset.calendarItem) : null;
  if (source) { event.preventDefault(); event.stopImmediatePropagation(); openCalendarSource(calendar.dataset.calendarItem, source).catch((e) => toast(e.message, true)); }
}, true);

document.addEventListener('click', (event) => {
  const plan = event.target.closest('[data-plan-id]'); if (plan) openPlan(plan.dataset.planId).catch((e) => toast(e.message, true));
  const open = event.target.closest('[data-open-plan]'); if (open) openPlan(open.dataset.openPlan).catch((e) => toast(e.message, true));
  if (event.target.closest('#plan-upload')) uploadDialog(); if (event.target.closest('#plan-template-upload')) templateUploadDialog(); if (event.target.closest('#plan-generate')) generationDialog();
  const use = event.target.closest('[data-plan-use-template]'); if (use) generationDialog(use.dataset.planUseTemplate);
  if (event.target.closest('[data-plan-close],#plans-dialog-close') || event.target === p$('#plans-dialog-backdrop')) closeDialog();
  if (event.target.closest('#plans-reset')) { for (const id of ['#plans-q','#plans-period','#plans-responsible']) p$(id).value = ''; for (const id of ['#plans-scope','#plans-direction']) p$(id).value = ''; scheduleRefresh(); }
  if (event.target.closest('#plan-add-row')) p$('#plan-rows').insertAdjacentHTML('beforeend', rowHtml(p$$('[data-plan-row]').length));
  const remove = event.target.closest('[data-plan-remove-row]'); if (remove) { const rows = p$$('[data-plan-row]'); if (rows.length > 1) remove.closest('[data-plan-row]').remove(); else toast('В плане должна оставаться хотя бы одна строка.'); }
});
document.addEventListener('change', (event) => {
  if (event.target.matches('#plan-import-scope')) toggleImportOwner(); if (event.target.matches('#gen-scope')) toggleGenOwner();
  if (event.target.matches('#gen-template')) { const t = plansState.templates.find((x) => x.id === event.target.value); if (t) { p$('#gen-scope').value = t.plan_scope; p$('#gen-kind').value = t.period_kind; toggleGenOwner(); } }
  if (event.target.matches('#plans-scope,#plans-direction')) scheduleRefresh();
});
document.addEventListener('input', (event) => { if (event.target.matches('#plans-q,#plans-period,#plans-responsible')) scheduleRefresh(); });
document.addEventListener('submit', async (event) => {
  try {
    if (event.target.matches('#plan-upload-form')) { event.preventDefault(); await submitImport(event.target); }
    else if (event.target.matches('#plan-template-file-form')) { event.preventDefault(); await submitTemplateFile(event.target); }
    else if (event.target.matches('#plan-template-settings')) { event.preventDefault(); await submitTemplateSettings(event.target); }
    else if (event.target.matches('#plan-generation-form')) { event.preventDefault(); await submitGeneration(event.target); }
  } catch (error) { toast(error.message, true); const button = p$('[type="submit"]', event.target); if (button) { button.disabled = false; button.textContent = 'Повторить'; } }
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !p$('#plans-dialog')?.classList.contains('hidden')) { event.preventDefault(); event.stopImmediatePropagation(); closeDialog(); } }, true);

new MutationObserver(() => { ensureUi(); annotateCalendar(); }).observe(document.documentElement, { childList: true, subtree: true });

async function init() {
  ensureUi(); try { plansState.auth = await api('/api/auth/me'); } catch { plansState.auth = null; }
  await loadPeople(); try { const sources = await api('/api/plans/calendar-sources?limit=10000'); plansState.calendarSources = new Map((sources.items || []).map((x) => [x.calendar_item_id, x])); annotateCalendar(); } catch {}
}
init();
