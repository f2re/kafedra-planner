import {
  meetingsState,
  $m,
  escMeeting,
  meetingApi,
  openMeetingModal,
  showMeetingNotice
} from './meetings-state.js';

let editorState = null;
let enhancerInstalled = false;

function ensureStyles() {
  if ($m('#meeting-template-editor-styles')) return;
  const link = document.createElement('link');
  link.id = 'meeting-template-editor-styles';
  link.rel = 'stylesheet';
  link.href = '/meeting-template-editor.css';
  document.head.append(link);
}

function safeNumber(value, min = -1000, max = 3000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function nearest(value, steps) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return steps.reduce((best, candidate) =>
    Math.abs(candidate - number) < Math.abs(best - number) ? candidate : best, steps[0]);
}

function spacingClass(prefix, value) {
  const number = safeNumber(value, 0, 144);
  if (number === null || number === 0) return null;
  return `${prefix}-${nearest(number, [6, 12, 18, 24, 36, 48, 72, 96, 144])}`;
}

function lineClass(value) {
  const number = safeNumber(value, 6, 96);
  return number === null ? null : `meeting-template-line-${nearest(number, [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72])}`;
}

function paragraphClasses(style = {}) {
  const classes = ['meeting-template-element'];
  const alignment = style.alignment === 'both' ? 'justify' : style.alignment;
  if (['left', 'center', 'right', 'justify'].includes(alignment)) classes.push(`meeting-template-align-${alignment}`);
  const mapped = [
    spacingClass('meeting-template-ml', style.marginLeftPt),
    spacingClass('meeting-template-mr', style.marginRightPt),
    spacingClass('meeting-template-before', style.spaceBeforePt),
    spacingClass('meeting-template-after', style.spaceAfterPt),
    spacingClass('meeting-template-indent', style.firstLinePt),
    spacingClass('meeting-template-hanging', style.hangingPt),
    lineClass(style.linePt)
  ];
  for (const item of mapped) if (item) classes.push(item);
  if (style.numbering) classes.push('meeting-template-numbered');
  return classes;
}

function fontFamilyClass(value) {
  const family = String(value || '').trim().toLocaleLowerCase('ru-RU');
  if (!family) return null;
  if (family.includes('times') || family.includes('liberation serif') || family.includes('pt serif')) return 'meeting-template-font-serif';
  if (family.includes('arial') || family.includes('liberation sans')) return 'meeting-template-font-arial';
  if (family.includes('calibri') || family.includes('carlito')) return 'meeting-template-font-calibri';
  if (family.includes('courier') || family.includes('liberation mono')) return 'meeting-template-font-mono';
  return null;
}

function colorClass(prefix, value) {
  const color = String(value || '').toUpperCase();
  const colors = new Map([
    ['#000000', 'black'], ['#FFFFFF', 'white'], ['#FF0000', 'red'], ['#C00000', 'dark-red'],
    ['#0000FF', 'blue'], ['#0070C0', 'dark-blue'], ['#008000', 'green'], ['#00B050', 'light-green'],
    ['#808080', 'gray'], ['#D9D9D9', 'light-gray'], ['#FFFF00', 'yellow']
  ]);
  const name = colors.get(color);
  return name ? `${prefix}-${name}` : null;
}

function runHtml(run) {
  const style = run.style || {};
  const classes = ['meeting-template-run'];
  if (style.bold) classes.push('is-bold');
  if (style.italic) classes.push('is-italic');
  if (style.underline) classes.push('is-underline');
  if (style.strike) classes.push('is-strike');
  const size = safeNumber(style.fontSizePt, 5, 96);
  if (size !== null) classes.push(`meeting-template-size-${nearest(size, [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72])}`);
  const family = fontFamilyClass(style.fontFamily);
  const color = colorClass('meeting-template-color', style.color);
  const background = colorClass('meeting-template-bg', style.backgroundColor);
  if (family) classes.push(family);
  if (color) classes.push(color);
  if (background) classes.push(background);
  return `<span class="${classes.join(' ')}">${escMeeting(run.text)}</span>`;
}

function elementHtml(element, flags = {}) {
  const classes = paragraphClasses(element.style);
  if (flags.isRepeat) classes.push('is-agenda-block');
  if (flags.isStart) classes.push('is-agenda-block-start');
  if (flags.isEnd) classes.push('is-agenda-block-end');
  const runs = (element.runs || []).map(runHtml).join('') || escMeeting(element.text || ' ');
  return `<p class="${classes.join(' ')}" data-template-element="${escMeeting(element.elementId)}" data-child-index="${element.childIndex || ''}">${runs}</p>`;
}

function widthClass(width, total) {
  if (!Number.isFinite(width) || !Number.isFinite(total) || total <= 0) return null;
  const percentage = Math.max(10, Math.min(100, Math.round((width / total) * 10) * 10));
  return `meeting-template-width-${percentage}`;
}

function tableHtml(block, flags = {}) {
  const tableClasses = ['meeting-template-table'];
  if (flags.isRepeat) tableClasses.push('is-agenda-block');
  if (flags.isStart) tableClasses.push('is-agenda-block-start');
  if (flags.isEnd) tableClasses.push('is-agenda-block-end');
  return `<table class="${tableClasses.join(' ')}" data-template-element="${escMeeting(block.elementId || '')}" data-child-index="${block.childIndex || ''}"><tbody>${(block.rows || []).map((row) => {
    const total = row.cells.reduce((sum, cell) => sum + (Number(cell.widthPt) || 0), 0);
    return `<tr>${(row.cells || []).map((cell) => {
      const classes = [];
      const width = widthClass(Number(cell.widthPt), total);
      const background = colorClass('meeting-template-bg', cell.backgroundColor);
      if (width) classes.push(width);
      if (background) classes.push(background);
      if (cell.verticalMerge) classes.push(`meeting-template-vmerge-${cell.verticalMerge}`);
      const span = Number.isInteger(Number(cell.columnSpan)) && Number(cell.columnSpan) > 1
        ? ` colspan="${Number(cell.columnSpan)}"` : '';
      return `<td${span}${classes.length ? ` class="${classes.join(' ')}"` : ''}>${(cell.paragraphs || []).map((p) => elementHtml(p, flags)).join('')}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table>`;
}

function fieldLabel(key) {
  return editorState?.analysis?.fields?.find((field) => field.key === key)?.label || key;
}

function getBlockForElement(elementId) {
  if (!editorState?.analysis?.blocks || !elementId) return null;
  const pMatch = /#body\/p:(\d+)$/u.exec(elementId);
  if (pMatch) {
    return editorState.analysis.blocks.find((b) => b.elementId === elementId) || null;
  }
  const tblMatch = /#table:(\d+)/u.exec(elementId);
  if (tblMatch) {
    const tblIdx = Number(tblMatch[1]);
    return editorState.analysis.blocks.find((b) => b.kind === 'table' && b.tableIndex === tblIdx) || null;
  }
  return editorState.analysis.blocks.find((b) => b.elementId === elementId) || null;
}

function renderDocument() {
  const page = $m('#meeting-template-page');
  if (!page || !editorState?.analysis) return;
  const repeat = editorState.repeat;
  let startChild = null;
  let endChild = null;
  if (repeat?.kind === 'block_range') {
    startChild = Number(repeat.startChildIndex);
    endChild = Number(repeat.endChildIndex);
  }
  page.innerHTML = editorState.analysis.blocks.map((block) => {
    const isRepeat = startChild && endChild && block.childIndex >= startChild && block.childIndex <= endChild;
    const isStart = block.childIndex === startChild;
    const isEnd = block.childIndex === endChild;
    return block.kind === 'table' ? tableHtml(block, { isRepeat, isStart, isEnd }) : elementHtml(block, { isRepeat, isStart, isEnd });
  }).join('');
  for (const element of page.querySelectorAll('[data-template-element]')) {
    const fields = editorState.bindings
      .filter((binding) => binding.elementId === element.dataset.templateElement)
      .map((binding) => binding.field);
    element.classList.toggle('has-binding', fields.length > 0);
    element.title = fields.length ? `Назначено: ${fields.map(fieldLabel).join(', ')}` : 'Выделите изменяемый текст';
  }
}

function requiredState() {
  const required = (editorState.analysis.fields || []).filter((field) => field.required);
  const present = new Set(editorState.bindings.map((binding) => binding.field));
  return {
    required,
    ready: required.filter((field) => present.has(field.key)).length,
    missing: required.filter((field) => !present.has(field.key))
  };
}

function inferredRepeat() {
  if (editorState.repeat?.kind === 'block_range') {
    return `Блоки ${editorState.repeat.startChildIndex}–${editorState.repeat.endChildIndex} (текст, таблицы, списки)`;
  }
  if (editorState.repeat?.kind === 'paragraph_range') {
    return `Абзацы ${editorState.repeat.startParagraphIndex}–${editorState.repeat.endParagraphIndex}`;
  }
  if (editorState.repeat?.kind === 'table_row') {
    return `Строка ${editorState.repeat.rowIndex} таблицы ${editorState.repeat.tableIndex}`;
  }
  const agendaFields = new Set((editorState.analysis.fields || [])
    .filter((field) => field.scope === 'agenda').map((field) => field.key));
  const ids = editorState.bindings.filter((binding) => agendaFields.has(binding.field)).map((binding) => binding.elementId);
  if (!ids.length) return 'Не определён (выделите мышкой в документе)';
  const table = ids.map((id) => /#table:(\d+)\/row:(\d+)\//u.exec(id));
  if (table.every(Boolean) && table.every((match) => match[1] === table[0][1] && match[2] === table[0][2])) {
    return `Строка ${table[0][2]} таблицы ${table[0][1]}`;
  }
  const paragraphs = ids.map((id) => /#body\/p:(\d+)$/u.exec(id));
  if (paragraphs.every(Boolean)) {
    const values = paragraphs.map((match) => Number(match[1]));
    return `Абзацы ${Math.min(...values)}–${Math.max(...values)}`;
  }
  return 'Определяется по выделению мышкой';
}

function renderStatus(profile = null) {
  const target = $m('#meeting-template-status');
  if (!target || !editorState) return;
  const state = requiredState();
  const percent = state.required.length ? Math.round((state.ready / state.required.length) * 100) : 100;
  const progress = Math.max(0, Math.min(100, Math.round(percent / 10) * 10));
  const status = profile?.status || editorState.analysis.latestProfile?.status || (state.missing.length ? 'draft' : 'ready');
  target.innerHTML = `
    <div class="meeting-template-status-header">
      <strong>${status === 'ready' ? '✓ Шаблон готов к использованию' : `Назначено ${state.ready} из ${state.required.length} обязательных полей`}</strong>
      <span class="meeting-template-status-pill ${status}">${status === 'ready' ? 'Готов' : 'Черновик'}</span>
    </div>
    <div class="meeting-template-progress"><span class="meeting-template-progress-${progress}"></span></div>
    ${state.missing.length ? `<div class="meeting-template-missing-note">Осталось: <strong>${state.missing.map((field) => escMeeting(field.label)).join(', ')}</strong></div>` : ''}
    <div class="meeting-template-repeat-status">
      <div class="meeting-template-repeat-status-header">
        <small><strong>Повторяемый вопрос:</strong> ${escMeeting(inferredRepeat())}</small>
        ${editorState.repeat ? '<button type="button" class="meeting-template-link-btn" id="meeting-template-clear-repeat" title="Сбросить границы вопроса">Сбросить</button>' : ''}
      </div>
      <span class="meeting-template-repeat-hint">💡 Выделите мышкой область вопроса в документе слева для фиксации границ.</span>
    </div>
    ${editorState.analysis.legacyReady ? '<div class="meeting-template-legacy-note">Совместимый старый шаблон с {{AGENDA}}. Его можно использовать без профиля или постепенно разметить визуально.</div>' : ''}
  `;
}

function renderBindings() {
  const target = $m('#meeting-template-bindings');
  if (!target || !editorState) return;
  target.innerHTML = editorState.bindings.length ? editorState.bindings.map((binding) => `
    <div class="meeting-template-binding" data-binding-field="${escMeeting(binding.field)}">
      <span><strong>${escMeeting(fieldLabel(binding.field))}</strong><small>${escMeeting(binding.expectedText)}</small></span>
      <button type="button" aria-label="Убрать поле ${escMeeting(fieldLabel(binding.field))}" data-remove-template-binding="${escMeeting(binding.field)}">×</button>
    </div>
  `).join('') : '<p>Поля ещё не назначены. Выделите изменяемый текст слева.</p>';
  renderStatus();
  renderDocument();
}

function fieldOptions(selected = '') {
  const groups = [['document', 'Поля заседания'], ['agenda', 'Повторяемый вопрос']];
  return groups.map(([scope, label]) => `<optgroup label="${label}">${editorState.analysis.fields
    .filter((field) => field.scope === scope)
    .map((field) => `<option value="${escMeeting(field.key)}" ${field.key === selected ? 'selected' : ''}>${escMeeting(field.label)}${field.required ? ' · обязательно' : ''}</option>`)
    .join('')}</optgroup>`).join('');
}

function quickChipsHtml() {
  if (!editorState?.analysis?.fields) return '';
  const assigned = new Set(editorState.bindings.map((b) => b.field));
  const unassigned = editorState.analysis.fields.filter((f) => !assigned.has(f.key));
  const chips = unassigned.slice(0, 6);
  if (!chips.length) {
    return '<span class="meeting-template-chips-done">Все обязательные поля назначены</span>';
  }
  return chips.map((f) => `
    <button type="button" class="meeting-template-chip ${f.required ? 'is-required' : ''}" data-quick-assign="${escMeeting(f.key)}" title="Назначить ${escMeeting(f.label)}">
      ${escMeeting(f.label)}
    </button>
  `).join('');
}

function showSelection(selection) {
  editorState.selection = selection;
  for (const element of document.querySelectorAll('[data-template-element]')) {
    element.classList.toggle('is-selected', element.dataset.templateElement === selection.elementId);
  }
  const target = $m('#meeting-template-selection');
  target.innerHTML = `
    <div class="meeting-template-selection-header">
      <strong>Выделенный фрагмент</strong>
      <button id="meeting-template-clear-selection" type="button" class="meeting-template-link-btn">Снять</button>
    </div>
    <blockquote>${escMeeting(selection.expectedText)}</blockquote>
    <div class="meeting-template-quick-chips">
      <span class="meeting-template-chips-label">Быстрое назначение в один клик:</span>
      <div class="meeting-template-chips-list">${quickChipsHtml()}</div>
    </div>
    <div class="meeting-template-field-picker">
      <select id="meeting-template-field-select" aria-label="Все поля">
        <option value="">Другое поле…</option>${fieldOptions()}
      </select>
      <button id="meeting-template-assign" type="button" class="primary-button">Назначить</button>
    </div>
    <div class="meeting-template-single-block-repeat">
      <button id="meeting-template-make-repeat-single" type="button" class="secondary-button meeting-template-btn-block" title="Зафиксировать этот блок целиком как повторяемый вопрос">
        🔁 Зафиксировать этот блок как вопрос
      </button>
    </div>
  `;
}

function findTemplateElement(node) {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest?.('[data-template-element]') || null;
}

function parseElementLocator(elementId) {
  if (!elementId) return null;
  const body = /#body\/p:(\d+)$/u.exec(elementId);
  if (body) return { kind: 'body_paragraph', paragraphIndex: Number(body[1]) };
  const bodyTable = /#body\/table:(\d+)$/u.exec(elementId);
  if (bodyTable) return { kind: 'body_table', tableIndex: Number(bodyTable[1]) };
  const table = /#table:(\d+)\/row:(\d+)\/cell:(\d+)\/p:(\d+)$/u.exec(elementId);
  if (table) {
    return {
      kind: 'table_paragraph', tableIndex: Number(table[1]), rowIndex: Number(table[2]),
      cellIndex: Number(table[3]), paragraphIndex: Number(table[4])
    };
  }
  return null;
}

function handleSelection() {
  const page = $m('#meeting-template-page');
  const selection = window.getSelection();
  if (!page || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!page.contains(range.commonAncestorContainer) && !range.intersectsNode(page)) return;

  const startEl = findTemplateElement(range.startContainer);
  const endEl = findTemplateElement(range.endContainer);
  if (!startEl || !endEl) return;

  // Single element selection -> field candidate
  if (startEl === endEl) {
    const text = range.toString().trim();
    if (!text) return;
    const before = document.createRange();
    before.selectNodeContents(startEl);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    showSelection({
      elementId: startEl.dataset.templateElement,
      startOffset,
      endOffset: startOffset + range.toString().length,
      expectedText: range.toString()
    });
    return;
  }

  // Multi-element selection -> Dragged across multiple blocks / elements!
  // Automatically fix the repeat boundary!
  const startLoc = parseElementLocator(startEl.dataset.templateElement);
  const endLoc = parseElementLocator(endEl.dataset.templateElement);

  // If both are in the same table and same row
  if (startLoc?.kind === 'table_paragraph' && endLoc?.kind === 'table_paragraph'
      && startLoc.tableIndex === endLoc.tableIndex && startLoc.rowIndex === endLoc.rowIndex) {
    editorState.repeat = {
      kind: 'table_row',
      tableIndex: startLoc.tableIndex,
      rowIndex: startLoc.rowIndex
    };
    window.getSelection()?.removeAllRanges();
    renderBindings();
    showMeetingNotice(`✓ Строка №${startLoc.rowIndex} таблицы зафиксирована как вопрос заседания.`);
    return;
  }

  // Otherwise, it's a block_range across body blocks
  const startChild = Number(startEl.dataset.childIndex);
  const endChild = Number(endEl.dataset.childIndex);
  if (startChild && endChild) {
    const minChild = Math.min(startChild, endChild);
    const maxChild = Math.max(startChild, endChild);
    const startBlock = editorState.analysis.blocks[minChild - 1];
    const endBlock = editorState.analysis.blocks[maxChild - 1];
    editorState.repeat = {
      kind: 'block_range',
      startChildIndex: minChild,
      endChildIndex: maxChild,
      startElementId: startBlock?.elementId || startEl.dataset.templateElement,
      endElementId: endBlock?.elementId || endEl.dataset.templateElement
    };
    window.getSelection()?.removeAllRanges();
    renderBindings();
    showMeetingNotice(`✓ Границы вопроса зафиксированы: блоки №${minChild}–${maxChild}.`);
  }
}

function selectWholeElement(target) {
  const text = target.textContent || '';
  if (!text) return;
  showSelection({ elementId: target.dataset.templateElement, startOffset: 0, endOffset: text.length, expectedText: text });
}

function assignField(field) {
  if (!field || !editorState.selection) {
    showMeetingNotice('Сначала выделите изменяемый текст.');
    return;
  }
  const candidate = { field, ...editorState.selection };
  const remaining = editorState.bindings.filter((binding) => binding.field !== field);
  const overlap = remaining.some((binding) =>
    binding.elementId === candidate.elementId
    && candidate.startOffset < binding.endOffset
    && candidate.endOffset > binding.startOffset
  );
  if (overlap) {
    showMeetingNotice('Это выделение пересекается с уже назначенным полем.');
    return;
  }
  editorState.bindings = [...remaining, candidate].sort((left, right) => left.field.localeCompare(right.field, 'ru'));
  editorState.selection = null;
  $m('#meeting-template-selection').innerHTML = '<p>Выделите текст для назначения поля или протяните мышь по блокам вопроса.</p>';
  window.getSelection()?.removeAllRanges();
  renderBindings();
}

function assignSelection() {
  const field = $m('#meeting-template-field-select')?.value || '';
  if (!field) {
    showMeetingNotice('Выберите назначение выделенного текста.');
    return;
  }
  assignField(field);
}

function makeRepeatSingleFromSelection() {
  const elementId = editorState.selection?.elementId;
  if (!elementId) {
    showMeetingNotice('Сначала выберите блок в документе.');
    return;
  }
  const block = getBlockForElement(elementId);
  if (!block || !block.childIndex) {
    showMeetingNotice('Не удалось сопоставить блок документа.');
    return;
  }
  editorState.repeat = {
    kind: 'block_range',
    startChildIndex: block.childIndex,
    endChildIndex: block.childIndex,
    startElementId: block.elementId || elementId,
    endElementId: block.elementId || elementId
  };
  editorState.selection = null;
  $m('#meeting-template-selection').innerHTML = '<p>Выделите текст для назначения поля или протяните мышь по блокам вопроса.</p>';
  renderBindings();
  showMeetingNotice(`✓ Блок №${block.childIndex} зафиксирован как вопрос заседания.`);
}

function clearRepeat() {
  editorState.repeat = null;
  renderBindings();
  showMeetingNotice('Границы вопроса сброшены.');
}

async function runAiAnalyze() {
  const button = $m('#meeting-template-ai-analyze');
  if (button) {
    button.disabled = true;
    button.textContent = '✨ Анализ…';
  }
  try {
    const response = await meetingApi(
      `/api/meeting-templates/${encodeURIComponent(editorState.versionId)}/ai-analysis?kind=${encodeURIComponent(editorState.kind)}`,
      { method: 'POST' }
    );
    if (response?.status === 'disabled') {
      showMeetingNotice(response.message || 'Локальная LLM не запущена. Используются стандартные правила разметки.');
      return;
    }
    const proposal = response?.proposal;
    if (!proposal) {
      showMeetingNotice('LLM не вернула разметку для этого шаблона.');
      return;
    }
    let appliedCount = 0;
    if (Array.isArray(proposal.bindings) && proposal.bindings.length) {
      const validElements = new Map(editorState.analysis.elements.map((el) => [el.elementId, el]));
      const newBindings = [...editorState.bindings];
      for (const candidate of proposal.bindings) {
        const el = validElements.get(candidate.elementId);
        if (!el) continue;
        const start = Number(candidate.startOffset);
        const end = Number(candidate.endOffset);
        if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= el.text.length) {
          const expected = el.text.slice(start, end);
          if (!candidate.expectedText || candidate.expectedText === expected) {
            const idx = newBindings.findIndex((b) => b.field === candidate.field);
            const entry = {
              field: candidate.field,
              elementId: candidate.elementId,
              startOffset: start,
              endOffset: end,
              expectedText: expected
            };
            if (idx >= 0) {
              newBindings[idx] = entry;
            } else {
              newBindings.push(entry);
            }
            appliedCount += 1;
          }
        }
      }
      editorState.bindings = newBindings;
    }
    if (proposal.repeatKind === 'block_range' && proposal.startChildIndex && proposal.endChildIndex) {
      editorState.repeat = {
        kind: 'block_range',
        startChildIndex: Number(proposal.startChildIndex),
        endChildIndex: Number(proposal.endChildIndex),
        startElementId: editorState.analysis.blocks[Number(proposal.startChildIndex) - 1]?.elementId || null,
        endElementId: editorState.analysis.blocks[Number(proposal.endChildIndex) - 1]?.elementId || null
      };
    } else if (proposal.repeatKind === 'table_row' && proposal.tableIndex && proposal.rowIndex) {
      editorState.repeat = {
        kind: 'table_row',
        tableIndex: Number(proposal.tableIndex),
        rowIndex: Number(proposal.rowIndex)
      };
    }
    renderBindings();
    showMeetingNotice(`✨ LLM успешно применила ${appliedCount} полей и определила структуру вопроса!`);
  } catch (error) {
    showMeetingNotice(error.message || 'Не удалось выполнить анализ структуры через LLM.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '✨ Авторазметка';
    }
  }
}

async function saveProfile() {
  const button = $m('#meeting-template-save-profile');
  if (button) button.disabled = true;
  try {
    const payload = {
      structureSha256: editorState.analysis.structureSha256,
      bindings: editorState.bindings
    };
    if (editorState.repeat) {
      payload.repeat = editorState.repeat;
    }
    const profile = await meetingApi(
      `/api/meeting-templates/${encodeURIComponent(editorState.versionId)}/profiles?kind=${encodeURIComponent(editorState.kind)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    editorState.analysis.latestProfile = profile;
    if (profile.repeat) editorState.repeat = profile.repeat;
    renderStatus(profile);
    showMeetingNotice(profile.status === 'ready'
      ? 'Профиль сохранён. Шаблон можно использовать для заседаний.'
      : 'Черновик сохранён. Назначьте оставшиеся обязательные поля.');
    if (typeof editorState.onSaved === 'function') await editorState.onSaved(profile);
  } catch (error) {
    showMeetingNotice(error.message || 'Не удалось сохранить профиль шаблона.');
  } finally {
    if (button) button.disabled = false;
  }
}

function bindEditorEvents() {
  const modal = $m('#meeting-modal');
  modal.addEventListener('mouseup', () => {
    handleSelection();
  });
  modal.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-template-element]');
    if (target && !window.getSelection()?.toString() && !event.target.closest('button, select, input, a')) {
      selectWholeElement(target);
    }
    const quick = event.target.closest?.('[data-quick-assign]');
    if (quick) assignField(quick.dataset.quickAssign);
    if (event.target.closest?.('#meeting-template-assign')) assignSelection();
    if (event.target.closest?.('#meeting-template-make-repeat-single')) makeRepeatSingleFromSelection();
    if (event.target.closest?.('#meeting-template-clear-repeat')) clearRepeat();
    if (event.target.closest?.('#meeting-template-ai-analyze')) runAiAnalyze();
    if (event.target.closest?.('#meeting-template-clear-selection')) {
      editorState.selection = null;
      window.getSelection()?.removeAllRanges();
      $m('#meeting-template-selection').innerHTML = '<p>Выделите текст для назначения поля или протяните мышь по блокам вопроса.</p>';
      renderDocument();
    }
    const remove = event.target.closest?.('[data-remove-template-binding]');
    if (remove) {
      editorState.bindings = editorState.bindings.filter((binding) => binding.field !== remove.dataset.removeTemplateBinding);
      renderBindings();
    }
    if (event.target.closest?.('#meeting-template-save-profile')) saveProfile();
    if (event.target.closest?.('[data-template-editor-back]') && typeof editorState.onBack === 'function') editorState.onBack();
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.closest?.('#meeting-template-field-select')) {
      event.preventDefault();
      assignSelection();
    }
  });
}

function editorShell(kind, title) {
  return `
    <header class="meeting-modal-head">
      <div><span>${kind === 'protocol' ? 'Шаблон протокола' : 'Шаблон выписки'}</span><h3>${escMeeting(title || 'Назначение полей DOCX')}</h3></div>
      <div class="meeting-template-head-actions">
        <button id="meeting-template-ai-analyze" type="button" class="secondary-button" title="Автоматический анализ структуры через локальную LLM">✨ Авторазметка</button>
        <button type="button" class="secondary-button" data-template-editor-back>Назад к настройкам</button>
      </div>
    </header>
    <div class="meeting-template-editor-body">
      <section class="meeting-template-workspace" aria-label="Предпросмотр DOCX">
        <div id="meeting-template-page" class="meeting-template-page"><div class="empty-state">Анализ документа…</div></div>
      </section>
      <aside class="meeting-template-inspector">
        <section id="meeting-template-status" class="meeting-template-status"><strong>Чтение структуры…</strong></section>
        <section id="meeting-template-selection" class="meeting-template-selection"><p>После загрузки выделите изменяемый текст слева.</p></section>
        <section id="meeting-template-bindings" class="meeting-template-bindings"><p>Назначения появятся здесь.</p></section>
        <div class="meeting-template-editor-actions">
          <button id="meeting-template-save-profile" type="button" class="primary-button">Сохранить профиль</button>
        </div>
      </aside>
    </div>
  `;
}

export async function openMeetingTemplateEditor({ kind, versionId, title, onBack, onSaved }) {
  ensureStyles();
  editorState = { kind, versionId, title, onBack, onSaved, analysis: null, bindings: [], selection: null, repeat: null };
  openMeetingModal(editorShell(kind, title));
  $m('#meeting-modal')?.classList.add('meeting-template-editor-modal');
  try {
    const analysis = await meetingApi(
      `/api/meeting-templates/${encodeURIComponent(versionId)}/analysis?kind=${encodeURIComponent(kind)}`
    );
    editorState.analysis = analysis;
    const seed = analysis.latestProfile?.bindings?.length ? analysis.latestProfile.bindings : analysis.suggestions || [];
    editorState.bindings = seed.map((binding) => ({
      field: binding.field,
      elementId: binding.elementId,
      startOffset: Number(binding.startOffset),
      endOffset: Number(binding.endOffset),
      expectedText: binding.expectedText
    }));
    editorState.repeat = analysis.latestProfile?.repeat || null;
    renderDocument();
    renderBindings();
    bindEditorEvents();
  } catch (error) {
    const page = $m('#meeting-template-page');
    if (page) page.innerHTML = `<div class="empty-state"><strong>Не удалось показать документ</strong><p>${escMeeting(error.message || 'Проверьте DOCX и повторите загрузку.')}</p></div>`;
    const save = $m('#meeting-template-save-profile');
    if (save) save.disabled = true;
  }
}

export async function refreshMeetingSettingsState() {
  const data = await meetingApi('/api/meeting-settings');
  meetingsState.settings = data.settings || null;
  meetingsState.resources = data.resources || { users: [], templates: [] };
  return data;
}

function templateResource(versionId) {
  return (meetingsState.resources.templates || []).find((template) => template.version_id === versionId) || null;
}

function templateProfile(template, kind) {
  return kind === 'protocol' ? template?.protocol_profile : template?.extract_profile;
}

function configureLabel(template, kind) {
  if (!template) return 'Настроить поля';
  const profile = templateProfile(template, kind);
  if (profile?.status === 'ready') return 'Поля назначены';
  if (profile) return 'Продолжить настройку';
  if (template.legacy_ready) return 'Настроить поля · необязательно';
  return 'Настроить поля';
}

function formDraft(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function restoreDraft(draft) {
  const form = $m('#meeting-settings-form');
  if (!form || !draft) return;
  for (const [name, value] of Object.entries(draft)) {
    const control = form.elements.namedItem(name);
    if (control && typeof control.value === 'string') control.value = value;
  }
  enhanceSettingsForm();
}

async function backToSettings(draft) {
  try { await refreshMeetingSettingsState(); } catch {}
  $m('#meeting-settings-button')?.click();
  requestAnimationFrame(() => restoreDraft(draft));
}

function updateConfigureButton(field, kind) {
  const select = field.querySelector('select');
  const button = field.querySelector('[data-configure-meeting-template]');
  if (!select || !button) return;
  const template = templateResource(select.value);
  const label = configureLabel(template, kind);
  if (button.textContent !== label) button.textContent = label;
  button.disabled = !select.value;
  button.classList.toggle('meeting-template-profile-ready', templateProfile(template, kind)?.status === 'ready');
}

function enhanceSettingsForm() {
  const form = $m('#meeting-settings-form');
  if (!form) return;
  const helper = form.querySelector('.meeting-helper');
  const helperText = 'Загрузите обычный DOCX, затем назначьте изменяемые поля прямо в предпросмотре. Старые шаблоны с {{AGENDA}} продолжают работать.';
  if (helper && helper.textContent !== helperText) helper.textContent = helperText;
  for (const callout of form.querySelectorAll('.meeting-callout')) {
    if (callout.textContent.includes('{{AGENDA}}')) {
      const text = 'Загрузите шаблон протокола и шаблон выписки. Для обычного DOCX после загрузки откройте «Настроить поля».';
      if (callout.textContent !== text) callout.textContent = text;
    }
  }
  for (const field of form.querySelectorAll('.meeting-template-field')) {
    const upload = field.querySelector('[data-meeting-template-upload]');
    const select = field.querySelector('select');
    const kind = upload?.dataset.meetingTemplateUpload;
    if (!kind || !select) continue;
    if (!field.querySelector('[data-configure-meeting-template]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button meeting-template-configure';
      button.dataset.configureMeetingTemplate = kind;
      upload.insertAdjacentElement('afterend', button);
      button.addEventListener('click', async () => {
        const versionId = select.value;
        if (!versionId) return showMeetingNotice('Сначала загрузите или выберите DOCX.');
        const draft = formDraft(form);
        const template = templateResource(versionId);
        await openMeetingTemplateEditor({
          kind,
          versionId,
          title: template?.original_name || 'DOCX-шаблон',
          onBack: () => backToSettings(draft),
          onSaved: async () => {
            await refreshMeetingSettingsState();
            updateConfigureButton(field, kind);
          }
        });
      });
      select.addEventListener('change', () => updateConfigureButton(field, kind));
    }
    updateConfigureButton(field, kind);
  }
}

export function installMeetingTemplateEditorEnhancer() {
  if (enhancerInstalled) return;
  enhancerInstalled = true;
  ensureStyles();
  document.addEventListener('meeting-modal-opened', enhanceSettingsForm);
  enhanceSettingsForm();
}
