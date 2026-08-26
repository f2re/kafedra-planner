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

function safeColor(value) {
  return /^#[0-9A-F]{6}$/iu.test(String(value || '')) ? String(value) : null;
}

function safeFont(value) {
  const text = String(value || '').trim();
  return text && /^[\p{L}\p{N} .,_-]{1,80}$/u.test(text) ? text : null;
}

function paragraphStyle(style = {}) {
  const declarations = [];
  const alignment = style.alignment === 'both' ? 'justify' : style.alignment;
  if (['left', 'center', 'right', 'justify'].includes(alignment)) declarations.push(`text-align:${alignment}`);
  const values = [
    ['margin-left', safeNumber(style.marginLeftPt)],
    ['margin-right', safeNumber(style.marginRightPt)],
    ['padding-top', safeNumber(style.spaceBeforePt, 0)],
    ['margin-bottom', safeNumber(style.spaceAfterPt, 0)]
  ];
  for (const [name, value] of values) if (value !== null) declarations.push(`${name}:${value}pt`);
  const firstLine = safeNumber(style.firstLinePt);
  const hanging = safeNumber(style.hangingPt);
  if (firstLine !== null) declarations.push(`text-indent:${firstLine}pt`);
  else if (hanging !== null) declarations.push(`text-indent:${-hanging}pt`);
  const line = safeNumber(style.linePt, 0);
  if (line !== null && line > 0) declarations.push(`line-height:${line}pt`);
  return declarations.join(';');
}

function runHtml(run) {
  const style = run.style || {};
  const classes = ['meeting-template-run'];
  if (style.bold) classes.push('is-bold');
  if (style.italic) classes.push('is-italic');
  if (style.underline) classes.push('is-underline');
  if (style.strike) classes.push('is-strike');
  const declarations = [];
  const fontSize = safeNumber(style.fontSizePt, 5, 96);
  const fontFamily = safeFont(style.fontFamily);
  const color = safeColor(style.color);
  const background = safeColor(style.backgroundColor);
  if (fontSize !== null) declarations.push(`font-size:${fontSize}pt`);
  if (fontFamily) declarations.push(`font-family:'${fontFamily.replaceAll("'", '')}'`);
  if (color) declarations.push(`color:${color}`);
  if (background) declarations.push(`background:${background}`);
  return `<span class="${classes.join(' ')}"${declarations.length ? ` style="${declarations.join(';')}"` : ''}>${escMeeting(run.text)}</span>`;
}

function elementHtml(element) {
  const runs = (element.runs || []).map(runHtml).join('') || escMeeting(element.text || ' ');
  return `<p class="meeting-template-element" data-template-element="${escMeeting(element.elementId)}" style="${paragraphStyle(element.style)}">${runs}</p>`;
}

function tableHtml(block) {
  return `<table class="meeting-template-table"><tbody>${(block.rows || []).map((row) =>
    `<tr>${(row.cells || []).map((cell) => {
      const declarations = [];
      const width = safeNumber(cell.widthPt, 0, 5000);
      const background = safeColor(cell.backgroundColor);
      if (width !== null) declarations.push(`width:${width}pt`);
      if (background) declarations.push(`background:${background}`);
      const span = Number.isInteger(Number(cell.columnSpan)) && Number(cell.columnSpan) > 1
        ? ` colspan="${Number(cell.columnSpan)}"` : '';
      return `<td${span}${declarations.length ? ` style="${declarations.join(';')}"` : ''}>${(cell.paragraphs || []).map(elementHtml).join('')}</td>`;
    }).join('')}</tr>`
  ).join('')}</tbody></table>`;
}

function fieldLabel(key) {
  return editorState?.analysis?.fields?.find((field) => field.key === key)?.label || key;
}

function renderDocument() {
  const page = $m('#meeting-template-page');
  if (!page || !editorState?.analysis) return;
  page.innerHTML = editorState.analysis.blocks.map((block) =>
    block.kind === 'table' ? tableHtml(block) : elementHtml(block)
  ).join('');
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
  const agendaFields = new Set((editorState.analysis.fields || [])
    .filter((field) => field.scope === 'agenda').map((field) => field.key));
  const ids = editorState.bindings.filter((binding) => agendaFields.has(binding.field)).map((binding) => binding.elementId);
  if (!ids.length) return 'Повторяемый вопрос ещё не определён.';
  const table = ids.map((id) => /#table:(\d+)\/row:(\d+)\//u.exec(id));
  if (table.every(Boolean) && table.every((match) => match[1] === table[0][1] && match[2] === table[0][2])) {
    return `Будет повторяться строка ${table[0][2]} таблицы ${table[0][1]}.`;
  }
  const paragraphs = ids.map((id) => /#body\/p:(\d+)$/u.exec(id));
  if (paragraphs.every(Boolean)) {
    const values = paragraphs.map((match) => Number(match[1]));
    return `Будут повторяться абзацы ${Math.min(...values)}–${Math.max(...values)}.`;
  }
  return 'Поля вопроса находятся в несовместимых частях документа.';
}

function renderStatus(profile = null) {
  const target = $m('#meeting-template-status');
  if (!target || !editorState) return;
  const state = requiredState();
  const percent = state.required.length ? Math.round((state.ready / state.required.length) * 100) : 100;
  const status = profile?.status || editorState.analysis.latestProfile?.status || (state.missing.length ? 'draft' : 'ready');
  target.innerHTML = `
    <strong>${status === 'ready' ? 'Шаблон готов' : `Назначено ${state.ready} из ${state.required.length} обязательных полей`}</strong>
    <div class="meeting-template-progress"><span style="width:${percent}%"></span></div>
    <span>${state.missing.length ? `Осталось: ${state.missing.map((field) => escMeeting(field.label)).join(', ')}` : escMeeting(inferredRepeat())}</span>
    ${editorState.analysis.legacyReady ? '<div class="meeting-template-legacy-note">Это совместимый старый шаблон с {{AGENDA}}. Его можно использовать без профиля или постепенно разметить визуально.</div>' : ''}
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

function showSelection(selection) {
  editorState.selection = selection;
  for (const element of document.querySelectorAll('[data-template-element]')) {
    element.classList.toggle('is-selected', element.dataset.templateElement === selection.elementId);
  }
  const target = $m('#meeting-template-selection');
  target.innerHTML = `
    <strong>Что находится в выделенном месте?</strong>
    <blockquote>${escMeeting(selection.expectedText)}</blockquote>
    <select id="meeting-template-field-select" aria-label="Назначение выделенного текста">
      <option value="">Выберите поле</option>${fieldOptions()}
    </select>
    <div class="meeting-template-selection-actions">
      <button id="meeting-template-assign" type="button" class="primary-button">Назначить поле</button>
      <button id="meeting-template-clear-selection" type="button" class="secondary-button">Снять</button>
    </div>
  `;
}

function selectionInside(target) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) return null;
  const selectedText = range.toString();
  if (!selectedText) return null;
  const before = document.createRange();
  before.selectNodeContents(target);
  before.setEnd(range.startContainer, range.startOffset);
  const startOffset = before.toString().length;
  return {
    elementId: target.dataset.templateElement,
    startOffset,
    endOffset: startOffset + selectedText.length,
    expectedText: selectedText
  };
}

function selectWholeElement(target) {
  const text = target.textContent || '';
  if (!text) return;
  showSelection({ elementId: target.dataset.templateElement, startOffset: 0, endOffset: text.length, expectedText: text });
}

function assignSelection() {
  const field = $m('#meeting-template-field-select')?.value || '';
  if (!field || !editorState.selection) {
    showMeetingNotice('Выберите назначение выделенного текста.');
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
  $m('#meeting-template-selection').innerHTML = '<p>Выделите текст или щёлкните по абзацу, затем назначьте поле.</p>';
  window.getSelection()?.removeAllRanges();
  renderBindings();
}

async function saveProfile() {
  const button = $m('#meeting-template-save-profile');
  if (button) button.disabled = true;
  try {
    const profile = await meetingApi(
      `/api/meeting-templates/${encodeURIComponent(editorState.versionId)}/profiles?kind=${encodeURIComponent(editorState.kind)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ structureSha256: editorState.analysis.structureSha256, bindings: editorState.bindings })
      }
    );
    editorState.analysis.latestProfile = profile;
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
  modal.addEventListener('mouseup', (event) => {
    const target = event.target.closest?.('[data-template-element]');
    if (!target) return;
    const selection = selectionInside(target);
    if (selection) showSelection(selection);
  });
  modal.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-template-element]');
    if (target && !window.getSelection()?.toString()) selectWholeElement(target);
    if (event.target.closest?.('#meeting-template-assign')) assignSelection();
    if (event.target.closest?.('#meeting-template-clear-selection')) {
      editorState.selection = null;
      window.getSelection()?.removeAllRanges();
      $m('#meeting-template-selection').innerHTML = '<p>Выделите текст или щёлкните по абзацу, затем назначьте поле.</p>';
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
}

function editorShell(kind, title) {
  return `
    <header class="meeting-modal-head">
      <div><span>${kind === 'protocol' ? 'Шаблон протокола' : 'Шаблон выписки'}</span><h3>${escMeeting(title || 'Назначение полей DOCX')}</h3></div>
      <button type="button" class="secondary-button" data-template-editor-back>Назад к настройкам</button>
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
  editorState = { kind, versionId, title, onBack, onSaved, analysis: null, bindings: [], selection: null };
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

function templateResource(kind, versionId) {
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
  const template = templateResource(kind, select.value);
  button.textContent = configureLabel(template, kind);
  button.disabled = !select.value;
  button.classList.toggle('meeting-template-profile-ready', templateProfile(template, kind)?.status === 'ready');
}

function enhanceSettingsForm() {
  const form = $m('#meeting-settings-form');
  if (!form) return;
  const helper = form.querySelector('.meeting-helper');
  if (helper) {
    helper.textContent = 'Загрузите обычный DOCX, затем назначьте изменяемые поля прямо в предпросмотре. Старые шаблоны с {{AGENDA}} продолжают работать.';
  }
  for (const callout of form.querySelectorAll('.meeting-callout')) {
    if (callout.textContent.includes('{{AGENDA}}')) {
      callout.textContent = 'Загрузите шаблон протокола и шаблон выписки. Для обычного DOCX после загрузки откройте «Настроить поля».';
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
        const template = templateResource(kind, versionId);
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
  const observer = new MutationObserver(() => enhanceSettingsForm());
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('meeting-modal-opened', () => enhanceSettingsForm());
  enhanceSettingsForm();
}
