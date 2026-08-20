const scienceImportState = {
  documentId: null,
  analysis: null,
  uploadedName: null,
  timer: null
};

const $si = (selector, root = document) => root.querySelector(selector);

function escImport(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function importApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureImportStyles() {
  if ($si('#science-import-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'science-import-next-styles';
  link.rel = 'stylesheet';
  link.href = '/science-import-next.css';
  document.head.append(link);
}

function ensureImportUi() {
  ensureImportStyles();
  if (!$si('#science-import-modal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="science-import-backdrop" class="science-import-backdrop hidden"></div>
      <section id="science-import-modal" class="science-import-modal hidden" role="dialog" aria-modal="true" aria-labelledby="science-import-modal-title"></section>
    `);
  }
  const sciencePanel = $si('[data-view-panel="science"]');
  if (sciencePanel && !$si('[data-science-import-open]', sciencePanel)) {
    const heading = $si('.view-header, .science-header, header', sciencePanel) || sciencePanel;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button science-import-open';
    button.dataset.scienceImportOpen = '1';
    button.textContent = 'Импортировать список';
    heading.append(button);
  }
}

function showImportModal(html) {
  ensureImportUi();
  $si('#science-import-modal').innerHTML = html;
  $si('#science-import-backdrop').classList.remove('hidden');
  $si('#science-import-modal').classList.remove('hidden');
  document.body.classList.add('science-import-modal-open');
}

function closeImportModal() {
  $si('#science-import-backdrop')?.classList.add('hidden');
  $si('#science-import-modal')?.classList.add('hidden');
  document.body.classList.remove('science-import-modal-open');
}

function importError(form, message = '') {
  let target = $si('[data-science-import-error]', form);
  if (!target) {
    target = document.createElement('div');
    target.dataset.scienceImportError = '1';
    target.className = 'science-import-error hidden';
    target.setAttribute('role', 'alert');
    $si('.science-import-actions', form)?.insertAdjacentElement('beforebegin', target);
  }
  target.textContent = message;
  target.classList.toggle('hidden', !message);
}

function uploadForm() {
  return `
    <header class="science-import-modal-head"><div><span>Научный реестр</span><h3 id="science-import-modal-title">Массовый импорт</h3></div><button class="icon-button" type="button" data-science-import-close>×</button></header>
    <form class="science-import-modal-body" data-science-import-upload-form>
      <p>Загрузите CSV, JSON, XLSX или ODS. Одна ошибочная строка не остановит остальные.</p>
      <label class="field"><span>Файл</span><input name="file" type="file" accept=".csv,.json,.xlsx,.ods,.txt" required></label>
      <p class="science-import-helper">Исходный файл сохранится в документах неизменяемо. Перед импортом система покажет сопоставление колонок.</p>
      <div class="science-import-upload-state hidden" data-science-import-upload-state></div>
      <div class="science-import-actions"><button class="secondary-button" type="button" data-science-import-close>Отмена</button><button class="primary-button" type="submit">Проверить файл</button></div>
    </form>`;
}

const FIELD_LABELS = [
  ['title','Название',true], ['kind','Вид',false], ['authors','Авторы',false], ['doi','DOI',false],
  ['publicationYear','Год',false], ['publishedAt','Дата публикации',false], ['venue','Издание/мероприятие',false],
  ['classifications','Классификации',false], ['lifecycleStatus','Этап',false], ['targetVenue','Целевое издание',false],
  ['nextAction','Следующее действие',false], ['nextActionDue','Срок',false]
];

function columnOptions(headers, selected, required) {
  return `${required ? '' : '<option value="">Не импортировать</option>'}${headers.map((header, index) => `
    <option value="${index}" ${Number(selected) === index ? 'selected' : ''}>${escImport(header)}</option>
  `).join('')}`;
}

function previewTable(analysis) {
  const preview = analysis.preview || [];
  if (!preview.length) return '<div class="science-import-empty">В файле нет строк для импорта.</div>';
  return `<div class="science-import-preview"><table><thead><tr>${analysis.headers.map((header) => `<th>${escImport(header)}</th>`).join('')}</tr></thead><tbody>${preview.slice(0,10).map((row) => `<tr>${analysis.headers.map((_header,index) => `<td>${escImport(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function mappingForm(analysis) {
  return `
    <header class="science-import-modal-head"><div><span>Шаг 2 из 2</span><h3 id="science-import-modal-title">Сопоставьте колонки</h3></div><button class="icon-button" type="button" data-science-import-close>×</button></header>
    <form class="science-import-modal-body" data-science-import-mapping-form>
      <div class="science-import-source"><strong>${escImport(scienceImportState.uploadedName || analysis.source.originalName)}</strong><span>${analysis.rowCount} строк</span></div>
      <div class="science-import-mapping">${FIELD_LABELS.map(([name,label,required]) => `
        <label class="field"><span>${label}${required ? ' *' : ''}</span><select name="${name}" ${required ? 'required' : ''}>${columnOptions(analysis.headers, analysis.suggestedMapping[name], required)}</select></label>
      `).join('')}</div>
      <label class="science-import-check"><input name="updateExisting" type="checkbox"><span>Обновлять найденные карточки. Без флага дубликаты будут пропущены.</span></label>
      ${previewTable(analysis)}
      <div class="science-import-actions"><button class="secondary-button" type="button" data-science-import-back>Назад</button><button class="primary-button" type="submit">Импортировать</button></div>
    </form>`;
}

function statusLabel(value) {
  return { imported: 'Добавлено', updated: 'Обновлено', skipped: 'Пропущено', needs_review: 'Нужно проверить', error: 'Ошибка' }[value] || value;
}

function resultView(run) {
  return `
    <header class="science-import-modal-head"><div><span>Импорт завершён</span><h3 id="science-import-modal-title">Результат по строкам</h3></div><button class="icon-button" type="button" data-science-import-close>×</button></header>
    <div class="science-import-modal-body">
      <div class="science-import-summary">
        <div><strong>${Number(run.imported_rows || 0)}</strong><span>добавлено</span></div>
        <div><strong>${Number(run.updated_rows || 0)}</strong><span>обновлено</span></div>
        <div><strong>${Number(run.skipped_rows || 0)}</strong><span>пропущено</span></div>
        <div><strong>${Number(run.review_rows || 0)}</strong><span>проверить</span></div>
        <div><strong>${Number(run.error_rows || 0)}</strong><span>ошибок</span></div>
      </div>
      <div class="science-import-results">${(run.rows || []).map((row) => `
        <article data-status="${escImport(row.status)}"><span class="science-import-row-no">${row.row_no}</span><div><strong>${escImport(row.normalized?.title || row.source?.[0] || 'Строка')}</strong><span>${escImport(statusLabel(row.status))}${row.message ? ` · ${escImport(row.message)}` : ''}</span></div></article>
      `).join('')}</div>
      <div class="science-import-actions"><button class="primary-button" type="button" data-science-import-close>Готово</button></div>
    </div>`;
}

function uploadKey(file) {
  return `science-import:${file.name}:${file.size}:${file.lastModified}`;
}

async function waitForDocument(documentId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const document = await importApi(`/api/documents/${encodeURIComponent(documentId)}`);
    if (['processed','needs_review'].includes(document.processing_status)) return document;
    if (document.processing_status === 'failed') throw new Error('Файл сохранён, но его не удалось обработать. Откройте карточку документа для подробностей.');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Файл сохранён, обработка продолжается. Повторите анализ позже — загружать файл второй раз не нужно.');
}

async function saveUpload(form) {
  const data = new FormData(form);
  const file = data.get('file');
  const submit = $si('button[type="submit"]', form);
  const state = $si('[data-science-import-upload-state]', form);
  submit.disabled = true;
  importError(form, '');
  try {
    if (!scienceImportState.documentId) {
      if (!(file instanceof File) || !file.size) throw new Error('Выберите файл.');
      const uploaded = await importApi('/api/documents', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'x-document-type': 'other',
          'idempotency-key': uploadKey(file)
        },
        body: file
      });
      scienceImportState.documentId = uploaded.documentId;
      scienceImportState.uploadedName = file.name;
      state.textContent = 'Файл сохранён в документах. Повторная попытка не загрузит его второй раз.';
      state.classList.remove('hidden');
    }
    await waitForDocument(scienceImportState.documentId);
    scienceImportState.analysis = await importApi('/api/science-imports/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: scienceImportState.documentId })
    });
    showImportModal(mappingForm(scienceImportState.analysis));
  } catch (error) {
    importError(form, error.message);
    if (scienceImportState.documentId) {
      state.textContent = 'Файл уже сохранён. Исправьте ошибку или повторите проверку без повторной загрузки.';
      state.classList.remove('hidden');
    }
    submit.disabled = false;
  }
}

async function saveImport(form) {
  const data = new FormData(form);
  const mapping = {};
  for (const [name] of FIELD_LABELS) {
    const value = data.get(name);
    if (value !== null && value !== '') mapping[name] = Number(value);
  }
  const submit = $si('button[type="submit"]', form);
  submit.disabled = true;
  importError(form, '');
  try {
    const run = await importApi('/api/science-imports', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId: scienceImportState.documentId,
        mapping,
        options: { updateExisting: data.get('updateExisting') === 'on' },
        idempotencyKey: `science-import:${scienceImportState.documentId}:${JSON.stringify(mapping)}:${data.get('updateExisting') === 'on' ? 1 : 0}`
      })
    });
    showImportModal(resultView(run));
    if (typeof window.loadScience === 'function') window.loadScience();
  } catch (error) {
    importError(form, error.message);
    submit.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-science-import-open]')) {
    scienceImportState.documentId = null;
    scienceImportState.analysis = null;
    scienceImportState.uploadedName = null;
    showImportModal(uploadForm());
    return;
  }
  if (event.target.closest('[data-science-import-close]') || event.target === $si('#science-import-backdrop')) return closeImportModal();
  if (event.target.closest('[data-science-import-back]')) return showImportModal(uploadForm());
}, true);

document.addEventListener('submit', (event) => {
  const upload = event.target.closest('[data-science-import-upload-form]');
  if (upload) { event.preventDefault(); saveUpload(upload); return; }
  const mapping = event.target.closest('[data-science-import-mapping-form]');
  if (mapping) { event.preventDefault(); saveImport(mapping); }
}, true);

new MutationObserver(() => {
  clearTimeout(scienceImportState.timer);
  scienceImportState.timer = setTimeout(ensureImportUi, 40);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

ensureImportUi();
