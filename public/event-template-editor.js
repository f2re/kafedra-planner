import { newPlanOperationId } from './plan-upload-identity.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const clone = value => JSON.parse(JSON.stringify(value));
const types = { text: 'Текст', date: 'Дата', number: 'Число', select: 'Выбор из списка' };
const sourceLabels = { title: 'Название', date: 'Срок', responsible: 'Исполнитель', location: 'Место', activity: 'Вид деятельности', result: 'Результат', note: 'Примечание' };
const kinds = { methodological: 'Методическая работа', teaching: 'Занятия', science: 'Научная работа', organizational: 'Организационная работа', everyday: 'Повседневная работа' };
export function defaultEventDefinition() {
  return { fields: ['title', 'date', 'responsible', 'location'].map(key => ({ key, source: key, label: sourceLabels[key], type: 'text', required: ['title', 'date'].includes(key), visible: true, width: key === 'title' ? 40 : 20 })), layout: { orientation: 'portrait', showRowNumbers: true } };
}
export function templateFields(template, visibleOnly = false) {
  const fields = template?.definition?.fields || [];
  return visibleOnly ? fields.filter(field => field.visible !== false) : fields;
}
export function fieldInput(field, value, { name = '', attributes = '', required = false } = {}) {
  const attrs = `${name ? `name="${esc(name)}"` : ''} ${attributes} ${required ? 'required' : ''}`;
  if (field.type === 'select') {
    const options = field.options || [], saved = value !== '' && value !== null && value !== undefined && !options.includes(String(value));
    return `<select ${attrs}><option value="">Не выбрано</option>${saved ? `<option value="${esc(value)}" selected>${esc(value)} · сохранённое значение</option>` : ''}${options.map(option => `<option value="${esc(option)}" ${String(value ?? '') === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
  }
  return `<input ${attrs} type="${field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}" ${field.type === 'number' ? 'step="any"' : 'maxlength="4000"'} value="${esc(value)}">`;
}
export function formatEventDate(value) {
  const match = String(value || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/u);
  if (!match) return String(value || '');
  const [year, month, day] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return String(value || '');
  return `${day} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][month - 1]} ${year}`;
}
export function eventTerm(item) {
  if (item.dateText !== null && item.dateText !== undefined) return String(item.dateText);
  const start = item.startsAt ?? item.starts_at, end = item.endsAt ?? item.ends_at, due = item.dueDate ?? item.due_date, dates = [];
  if (start) dates.push(end && end !== start ? `${formatEventDate(start)} — ${formatEventDate(end)}` : formatEventDate(start));
  if (due) dates.push(`до ${formatEventDate(due)}`);
  return dates.join('; ');
}
export function fieldValue(field, item) {
  const value = item.effective || item, source = item.source || item;
  const effective = { ...source, ...value };
  const raw = field.source === 'custom' ? ((value.customValues || source.customValues || {})[field.key] ?? '') : ({
    title: value.title ?? source.title, date: eventTerm(effective), responsible: value.responsibleRaw ?? source.responsible_raw ?? source.responsible_name,
    location: value.location ?? source.location, activity: kinds[value.activityKind || source.activity_kind] || '', result: value.expectedResult ?? source.expected_result, note: value.note ?? ''
  })[field.source];
  return field.source === 'custom' && field.type === 'date' && raw ? formatEventDate(raw) : (raw ?? '');
}
export function applyPreviewColumnWidths(root) {
  for (const col of root.querySelectorAll('col[data-preview-width]')) col.style.width = `${Number(col.dataset.previewWidth)}%`;
}
export function previewTable(definition, items, { caption = '' } = {}) {
  const fields = (definition?.fields || []).filter(field => field.visible !== false), numbered = definition?.layout?.showRowNumbers !== false;
  const total = fields.reduce((sum, field) => sum + Number(field.width || 20), 0);
  return `<div class="collection-document-preview ${definition?.layout?.orientation === 'landscape' ? 'is-landscape' : ''}"><table>${caption ? `<caption>${esc(caption)}</caption>` : ''}<colgroup>${numbered ? '<col data-preview-width="5">' : ''}${fields.map(field => `<col data-preview-width="${Number(field.width || 20) / Math.max(1, total) * (numbered ? 95 : 100)}">`).join('')}</colgroup><thead><tr>${numbered ? '<th scope="col">№</th>' : ''}${fields.map(field => `<th scope="col" data-preview-field="${esc(field.key)}">${esc(field.label)}${field.required ? '<span aria-label="Обязательное поле"> *</span>' : ''}</th>`).join('')}</tr></thead><tbody>${items.length ? items.slice(0, 4).map((item, index) => `<tr>${numbered ? `<td>${index + 1}</td>` : ''}${fields.map(field => { const value = fieldValue(field, item); return `<td>${value === '' || value === null || value === undefined ? `<span class="collection-empty-cell">${field.required ? 'Нужно заполнить' : '—'}</span>` : esc(value)}</td>`; }).join('')}</tr>`).join('') : `<tr><td colspan="${fields.length + (numbered ? 1 : 0)}">Выберите мероприятия — здесь появятся их данные.</td></tr>`}</tbody></table>${items.length > 4 ? `<p class="collection-help">Показаны первые 4 из ${items.length} мероприятий.</p>` : ''}</div>`;
}

export function createEventTemplateEditor({ root, api, json, onSaved, getItems, onDirty }) {
  let identity = null, definition = defaultEventDefinition(), title = 'Шаблон мероприятий кафедры', selected = 'title', dirty = false, busy = false, externalBusy = false, pending = null;
  const markDirty = () => { dirty = true; onDirty?.(true); };
  const message = (text, error = false) => { const node = root.querySelector('[data-template-message]'); if (node) { node.textContent = text; node.setAttribute('role', error ? 'alert' : 'status'); node.classList.toggle('collection-error', error); } };
  const sync = () => {
    root.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = busy || externalBusy || node.dataset.templateLocked === 'true'; });
  };
  function renderPreview() {
    const target = root.querySelector('[data-template-live-preview]');
    if (target) { target.innerHTML = previewTable(definition, getItems(), { caption: title }); applyPreviewColumnWidths(target); }
  }
  function readInspector() {
    const field = definition.fields.find(item => item.key === selected), form = root.querySelector('[data-template-inspector]');
    if (!field || !form) return;
    const get = name => form.querySelector(`[name="${name}"]`);
    field.label = get('label').value;
    field.type = field.source === 'custom' ? get('type').value : 'text';
    field.width = Math.min(100, Math.max(5, Number(get('width').value) || 20));
    field.visible = ['title', 'date'].includes(field.source) ? true : get('visible').checked;
    field.required = ['title', 'date'].includes(field.source) ? true : field.source === 'responsible' ? false : get('required').checked;
    if (field.type === 'select') field.options = (get('options')?.value || '').split('\n').map(value => value.trim()).filter(Boolean);
    else delete field.options;
  }
  function render() {
    root.classList.remove('hidden');
    const field = definition.fields.find(item => item.key === selected) || definition.fields[0]; selected = field.key;
    const locked = ['title', 'date'].includes(field.source), typeLocked = field.source !== 'custom' || identity?.definition?.fields?.some(item => item.key === field.key);
    root.innerHTML = `<header class="collection-designer-heading"><div><h4 tabindex="-1">Поля и вид документа</h4><p class="collection-help">Настройте колонки и проверьте результат на выбранных мероприятиях.${identity ? ` Сохранена версия ${identity.version}; изменение создаст новую.` : ''}</p></div><button type="button" class="text-button" data-template-editor-action="close">Свернуть</button></header>
      <div data-template-message role="status" aria-live="polite"></div>
      <div class="collection-designer-settings"><label class="field"><span>Название шаблона</span><input data-template-name value="${esc(title)}" maxlength="200"></label><label class="field"><span>Страница</span><select data-template-orientation><option value="portrait" ${definition.layout.orientation === 'portrait' ? 'selected' : ''}>Книжная</option><option value="landscape" ${definition.layout.orientation === 'landscape' ? 'selected' : ''}>Альбомная</option></select></label><label class="check-field"><input type="checkbox" data-template-numbered ${definition.layout.showRowNumbers !== false ? 'checked' : ''}><span>Нумерация строк</span></label></div>
      <div class="collection-designer-grid"><div class="collection-field-list"><div role="list" aria-label="Колонки шаблона">${definition.fields.map((item, index) => `<div role="listitem" class="collection-field-choice ${item.key === selected ? 'is-selected' : ''}"><button type="button" data-template-editor-action="select" data-field-key="${esc(item.key)}" aria-pressed="${item.key === selected}">${index + 1}. <span data-field-label="${esc(item.key)}">${esc(item.label)}</span>${item.visible === false ? ' · скрыто' : ''}</button><div><button type="button" class="text-button" data-template-editor-action="up" data-field-key="${esc(item.key)}" aria-label="Поднять колонку ${esc(item.label)}" ${index === 0 ? 'disabled data-template-locked="true"' : ''}>↑</button><button type="button" class="text-button" data-template-editor-action="down" data-field-key="${esc(item.key)}" aria-label="Опустить колонку ${esc(item.label)}" ${index === definition.fields.length - 1 ? 'disabled data-template-locked="true"' : ''}>↓</button></div></div>`).join('')}</div><button type="button" class="secondary-button" data-template-editor-action="add" ${definition.fields.length >= 20 ? 'disabled data-template-locked="true"' : ''}>Добавить поле</button>
      <div class="collection-builtins"><label class="field"><span>Добавить стандартную колонку</span><select data-template-builtin><option value="">Выберите поле</option>${Object.entries(sourceLabels).filter(([key]) => !definition.fields.some(item => item.source === key)).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div></div>
      <div><form data-template-inspector><h5>Настройка колонки</h5><label class="field"><span>Подпись</span><input name="label" value="${esc(field.label)}" maxlength="120" required></label><label class="field"><span>Тип значения</span><select name="type" ${typeLocked ? 'disabled data-template-locked="true"' : ''}>${Object.entries(types).map(([key, label]) => `<option value="${key}" ${key === field.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>Относительная ширина</span><input name="width" type="range" min="5" max="100" value="${field.width || 20}"></label><div class="collection-field-flags"><label class="check-field"><input type="checkbox" name="visible" ${field.visible !== false ? 'checked' : ''} ${locked ? 'disabled data-template-locked="true"' : ''}><span>В документе</span></label><label class="check-field"><input type="checkbox" name="required" ${field.required ? 'checked' : ''} ${locked || field.source === 'responsible' ? 'disabled data-template-locked="true"' : ''}><span>Обязательное</span></label></div>${field.type === 'select' ? `<label class="field"><span>Варианты — каждый с новой строки</span><textarea name="options" rows="4">${esc((field.options || []).join('\n'))}</textarea></label>` : ''}<p class="collection-help">${field.source === 'custom' ? 'Значения этого поля сохраняются у мероприятия. В месячном документе их можно уточнить отдельно.' : field.source === 'responsible' ? 'Исполнитель необязателен: его отсутствие не мешает выгрузке.' : 'Поле связано с данными мероприятия. Шаблон задаёт его представление в документе.'}</p>${!locked ? '<button type="button" class="text-button" data-template-editor-action="remove">Убрать колонку</button>' : ''}</form><div data-template-live-preview></div></div></div>
      <div class="collection-plan-actions"><button type="button" class="primary-button" data-template-editor-action="save">${identity ? 'Сохранить новую версию' : 'Сохранить шаблон'}</button>${identity ? '<button type="button" class="secondary-button" data-template-editor-action="copy">Сохранить как новый шаблон</button><button type="button" class="text-button" data-template-editor-action="reload">Обновить версию</button>' : ''}<button type="button" class="text-button" data-template-editor-action="discard">Отменить изменения</button></div>`;
    renderPreview(); sync();
  }
  async function save(copy = false) {
    readInspector();
    if (!title.trim()) return message('Укажите название шаблона.', true);
    const empty = definition.fields.find(field => !field.label.trim() || (field.type === 'select' && !field.options?.length));
    if (empty) { selected = empty.key; render(); message('Укажите подпись поля и варианты выбора, если они нужны.', true); return; }
    if (busy || externalBusy) return;
    busy = true; sync(); message('Сохраняем шаблон…');
    const intended = { title: title.trim(), definition: clone(definition) };
    try {
      const request = pending || { path: identity && !copy ? `/api/event-templates/${encodeURIComponent(identity.templateId)}/versions` : '/api/event-templates', body: { ...intended, ...(identity && !copy ? { expectedVersion: identity.version } : {}), idempotencyKey: `event-template-ui:${newPlanOperationId()}` } };
      pending = request;
      let saved = await api(request.path, json('POST', request.body));
      pending = null;
      let version = saved.savedVersion || saved.currentVersion || { id: saved.currentVersionId, templateId: saved.id, version: saved.version, title: saved.title, definition: saved.definition };
      if (JSON.stringify({ title: request.body.title, definition: request.body.definition }) !== JSON.stringify(intended)) {
        pending = { path: `/api/event-templates/${encodeURIComponent(version.templateId)}/versions`, body: { ...intended, expectedVersion: version.version, idempotencyKey: `event-template-ui:${newPlanOperationId()}` } };
        saved = await api(pending.path, json('POST', pending.body)); pending = null;
        version = saved.savedVersion || saved.currentVersion || { id: saved.currentVersionId, templateId: saved.id, version: saved.version, title: saved.title, definition: saved.definition };
      }
      identity = version; definition = clone(version.definition); title = version.title; dirty = false; onDirty?.(false);
      await onSaved(saved, version); render(); message(`Шаблон сохранён · версия ${version.version}.`);
    } catch (error) { if (error.status && error.status < 500) pending = null; message(error.message, true); }
    finally { busy = false; sync(); }
  }
  root.addEventListener('submit', event => event.preventDefault());
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-template-editor-action]'); if (!button || button.disabled || busy || externalBusy) return;
    const action = button.dataset.templateEditorAction, key = button.dataset.fieldKey;
    readInspector();
    if (action === 'close') { root.classList.add('hidden'); root.dispatchEvent(new CustomEvent('template-editor-closed', { bubbles: true })); }
    else if (action === 'select') { selected = key; render(); root.querySelector('[name="label"]')?.focus(); }
    else if (action === 'add') { selected = `custom_${newPlanOperationId().replaceAll('-', '_')}`; definition.fields.push({ key: selected, source: 'custom', label: 'Новое поле', type: 'text', required: false, visible: true, width: 20 }); markDirty(); render(); root.querySelector('[name="label"]')?.select(); }
    else if (action === 'up' || action === 'down') { const index = definition.fields.findIndex(item => item.key === key), next = index + (action === 'up' ? -1 : 1); if (next < 0 || next >= definition.fields.length) return; [definition.fields[index], definition.fields[next]] = [definition.fields[next], definition.fields[index]]; selected = key; markDirty(); render(); root.querySelector(`[data-template-editor-action="select"][data-field-key="${CSS.escape(key)}"]`)?.focus(); }
    else if (action === 'remove') { if (['title', 'date'].includes(definition.fields.find(item => item.key === selected)?.source)) return; definition.fields = definition.fields.filter(item => item.key !== selected); selected = definition.fields[0].key; markDirty(); render(); }
    else if (action === 'discard') { definition = clone(identity?.definition || defaultEventDefinition()); title = identity?.title || 'Шаблон мероприятий кафедры'; selected = definition.fields[0].key; dirty = false; pending = null; onDirty?.(false); render(); message('Несохранённые настройки отменены.'); }
    else if (action === 'reload' && identity) { busy = true; sync(); api(`/api/event-templates/${encodeURIComponent(identity.templateId)}`).then(saved => { identity = saved.currentVersion; pending = null; render(); message('Текущая версия обновлена. Ваши настройки оставлены в редакторе; проверьте их перед сохранением.'); }).catch(error => message(error.message, true)).finally(() => { busy = false; sync(); }); }
    else if (action === 'save' || action === 'copy') save(action === 'copy');
  });
  root.addEventListener('input', event => {
    if (busy || externalBusy) return;
    if (event.target.matches('[data-template-name]')) title = event.target.value;
    else if (event.target.closest('[data-template-inspector]')) readInspector();
    else return;
    markDirty();
    const label = root.querySelector(`[data-field-label="${CSS.escape(selected)}"]`); if (label) label.textContent = definition.fields.find(field => field.key === selected)?.label || '';
    renderPreview();
  });
  root.addEventListener('change', event => {
    if (busy || externalBusy) return;
    let rebuild = false, focus = null;
    if (event.target.matches('[data-template-orientation]')) definition.layout.orientation = event.target.value;
    else if (event.target.matches('[data-template-numbered]')) definition.layout.showRowNumbers = event.target.checked;
    else if (event.target.matches('[data-template-builtin]')) { const source = event.target.value; if (!source || definition.fields.length >= 20) return; selected = source; definition.fields.push({ key: source, source, label: sourceLabels[source], type: 'text', required: false, visible: true, width: 20 }); rebuild = true; focus = '[name="label"]'; }
    else if (event.target.closest('[data-template-inspector]')) {
      readInspector();
      rebuild = event.target.matches('[name="type"], [name="visible"], [name="required"]');
      if (rebuild) focus = `[name="${event.target.name}"]`;
    }
    else return;
    markDirty();
    if (rebuild) { render(); root.querySelector(focus)?.focus(); }
    else {
      // Text inputs emit change on blur, before a following button click. Keep
      // that button mounted so saving or switching columns works on one click.
      const label = root.querySelector(`[data-field-label="${CSS.escape(selected)}"]`); if (label) label.textContent = definition.fields.find(field => field.key === selected)?.label || '';
      renderPreview();
    }
  });
  return {
    open(template = null) {
      if (dirty && !root.classList.contains('hidden')) { root.querySelector('h4')?.focus(); return; }
      if (!dirty) { identity = template ? { id: template.id || template.currentVersionId, templateId: template.templateId || template.id, version: template.version, title: template.title, definition: template.definition } : null; definition = clone(template?.definition || defaultEventDefinition()); title = template?.title || 'Шаблон мероприятий кафедры'; selected = definition.fields[0].key; pending = null; }
      render(); root.querySelector('h4')?.focus();
    },
    setExternalBusy(value) { externalBusy = Boolean(value); sync(); },
    isDirty: () => dirty,
    refreshPreview: renderPreview
  };
}
