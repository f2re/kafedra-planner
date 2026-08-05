const structureState = {
  documentId: null,
  data: null,
  selectedBlockId: null,
  activePage: null,
  activeSheet: null
};

const $s = (selector, root = document) => root.querySelector(selector);
const $$s = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeStructure(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function structureApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureStructureStyles() {
  if ($s('#structure-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'structure-next-styles';
  link.rel = 'stylesheet';
  link.href = '/structure-next.css';
  document.head.append(link);
}

function locatorLabel(block) {
  const locator = block.locator || {};
  if (locator.kind === 'docx_paragraph') return `Абзац ${locator.paragraph}`;
  if (locator.kind === 'docx_table_cell') return `Таблица ${locator.table} · ${locator.row}:${locator.column}`;
  if (locator.kind === 'xlsx_cell') return `${locator.sheet} · ${locator.cell}`;
  if (locator.kind === 'pdf_bbox') return `Страница ${locator.page} · строка ${locator.line}`;
  if (locator.kind === 'odf_table_cell') return `${locator.table} · ${locator.row}:${locator.column}`;
  if (locator.kind === 'text_line') return `Строка ${locator.line}`;
  return block.type;
}

function blockHtml(block) {
  return `<button type="button" class="structure-block ${escapeStructure(block.type)}" data-structure-block="${escapeStructure(block.id)}">
    <span class="structure-block-text">${escapeStructure(block.text)}</span>
    <small>${escapeStructure(locatorLabel(block))}</small>
  </button>`;
}

function excelColumnNumber(column) {
  return [...String(column || '').toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function renderSpreadsheet(blocks) {
  const rows = new Map();
  let maxColumn = 0;
  for (const block of blocks) {
    const row = Number(block.metadata?.row || 0);
    const column = excelColumnNumber(block.metadata?.column);
    if (!row || !column || row > 200 || column > 50) continue;
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(column, block);
    maxColumn = Math.max(maxColumn, column);
  }
  const orderedRows = [...rows.keys()].sort((a, b) => a - b);
  if (!orderedRows.length) return '<div class="empty-state">На выбранном листе нет отображаемых ячеек.</div>';
  const header = Array.from({ length: maxColumn }, (_, index) => `<th>${index + 1}</th>`).join('');
  return `<div class="structure-sheet-wrap"><table class="structure-sheet"><thead><tr><th></th>${header}</tr></thead><tbody>${orderedRows.map((row) => `<tr><th>${row}</th>${Array.from({ length: maxColumn }, (_, index) => {
    const block = rows.get(row).get(index + 1);
    return block
      ? `<td><button type="button" data-structure-block="${escapeStructure(block.id)}">${escapeStructure(block.text)}</button></td>`
      : '<td></td>';
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderPdf(blocks) {
  if (!blocks.length) return '<div class="empty-state">На выбранной странице не найден текстовый слой.</div>';
  const geometry = blocks.find((item) => item.geometry)?.geometry || {};
  const width = Number(geometry.pageWidth || 595);
  const height = Number(geometry.pageHeight || 842);
  return `<div class="structure-pdf-stage"><div class="structure-pdf-page" style="aspect-ratio:${width}/${height}">${blocks.map((block) => {
    const box = block.geometry || {};
    const left = width ? Number(box.x || 0) / width * 100 : 0;
    const top = height ? Number(box.y || 0) / height * 100 : 0;
    const boxWidth = width ? Math.max(1, Number(box.width || 0) / width * 100) : 100;
    const boxHeight = height ? Math.max(1, Number(box.height || 0) / height * 100) : 2;
    return `<button type="button" class="structure-pdf-line" data-structure-block="${escapeStructure(block.id)}" style="left:${left}%;top:${top}%;width:${boxWidth}%;height:${boxHeight}%" title="${escapeStructure(block.text)}">${escapeStructure(block.text)}</button>`;
  }).join('')}</div></div>`;
}

function visibleBlocks(data) {
  let blocks = data.blocks || [];
  if (structureState.activePage) blocks = blocks.filter((item) => Number(item.locator?.page) === Number(structureState.activePage));
  if (structureState.activeSheet) blocks = blocks.filter((item) => item.locator?.sheet === structureState.activeSheet);
  return blocks;
}

function renderFacets(data) {
  const pageButtons = (data.summary?.pages || []).map((page) => `<button type="button" class="structure-facet ${Number(structureState.activePage) === Number(page) ? 'active' : ''}" data-structure-page="${page}">Страница ${page}</button>`).join('');
  const sheetButtons = (data.summary?.sheets || []).map((sheet) => `<button type="button" class="structure-facet ${structureState.activeSheet === sheet ? 'active' : ''}" data-structure-sheet="${escapeStructure(sheet)}">${escapeStructure(sheet)}</button>`).join('');
  if (!pageButtons && !sheetButtons) return '';
  return `<div class="structure-facets">${pageButtons}${sheetButtons}</div>`;
}

function renderSource(data) {
  const blocks = visibleBlocks(data);
  const format = data.document?.detected_format;
  let body;
  if (format === 'pdf') body = renderPdf(blocks);
  else if (format === 'xlsx' || format === 'ods') body = renderSpreadsheet(blocks);
  else body = `<div class="structure-document-canvas">${blocks.map(blockHtml).join('') || '<div class="empty-state">Структурные блоки пока не построены.</div>'}</div>`;
  return `<section class="inspector-section structure-source-section">
    <div class="inspector-section-head"><h3>Источник документа</h3><span>${Number(data.summary?.blockCount || 0)} блоков</span></div>
    <p class="structure-helper">Нажмите фрагмент, чтобы использовать его как доказательство при исправлении поля.</p>
    ${renderFacets(data)}
    <div id="structure-source-view">${body}</div>
  </section>`;
}

function fieldInput(field, value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (field?.type === 'boolean') {
    return `<select name="value"><option value="true" ${value === true ? 'selected' : ''}>Да</option><option value="false" ${value === false ? 'selected' : ''}>Нет</option></select>`;
  }
  if (field?.type === 'text') return `<textarea name="value" rows="3">${escapeStructure(stringValue)}</textarea>`;
  if (field?.type === 'number') return `<input name="value" type="number" step="any" value="${escapeStructure(stringValue)}">`;
  if (field?.type === 'date') return `<input name="value" type="date" value="${escapeStructure(stringValue)}">`;
  return `<input name="value" type="text" value="${escapeStructure(stringValue)}">`;
}

function renderExtractions(data) {
  if (!(data.extractions || []).length) return '';
  return `<section class="inspector-section structure-fields-section"><h3>Проверяемые поля</h3>${data.extractions.map((extraction) => {
    const fieldMap = new Map((extraction.fields || []).map((field) => [field.key, field]));
    return `<div class="structure-extraction"><div class="inspector-section-head"><strong>${escapeStructure(extraction.templateName)}</strong><span>${Math.round(Number(extraction.confidence || 0) * 100)}%</span></div>${Object.entries(extraction.values || {}).map(([key, value]) => {
      const field = fieldMap.get(key) || { key, label: key, type: 'string' };
      const evidence = extraction.evidence?.[key] || {};
      const override = extraction.overrides?.[key];
      return `<article class="structure-field-row" data-structure-field="${escapeStructure(key)}" data-extraction-id="${escapeStructure(extraction.id)}">
        <div class="structure-field-copy"><span>${escapeStructure(field.label || key)}</span><strong>${escapeStructure(typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : value)}</strong><small>${override ? 'Исправлено вручную' : evidence.blockIds?.length ? 'Источник найден' : 'Источник требует выбора'}</small></div>
        <div class="structure-field-actions"><button type="button" class="text-button" data-show-evidence="${escapeStructure((evidence.blockIds || []).join(','))}">Показать источник</button><button type="button" class="secondary-button" data-edit-structured-field="${escapeStructure(key)}">Исправить</button></div>
        <form class="structure-override-form hidden" data-override-form>
          <label class="field"><span>Новое значение</span>${fieldInput(field, value)}</label>
          <label class="field"><span>Причина</span><input name="reason" type="text" placeholder="Например, исправлена опечатка"></label>
          <div class="structure-selected-source">Доказательство: <strong data-selected-source-label>${evidence.blockIds?.length ? 'исходный фрагмент' : 'выберите фрагмент выше'}</strong></div>
          <div class="structure-override-actions"><button type="button" class="text-button" data-cancel-override>Отмена</button><button type="submit" class="primary-button">Сохранить</button></div>
        </form>
      </article>`;
    }).join('')}</div>`;
  }).join('')}</section>`;
}

function renderStructurePanel(data) {
  const body = $s('#ux-inspector-body');
  if (!body) return;
  $s('#structured-evidence-panel')?.remove();
  body.insertAdjacentHTML('beforeend', `<div id="structured-evidence-panel">${renderSource(data)}${renderExtractions(data)}</div>`);
  if (structureState.selectedBlockId) selectBlock(structureState.selectedBlockId);
}

async function loadDocumentStructure(documentId) {
  structureState.documentId = documentId;
  structureState.selectedBlockId = null;
  const data = await structureApi(`/api/documents/${encodeURIComponent(documentId)}/structure?limit=5000`);
  structureState.data = data;
  structureState.activePage = data.summary?.pages?.[0] || null;
  structureState.activeSheet = data.summary?.sheets?.[0] || null;
  let attempts = 0;
  while ((!$s('#ux-inspector-body') || $s('#ux-inspector')?.classList.contains('hidden')) && attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    attempts += 1;
  }
  renderStructurePanel(data);
}

function selectBlock(blockId) {
  structureState.selectedBlockId = blockId;
  $$s('[data-structure-block]').forEach((element) => element.classList.toggle('selected', element.dataset.structureBlock === blockId));
  const block = structureState.data?.blocks?.find((item) => item.id === blockId);
  $$s('[data-selected-source-label]').forEach((element) => {
    element.textContent = block ? locatorLabel(block) : 'выберите фрагмент выше';
  });
}

function showEvidence(ids) {
  const blockIds = String(ids || '').split(',').filter(Boolean);
  $$s('[data-structure-block]').forEach((element) => element.classList.toggle('evidence-highlight', blockIds.includes(element.dataset.structureBlock)));
  const first = blockIds.length ? $s(`[data-structure-block="${CSS.escape(blockIds[0])}"]`) : null;
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function parseOverrideValue(field, form) {
  const raw = new FormData(form).get('value');
  if (field?.type === 'boolean') return raw === 'true';
  if (field?.type === 'number') return Number(raw);
  return String(raw ?? '').trim();
}

async function submitOverride(form) {
  const row = form.closest('[data-extraction-id]');
  const extractionId = row.dataset.extractionId;
  const fieldKey = row.dataset.structureField;
  const extraction = structureState.data?.extractions?.find((item) => item.id === extractionId);
  const field = extraction?.fields?.find((item) => item.key === fieldKey) || { type: 'string' };
  const selected = structureState.data?.blocks?.find((item) => item.id === structureState.selectedBlockId);
  const currentEvidence = extraction?.evidence?.[fieldKey] || {};
  const body = {
    value: parseOverrideValue(field, form),
    locator: selected ? { ...selected.locator, blockId: selected.id } : (currentEvidence.locator || {}),
    reason: String(new FormData(form).get('reason') || '').trim() || null
  };
  await structureApi(`/api/template-extractions/${encodeURIComponent(extractionId)}/fields/${encodeURIComponent(fieldKey)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  await loadDocumentStructure(structureState.documentId);
  const toast = $s('#toast');
  if (toast) {
    toast.textContent = 'Исправление сохранено отдельно от автоматического результата.';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
  }
}

function documentIdFromEvent(event) {
  const title = event.target.closest('.document-open');
  if (title) return title.closest('[data-document-id]')?.dataset.documentId || null;
  const source = event.target.closest('[data-inspector-document]');
  if (source) return source.dataset.inspectorDocument || null;
  return null;
}

document.addEventListener('click', (event) => {
  const documentId = documentIdFromEvent(event);
  if (documentId) setTimeout(() => loadDocumentStructure(documentId).catch(() => {}), 80);

  const block = event.target.closest('[data-structure-block]');
  if (block) selectBlock(block.dataset.structureBlock);
  const page = event.target.closest('[data-structure-page]');
  if (page) {
    structureState.activePage = Number(page.dataset.structurePage);
    renderStructurePanel(structureState.data);
  }
  const sheet = event.target.closest('[data-structure-sheet]');
  if (sheet) {
    structureState.activeSheet = sheet.dataset.structureSheet;
    renderStructurePanel(structureState.data);
  }
  const evidence = event.target.closest('[data-show-evidence]');
  if (evidence) showEvidence(evidence.dataset.showEvidence);
  const edit = event.target.closest('[data-edit-structured-field]');
  if (edit) {
    const row = edit.closest('[data-extraction-id]');
    row.querySelector('[data-override-form]')?.classList.remove('hidden');
    row.querySelector('[name="value"]')?.focus();
  }
  const cancel = event.target.closest('[data-cancel-override]');
  if (cancel) cancel.closest('[data-override-form]')?.classList.add('hidden');
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-override-form]');
  if (!form) return;
  event.preventDefault();
  submitOverride(form).catch((error) => {
    const toast = $s('#toast');
    if (toast) {
      toast.textContent = error.message;
      toast.classList.remove('hidden');
    }
  });
});

ensureStructureStyles();
