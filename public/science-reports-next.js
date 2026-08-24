const scienceReportsState = {
  organization: null,
  documents: [],
  preview: null,
  timer: null
};

const $sr = (selector, root = document) => root.querySelector(selector);
const $$sr = (selector, root = document) => [...root.querySelectorAll(selector)];

function escReport(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function reportApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureReportStyles() {
  if ($sr('#science-reports-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'science-reports-next-styles';
  link.rel = 'stylesheet';
  link.href = '/science-reports-next.css';
  document.head.append(link);
}

function ensureReportUi() {
  ensureReportStyles();
  if (!$sr('#science-report-modal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="science-report-backdrop" class="science-report-backdrop hidden"></div>
      <section id="science-report-modal" class="science-report-modal hidden" role="dialog" aria-modal="true" aria-labelledby="science-report-modal-title"></section>
    `);
  }
  const panel = $sr('[data-view-panel="science"]');
  if (panel && !$sr('[data-science-report-open]', panel)) {
    const header = $sr('.view-header, .science-header, header', panel) || panel;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button science-report-open';
    button.dataset.scienceReportOpen = '1';
    button.textContent = 'Сформировать отчёт';
    header.append(button);
  }
}

function showReportModal(html) {
  ensureReportUi();
  $sr('#science-report-modal').innerHTML = html;
  $sr('#science-report-backdrop').classList.remove('hidden');
  $sr('#science-report-modal').classList.remove('hidden');
  document.body.classList.add('science-report-modal-open');
}

function closeReportModal() {
  $sr('#science-report-backdrop')?.classList.add('hidden');
  $sr('#science-report-modal')?.classList.add('hidden');
  document.body.classList.remove('science-report-modal-open');
}

function formError(form, message = '') {
  let target = $sr('[data-science-report-error]', form);
  if (!target) {
    target = document.createElement('div');
    target.dataset.scienceReportError = '1';
    target.className = 'science-report-error hidden';
    target.setAttribute('role', 'alert');
    $sr('.science-report-actions', form)?.insertAdjacentElement('beforebegin', target);
  }
  target.textContent = message;
  target.classList.toggle('hidden', !message);
}

function flattenUnits(nodes, result = [], level = 0) {
  for (const node of nodes || []) {
    result.push({ ...node, level });
    flattenUnits(node.children || [], result, level + 1);
  }
  return result;
}

function unitOptions() {
  return `<option value="">Все подразделения</option>${flattenUnits(scienceReportsState.organization?.tree || []).map((unit) => `<option value="${escReport(unit.id)}">${'— '.repeat(unit.level)}${escReport(unit.name)}</option>`).join('')}`;
}

function personOptions() {
  return `<option value="">Все сотрудники</option>${(scienceReportsState.organization?.people || []).map((person) => `<option value="${escReport(person.id)}">${escReport(person.display_name)}</option>`).join('')}`;
}

function templateOptions() {
  const templates = scienceReportsState.documents.filter((document) => document.detected_format === 'docx' || String(document.original_name || '').toLowerCase().endsWith('.docx'));
  return `<option value="">Встроенный образец</option>${templates.map((document) => `<option value="${escReport(document.id)}">${escReport(document.title || document.original_name)}</option>`).join('')}`;
}

const REPORT_FIELDS = [
  ['title','Название'],['kind','Вид'],['year','Год'],['authors','Авторы'],['unit','Подразделение'],
  ['status','Этап'],['doi','DOI'],['venue','Издание/мероприятие'],['classifications','Классификации'],['evidence','Доказательства']
];

function reportForm() {
  const year = new Date().getFullYear();
  return `
    <header class="science-report-modal-head"><div><span>Научная деятельность</span><h3 id="science-report-modal-title">Сформировать отчёт</h3></div><button class="icon-button" type="button" data-science-report-close>×</button></header>
    <form class="science-report-modal-body" data-science-report-form>
      <label class="field"><span>Название документа</span><input name="title" value="Отчёт о научной деятельности" required></label>
      <div class="science-report-grid-three">
        <label class="field"><span>С года</span><input name="yearFrom" type="number" min="1900" max="2200" value="${year}"></label>
        <label class="field"><span>По год</span><input name="yearTo" type="number" min="1900" max="2200" value="${year}"></label>
        <label class="field"><span>Этап</span><select name="lifecycleStatus"><option value="">Все этапы</option>${[['idea','Замысел'],['drafting','Готовится'],['submitted','Подано'],['revision','Доработка'],['accepted','Принято'],['published','Опубликовано'],['rejected','Отклонено'],['archived','Архив']].map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      </div>
      <div class="science-report-grid-two">
        <label class="field"><span>Подразделение</span><select name="unitId">${unitOptions()}</select></label>
        <label class="field"><span>Сотрудник</span><select name="personId">${personOptions()}</select></label>
      </div>
      <div class="science-report-grid-two">
        <label class="field"><span>Вид материала</span><select name="kind"><option value="">Все виды</option>${[['article','Статья'],['conference','Конференция'],['grant','Грант'],['patent','Патент'],['project','Проект'],['research_report','Отчёт НИР'],['other','Другое']].map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <label class="field"><span>Классификация содержит</span><input name="classification" placeholder="Например, ВАК"></label>
      </div>
      <fieldset class="science-report-fields"><legend>Поля отчёта</legend>${REPORT_FIELDS.map(([value,label]) => `<label><input type="checkbox" name="fields" value="${value}" checked><span>${label}</span></label>`).join('')}</fieldset>
      <div class="science-report-grid-two">
        <label class="field"><span>Формат</span><select name="format" data-science-report-format><option value="docx">DOCX</option><option value="csv">CSV</option></select></label>
        <label class="field" data-science-template-field><span>DOCX-образец</span><select name="templateDocumentId">${templateOptions()}</select></label>
      </div>
      <p class="science-report-helper">В пользовательском DOCX-образце поле <code>{{SCIENCE_TABLE}}</code> должно находиться в отдельном абзаце. Дополнительно доступны <code>{{SCIENCE_TITLE}}</code>, <code>{{SCIENCE_PERIOD}}</code> и <code>{{SCIENCE_COUNT}}</code>.</p>
      <div class="science-report-preview" data-science-report-preview><div class="science-report-empty">Нажмите «Проверить выбор», чтобы увидеть количество и первые строки.</div></div>
      <div class="science-report-actions"><button class="secondary-button" type="button" data-science-report-preview-button>Проверить выбор</button><button class="primary-button" type="submit">Сформировать</button></div>
    </form>`;
}

function formSelection(form) {
  const data = new FormData(form);
  return {
    title: String(data.get('title') || '').trim(),
    format: String(data.get('format') || 'docx'),
    templateDocumentId: String(data.get('templateDocumentId') || '') || null,
    fields: data.getAll('fields').map(String),
    filters: {
      yearFrom: String(data.get('yearFrom') || '') || null,
      yearTo: String(data.get('yearTo') || '') || null,
      lifecycleStatus: String(data.get('lifecycleStatus') || '') || null,
      unitId: String(data.get('unitId') || '') || null,
      personId: String(data.get('personId') || '') || null,
      kind: String(data.get('kind') || '') || null,
      classification: String(data.get('classification') || '').trim() || null
    }
  };
}

function queryFor(selection) {
  const query = new URLSearchParams();
  for (const [name,value] of Object.entries(selection.filters)) if (value) query.set(name === 'lifecycleStatus' ? 'status' : name, value);
  for (const field of selection.fields) query.append('field', field);
  return query;
}

function previewHtml(data) {
  const rows = data.rows || [];
  return `
    <div class="science-report-summary"><div><strong>${Number(data.summary?.total || 0)}</strong><span>материалов</span></div><div><strong>${Number(data.summary?.uniqueAuthors || 0)}</strong><span>авторов</span></div></div>
    ${rows.length ? `<div class="science-report-table"><table><thead><tr>${data.headers.map((header) => `<th>${escReport(header.label)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,8).map((row) => `<tr>${data.fields.map((field) => `<td>${escReport(row[field] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="science-report-empty">По выбранным условиям материалов нет.</div>'}
  `;
}

async function previewReport(form) {
  const selection = formSelection(form);
  formError(form, '');
  try {
    const data = await reportApi(`/api/science-reports/preview?${queryFor(selection)}`);
    scienceReportsState.preview = data;
    $sr('[data-science-report-preview]', form).innerHTML = previewHtml(data);
  } catch (error) {
    formError(form, error.message);
  }
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2,'0')).join('').slice(0,40);
}

async function generateReport(form) {
  const selection = formSelection(form);
  const submit = $sr('button[type="submit"]', form);
  submit.disabled = true;
  formError(form, '');
  try {
    selection.idempotencyKey = `science-report:${await digest(selection)}`;
    const run = await reportApi('/api/science-reports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selection)
    });
    showReportModal(`
      <header class="science-report-modal-head"><div><span>Отчёт готов</span><h3 id="science-report-modal-title">${escReport(run.generated_document_title || selection.title)}</h3></div><button class="icon-button" type="button" data-science-report-close>×</button></header>
      <div class="science-report-modal-body"><div class="science-report-ready"><strong>${Number(run.row_count || 0)}</strong><span>строк в отчёте</span></div><p>Документ зарегистрирован в системе и сохраняется вместе с историей генерации.</p><div class="science-report-actions"><button class="secondary-button" type="button" data-science-report-close>Закрыть</button><a class="primary-button" href="/api/documents/${encodeURIComponent(run.generated_document_id)}/content?variant=original" target="_blank" rel="noopener">Открыть отчёт</a></div></div>`);
  } catch (error) {
    formError(form, error.message);
    submit.disabled = false;
  }
}

async function openReport() {
  try {
    const [organization, documents] = await Promise.all([
      reportApi('/api/organization?includeInactive=1'),
      reportApi('/api/documents?limit=500')
    ]);
    scienceReportsState.organization = organization;
    scienceReportsState.documents = documents.items || [];
    showReportModal(reportForm());
  } catch (error) {
    showReportModal(`<header class="science-report-modal-head"><div><h3 id="science-report-modal-title">Не удалось открыть отчёт</h3></div><button class="icon-button" type="button" data-science-report-close>×</button></header><div class="science-report-modal-body"><div class="science-report-error">${escReport(error.message)}</div><div class="science-report-actions"><button class="primary-button" type="button" data-science-report-close>Закрыть</button></div></div>`);
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-science-report-open]')) return openReport();
  if (event.target.closest('[data-science-report-close]') || event.target === $sr('#science-report-backdrop')) return closeReportModal();
  if (event.target.closest('[data-science-report-preview-button]')) return previewReport(event.target.closest('form'));
}, true);

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-science-report-format]')) {
    $sr('[data-science-template-field]', event.target.form)?.classList.toggle('hidden', event.target.value !== 'docx');
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-science-report-form]');
  if (!form) return;
  event.preventDefault();
  generateReport(form);
});

new MutationObserver(() => {
  clearTimeout(scienceReportsState.timer);
  scienceReportsState.timer = setTimeout(ensureReportUi, 40);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

ensureReportUi();
