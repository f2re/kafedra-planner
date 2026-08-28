import {
  $ap,
  academicApi,
  academicState,
  esc,
  modal,
  modalError
} from './academic-performance-state.js';

function uploadMarkup() {
  return `
    <header class="academic-modal-head"><div><span>Шаг 1 из 2</span><h3 id="academic-modal-title">Загрузить ведомость</h3></div><button class="icon-button" type="button" data-academic-close>×</button></header>
    <form class="academic-modal-body" data-academic-upload-form>
      <p>Поддерживаются XLSX, ODS и CSV. Исходный файл останется в документах неизменяемым.</p>
      <label class="academic-file-drop"><input name="file" type="file" accept=".xlsx,.ods,.csv,.txt" required><strong>Выберите ведомость</strong><span>Студенты — по строкам, дисциплины — по столбцам</span></label>
      <div class="academic-upload-state hidden" data-academic-upload-state></div>
      <p class="academic-inline-error hidden" data-academic-error role="alert"></p>
      <div class="academic-modal-actions"><button class="quiet-button" type="button" data-academic-close>Отмена</button><button class="primary-button" type="submit">Проверить файл</button></div>
    </form>`;
}

function uploadKey(file) {
  return `academic-upload:${file.name}:${file.size}:${file.lastModified}`;
}

async function waitForDocument(documentId) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const documentItem = await academicApi(`/api/documents/${encodeURIComponent(documentId)}`);
    if (['processed', 'needs_review'].includes(documentItem.processing_status)) return documentItem;
    if (documentItem.processing_status === 'failed') {
      throw new Error('Файл сохранён, но таблицу не удалось обработать. Откройте документ для подробностей.');
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('Файл сохранён, обработка продолжается. Повторите проверку без повторной загрузки.');
}

function defaultDraft(analysis) {
  const sheet = analysis.sheets.find((item) => item.name === analysis.preferredSheet)
    || analysis.sheets.find((item) => item.ready)
    || analysis.sheets[0];
  const metadata = {};
  for (const key of ['groupCode', 'academicYear', 'semester']) {
    const preferred = analysis.metadata?.[key]?.preferred;
    metadata[key] = preferred
      ? { mode: 'cell', sheetName: preferred.sheetName, cell: preferred.cell, value: '' }
      : { mode: 'manual', sheetName: '', cell: '', value: '' };
  }
  return {
    sheetName: sheet?.name || '',
    headerRow: sheet?.headerRow || 1,
    studentColumn: sheet?.studentColumn || 1,
    disciplines: (sheet?.disciplines || []).map((item) => ({
      column: item.column,
      name: item.name,
      selected: true
    })),
    metadata
  };
}

function metadataField(key, label, draft, analysis) {
  const binding = draft.metadata[key];
  const options = analysis.cellOptions || [];
  const value = binding.sheetName && binding.cell
    ? JSON.stringify([binding.sheetName, binding.cell])
    : '';
  return `
    <fieldset class="academic-metadata-field" data-meta-field="${key}">
      <legend>${label}</legend>
      <label><span>Источник</span><select data-meta-mode="${key}"><option value="cell" ${binding.mode === 'cell' ? 'selected' : ''}>Из ячейки таблицы</option><option value="manual" ${binding.mode === 'manual' ? 'selected' : ''}>Ввести вручную</option></select></label>
      <label class="${binding.mode === 'cell' ? '' : 'hidden'}" data-meta-cell-wrap="${key}"><span>Ячейка</span><select data-meta-cell="${key}"><option value="">Выберите ячейку</option>${options.map((item) => {
        const optionValue = JSON.stringify([item.sheetName, item.cell]);
        return `<option value="${esc(optionValue)}" ${optionValue === value ? 'selected' : ''}>${esc(item.sheetName)} · ${esc(item.cell)} — ${esc(item.value)}</option>`;
      }).join('')}</select></label>
      <label class="${binding.mode === 'manual' ? '' : 'hidden'}" data-meta-manual-wrap="${key}"><span>Значение</span><input data-meta-manual="${key}" value="${esc(binding.value || '')}" ${key === 'academicYear' ? 'placeholder="2026/2027"' : key === 'semester' ? 'placeholder="1 или 2"' : 'placeholder="ИВТ-31"'}></label>
    </fieldset>`;
}

function sheetByName(name) {
  return academicState.analysis?.sheets?.find((item) => item.name === name) || null;
}

function disciplineChoices(draft, sheet) {
  return (sheet.headers || [])
    .filter((header) => header.column !== Number(draft.studentColumn))
    .map((header) => {
      const existing = draft.disciplines.find((item) => item.column === header.column);
      return `<label class="academic-discipline-choice ${existing?.selected ? 'selected' : ''}"><input type="checkbox" data-discipline-column="${header.column}" ${existing?.selected ? 'checked' : ''}><span>${esc(header.cell)}</span><input type="text" data-discipline-name="${header.column}" value="${esc(existing?.name || header.label)}" aria-label="Название дисциплины ${esc(header.cell)}"></label>`;
    }).join('');
}

function previewMarkup(sheet, draft) {
  const selected = draft.disciplines.filter((item) => item.selected).slice(0, 5);
  if (!sheet.preview?.length) {
    return '<div class="academic-empty academic-empty-small"><span>Строк для предпросмотра нет.</span></div>';
  }
  return `<div class="academic-preview-wrap"><table><thead><tr><th>Студент</th>${selected.map((item) => `<th>${esc(item.name)}</th>`).join('')}</tr></thead><tbody>${sheet.preview.slice(0, 6).map((row) => `<tr><th>${esc(row.student || '—')}</th>${selected.map((item) => `<td>${esc(row.grades.find((grade) => grade.column === item.column)?.value || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function mappingMarkup() {
  const analysis = academicState.analysis;
  const draft = academicState.mappingDraft;
  const sheet = sheetByName(draft.sheetName)
    || analysis.sheets[0]
    || { headers: [], disciplines: [], preview: [] };
  return `
    <header class="academic-modal-head"><div><span>Шаг 2 из 2</span><h3 id="academic-modal-title">Проверьте поля ведомости</h3></div><button class="icon-button" type="button" data-academic-close>×</button></header>
    <form class="academic-modal-body" data-academic-mapping-form>
      <div class="academic-source-card"><strong>${esc(academicState.uploadedName || analysis.source.originalName)}</strong><span>${analysis.ready ? 'Структура оценок найдена автоматически' : 'Укажите структуру вручную'}</span></div>
      <h4>Учебный период и группа</h4>
      <p class="academic-helper">Для каждого поля выберите точную ячейку исходника либо введите значение вручную. Источник сохранится в истории.</p>
      <div class="academic-metadata-grid">${metadataField('academicYear', 'Учебный год', draft, analysis)}${metadataField('semester', 'Семестр', draft, analysis)}${metadataField('groupCode', 'Учебная группа', draft, analysis)}</div>
      <h4>Таблица оценок</h4>
      <div class="academic-mapping-grid">
        <label class="field"><span>Лист</span><select data-academic-sheet>${analysis.sheets.map((item) => `<option value="${esc(item.name)}" ${item.name === sheet.name ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Строка заголовков</span><input type="number" min="1" data-academic-header-row value="${Number(draft.headerRow) || 1}"></label>
        <label class="field"><span>Колонка со студентом</span><select data-academic-student-column>${(sheet.headers || []).map((header) => `<option value="${header.column}" ${Number(draft.studentColumn) === header.column ? 'selected' : ''}>${esc(header.cell)} · ${esc(header.label)}</option>`).join('')}</select></label>
      </div>
      <section class="academic-discipline-section"><header><div><strong>Дисциплины</strong><span>Снимите отметку со служебной колонки или исправьте название.</span></div></header><div>${disciplineChoices(draft, sheet)}</div></section>
      ${previewMarkup(sheet, draft)}
      <p class="academic-helper">Пустая ячейка останется пустой. «Н/а» считается неаттестацией. Неизвестное значение не подменяется и попадёт в проверку.</p>
      <p class="academic-inline-error hidden" data-academic-error role="alert"></p>
      <div class="academic-modal-actions"><button class="quiet-button" type="button" data-academic-back>Назад</button><button class="primary-button" type="submit">Импортировать</button></div>
    </form>`;
}

function captureDraft(form) {
  const draft = academicState.mappingDraft;
  draft.sheetName = $ap('[data-academic-sheet]', form)?.value || draft.sheetName;
  draft.headerRow = Number($ap('[data-academic-header-row]', form)?.value || draft.headerRow);
  draft.studentColumn = Number($ap('[data-academic-student-column]', form)?.value || draft.studentColumn);
  draft.disciplines = [...form.querySelectorAll('[data-discipline-column]')].map((checkbox) => ({
    column: Number(checkbox.dataset.disciplineColumn),
    selected: checkbox.checked,
    name: $ap(`[data-discipline-name="${checkbox.dataset.disciplineColumn}"]`, form)?.value.trim() || ''
  }));
  for (const key of ['groupCode', 'academicYear', 'semester']) {
    const mode = $ap(`[data-meta-mode="${key}"]`, form)?.value || 'manual';
    const combined = $ap(`[data-meta-cell="${key}"]`, form)?.value || '';
    let sheetName = '';
    let cell = '';
    try {
      [sheetName, cell] = JSON.parse(combined || '[]');
    } catch {}
    draft.metadata[key] = {
      mode,
      sheetName,
      cell,
      value: $ap(`[data-meta-manual="${key}"]`, form)?.value.trim() || ''
    };
  }
  return draft;
}

function bindMappingInteractions() {
  const form = $ap('[data-academic-mapping-form]');
  if (!form) return;
  form.querySelectorAll('[data-meta-mode]').forEach((select) => {
    select.addEventListener('change', () => {
      const key = select.dataset.metaMode;
      $ap(`[data-meta-cell-wrap="${key}"]`, form)?.classList.toggle('hidden', select.value !== 'cell');
      $ap(`[data-meta-manual-wrap="${key}"]`, form)?.classList.toggle('hidden', select.value !== 'manual');
    });
  });
  $ap('[data-academic-sheet]', form)?.addEventListener('change', (event) => {
    captureDraft(form);
    const sheet = sheetByName(event.target.value);
    academicState.mappingDraft.sheetName = event.target.value;
    academicState.mappingDraft.headerRow = sheet?.headerRow || 1;
    academicState.mappingDraft.studentColumn = sheet?.studentColumn || 1;
    academicState.mappingDraft.disciplines = (sheet?.disciplines || []).map((item) => ({
      column: item.column,
      name: item.name,
      selected: true
    }));
    modal(mappingMarkup(), true);
    bindMappingInteractions();
  });
  form.querySelectorAll('[data-discipline-column]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      checkbox.closest('.academic-discipline-choice')?.classList.toggle('selected', checkbox.checked);
    });
  });
}

export function beginAcademicImport() {
  academicState.documentId = null;
  academicState.analysis = null;
  academicState.uploadedName = '';
  academicState.mappingDraft = null;
  modal(uploadMarkup());
}

export function backToAcademicUpload() {
  modal(uploadMarkup());
}

export async function saveAcademicUpload(form) {
  const file = new FormData(form).get('file');
  const submit = $ap('button[type="submit"]', form);
  const state = $ap('[data-academic-upload-state]', form);
  submit.disabled = true;
  modalError(form, '');
  try {
    if (!academicState.documentId) {
      if (!(file instanceof File) || !file.size) throw new Error('Выберите файл ведомости.');
      const uploaded = await academicApi('/api/documents', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'x-document-type': 'other',
          'idempotency-key': uploadKey(file)
        },
        body: file
      });
      academicState.documentId = uploaded.documentId;
      academicState.uploadedName = file.name;
      state.textContent = 'Исходный файл сохранён. Повторная попытка не загрузит его второй раз.';
      state.classList.remove('hidden');
    }
    await waitForDocument(academicState.documentId);
    academicState.analysis = await academicApi('/api/academic-performance/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: academicState.documentId })
    });
    academicState.mappingDraft = defaultDraft(academicState.analysis);
    modal(mappingMarkup(), true);
    bindMappingInteractions();
  } catch (error) {
    modalError(form, error.message);
    submit.disabled = false;
    if (academicState.documentId) {
      state.textContent = 'Файл уже сохранён. Повторите только проверку.';
      state.classList.remove('hidden');
    }
  }
}

function importPayload(form) {
  const draft = captureDraft(form);
  const metadata = {};
  for (const key of ['groupCode', 'academicYear', 'semester']) {
    const binding = draft.metadata[key];
    metadata[key] = binding.mode === 'cell'
      ? { mode: 'cell', sheetName: binding.sheetName, cell: binding.cell }
      : { mode: 'manual', value: binding.value };
  }
  const profile = {
    sheetName: draft.sheetName,
    headerRow: draft.headerRow,
    studentColumn: draft.studentColumn,
    disciplines: draft.disciplines.filter((item) => item.selected).map((item) => ({
      column: item.column,
      name: item.name
    }))
  };
  return {
    documentId: academicState.documentId,
    metadata,
    profile,
    idempotencyKey: `academic-import:${academicState.documentId}:${JSON.stringify({ metadata, profile })}`
  };
}

export async function saveAcademicImport(form) {
  const submit = $ap('button[type="submit"]', form);
  submit.disabled = true;
  modalError(form, '');
  try {
    const result = await academicApi('/api/academic-performance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(importPayload(form))
    });
    academicState.selectedId = result.id;
    modal(`
      <header class="academic-modal-head"><div><span>Импорт завершён</span><h3 id="academic-modal-title">Сводка готова</h3></div><button class="icon-button" type="button" data-academic-close>×</button></header>
      <div class="academic-modal-body">
        <div class="academic-result-grid"><div><span>Учебный год</span><strong>${esc(result.academic_year)}</strong></div><div><span>Семестр</span><strong>${result.semester}</strong></div><div><span>Группа</span><strong>${esc(result.group_code)}</strong></div></div>
        <div class="academic-metrics academic-result-metrics"><div><strong>${result.total_students}</strong><span>студентов</span></div><div><strong>${result.discipline_count}</strong><span>дисциплин</span></div><div><strong>${result.accepted_cells}</strong><span>принято значений</span></div><div class="${result.review_cells + result.issue_count ? 'attention' : ''}"><strong>${result.review_cells + result.issue_count}</strong><span>проверить</span></div></div>
        <p>${result.processing_status === 'completed_with_review' ? 'Корректные оценки уже посчитаны. Неоднозначные ячейки отмечены отдельно.' : 'Ведомость стала актуальной для этой группы и учебного периода.'}</p>
        <div class="academic-modal-actions"><button class="primary-button" type="button" data-academic-finish>Открыть сводку</button></div>
      </div>`);
  } catch (error) {
    modalError(form, error.message);
    submit.disabled = false;
  }
}
