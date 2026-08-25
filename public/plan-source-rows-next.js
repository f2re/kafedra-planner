const sourceRowState = {
  planId: null,
  plan: null,
  payload: null,
  selectedRowId: null,
  filter: 'attention',
  people: null,
  loadingFor: null
};

const $s = (selector, root = document) => root.querySelector(selector);
const $$s = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function ensureStyles() {
  if ($s('#plan-source-rows-styles')) return;
  const link = document.createElement('link');
  link.id = 'plan-source-rows-styles';
  link.rel = 'stylesheet';
  link.href = '/plan-source-rows-next.css';
  document.head.append(link);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Операцию не удалось выполнить.');
  return data;
}

function showNotice(message) {
  const notice = $s('#plans-notice');
  if (!notice) return;
  const text = $s('span', notice);
  if (text) text.textContent = message;
  const undo = $s('button', notice);
  if (undo) undo.classList.add('hidden');
  notice.classList.remove('hidden');
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.add('hidden'), 5500);
}

function simplifyPlansChrome() {
  const view = $s('[data-view-panel="plans"]');
  if (!view) return;
  ensureStyles();
  const copy = $s('.plans-heading p', view);
  if (copy) copy.textContent = 'Загрузите план: система разберёт таблицы и предложит задачи, сроки и ответственных. Проверять нужно только неоднозначные строки.';
  const upload = $s('#plans-upload-button', view);
  const generate = $s('#plans-generate-button', view);
  if (upload) {
    upload.classList.remove('secondary-button');
    upload.classList.add('primary-button');
    upload.textContent = 'Загрузить план';
  }
  if (generate) {
    generate.classList.remove('primary-button');
    generate.classList.add('secondary-button');
    generate.textContent = 'Сформировать DOCX';
  }

  const filterbar = $s('.plans-filterbar', view);
  if (!filterbar || $s('.plan-more-filters', filterbar)) return;
  filterbar.classList.add('plan-filterbar-simple');
  const details = document.createElement('details');
  details.className = 'plan-more-filters';
  details.innerHTML = '<summary>Фильтры</summary><div class="plan-more-filters-body"></div>';
  const search = $s('#plans-q', filterbar)?.closest('.plans-search');
  if (search) search.after(details);
  else filterbar.prepend(details);
  const body = $s('.plan-more-filters-body', details);
  ['#plans-kind', '#plans-direction', '#plans-responsible', '#plans-reset']
    .map((selector) => $s(selector, filterbar))
    .filter(Boolean)
    .forEach((node) => body.append(node));
}

function currentPlanId() {
  return $s('.plan-card.active[data-plan-id]')?.dataset.planId || null;
}

function sourceLabel(row) {
  if (row.groupKind === 'table') return `Таблица ${row.groupName || '—'} · строка ${row.rowNumber}`;
  if (row.groupKind === 'sheet') return `${row.groupName || 'Лист'} · строка ${row.rowNumber}`;
  if (row.locator?.page) return `Страница ${row.locator.page} · строка ${row.rowNumber}`;
  return `Строка ${row.rowNumber}`;
}

function dateLabel(row) {
  const item = row.suggestion || row.items?.[0] || {};
  if (item.dueDate || item.due_date) return `до ${String(item.dueDate || item.due_date).slice(0, 10)}`;
  const start = item.startsAt || item.starts_at;
  const end = item.endsAt || item.ends_at;
  if (start && end) return `${String(start).slice(0, 10)} — ${String(end).slice(0, 10)}`;
  if (start) return String(start).slice(0, 10);
  return 'срок не определён';
}

function renderSourceRowCard(row) {
  const selected = row.id === sourceRowState.selectedRowId;
  const taskCount = row.items?.length || 0;
  const state = taskCount
    ? `${taskCount} ${taskCount === 1 ? 'задача' : taskCount < 5 ? 'задачи' : 'задач'}`
    : row.attention ? 'Нужно проверить' : 'Распознано';
  const cells = (row.cells || []).slice(0, 4).map((cell) => `<span>${esc(cell.text)}</span>`).join('');
  return `
    <button type="button" class="plan-source-row ${selected ? 'active' : ''} ${row.attention ? 'attention' : ''}"
      data-plan-source-row="${esc(row.id)}">
      <span class="plan-source-row-meta">${esc(sourceLabel(row))}</span>
      <strong>${esc(row.suggestion?.title || row.items?.[0]?.title || row.rawText)}</strong>
      <span class="plan-source-cell-preview">${cells}</span>
      <span class="plan-source-row-foot"><span>${esc(dateLabel(row))}</span><b>${esc(state)}</b></span>
    </button>`;
}

function visibleRows() {
  const rows = (sourceRowState.payload?.items || []).filter((row) => row.role !== 'header');
  if (sourceRowState.filter !== 'attention') return rows;
  const attention = rows.filter((row) => row.attention);
  return attention.length ? attention : rows;
}

function renderWorkbench() {
  const detail = $s('#plan-detail');
  if (!detail || !sourceRowState.plan?.source_document_id) return;
  let root = $s('#plan-source-workbench', detail);
  if (!root) {
    root = document.createElement('section');
    root.id = 'plan-source-workbench';
    root.className = 'plan-source-workbench';
    const table = $s('.plan-items-table-wrap', detail);
    if (table) table.before(root);
    else detail.append(root);
  }
  const summary = sourceRowState.payload?.summary || { rows: 0, attention: 0, materialized: 0 };
  const rows = visibleRows();
  const filterAttention = sourceRowState.filter === 'attention';
  root.innerHTML = `
    <header class="plan-source-head">
      <div><span>Исходный документ</span><h4>Разобрать строки плана</h4><p>Система уже подставила то, что смогла определить. Выберите строку, чтобы проверить её или разделить на несколько задач.</p></div>
      <div class="plan-source-summary"><b>${summary.rows}</b> строк · <b>${summary.attention}</b> проверить · <b>${summary.materialized}</b> связаны с задачами</div>
    </header>
    <div class="plan-source-toolbar" role="group" aria-label="Строки плана">
      <button type="button" class="${filterAttention ? 'active' : ''}" data-plan-source-filter="attention">Требуют проверки${summary.attention ? ` · ${summary.attention}` : ''}</button>
      <button type="button" class="${!filterAttention ? 'active' : ''}" data-plan-source-filter="all">Все строки · ${summary.rows}</button>
    </div>
    <div class="plan-source-layout">
      <div class="plan-source-list">
        ${rows.length ? rows.map(renderSourceRowCard).join('') : '<div class="empty-state">В документе нет строк для разбора.</div>'}
      </div>
      <div id="plan-source-editor" class="plan-source-editor">
        ${sourceRowState.selectedRowId ? '<div class="empty-state">Открываем строку…</div>' : '<div class="plan-source-editor-empty"><strong>Выберите строку слева</strong><span>Поля, которые удалось определить, будут уже заполнены.</span></div>'}
      </div>
    </div>`;
  if (sourceRowState.selectedRowId) renderEditor();

  const flat = $s('.plan-items-table-wrap', detail);
  if (flat && !$s('.plan-created-tasks-head', detail)) {
    flat.insertAdjacentHTML('beforebegin', '<div class="plan-created-tasks-head"><strong>Созданные задачи</strong><span>Итог после разбора документа. Их можно исправлять и дальше.</span></div>');
  }
}

async function loadPeople() {
  if (sourceRowState.people) return sourceRowState.people;
  const data = await api('/api/people');
  sourceRowState.people = (data.items || []).filter((person) => person.status !== 'inactive');
  return sourceRowState.people;
}

function exactPersonId(name) {
  const target = String(name || '').trim().toLocaleLowerCase('ru-RU');
  return sourceRowState.people?.find((person) => String(person.display_name || '').trim().toLocaleLowerCase('ru-RU') === target)?.id || '';
}

function fullItem(linked) {
  if (!linked?.id) return null;
  return sourceRowState.plan?.items?.find((item) => item.id === linked.id) || linked;
}

function seedTasks(row) {
  if (row.items?.length) return row.items.map((linked) => {
    const item = fullItem(linked);
    const assignment = item?.assignment || null;
    return {
      title: item?.title || '', description: item?.description || '',
      startsAt: item?.starts_at || '', endsAt: item?.ends_at || '', dueDate: item?.due_date || '',
      direction: item?.direction || 'organizational', expectedResult: item?.expected_result || '',
      responsibleRaw: item?.responsible_name || item?.responsible_raw || '',
      responsiblePersonId: item?.responsible_person_id || '', executionMode: item?.execution_mode || 'track',
      executorPersonIds: (assignment?.executors || []).filter((executor) => ['executor','coexecutor'].includes(executor.role)).map((executor) => executor.person_id).filter(Boolean),
      controllerPersonId: assignment?.executors?.find((executor) => executor.role === 'controller')?.person_id || ''
    };
  });
  const suggestion = row.suggestion || {};
  let title = suggestion.title || '';
  if (!title) {
    const candidates = (row.cells || []).map((cell) => String(cell.text || '').trim()).filter((text) => text.length > 3);
    title = candidates.sort((a, b) => b.length - a.length)[0] || row.rawText || '';
  }
  const responsibleRaw = suggestion.responsibleRaw || '';
  const responsiblePersonId = exactPersonId(responsibleRaw);
  return [{
    title, description: '', startsAt: suggestion.startsAt || '', endsAt: suggestion.endsAt || '',
    dueDate: suggestion.dueDate || '', direction: suggestion.direction || 'organizational',
    expectedResult: suggestion.expectedResult || '', responsibleRaw, responsiblePersonId,
    executionMode: 'track', executorPersonIds: responsiblePersonId ? [responsiblePersonId] : [], controllerPersonId: ''
  }];
}

function personOptions(selected = '', empty = 'Не выбран') {
  return `<option value="">${esc(empty)}</option>` + (sourceRowState.people || []).map((person) =>
    `<option value="${esc(person.id)}" ${person.id === selected ? 'selected' : ''}>${esc(person.display_name)}</option>`
  ).join('');
}

function executorChecks(selectedIds = []) {
  const selected = new Set(selectedIds || []);
  return (sourceRowState.people || []).map((person) => `
    <label class="plan-source-person"><input type="checkbox" name="executor" value="${esc(person.id)}" ${selected.has(person.id) ? 'checked' : ''}><span>${esc(person.display_name)}</span></label>
  `).join('') || '<span class="plans-helper">В справочнике пока нет сотрудников.</span>';
}

function taskCard(task, index) {
  const mode = task.executionMode || 'track';
  return `
    <section class="plan-source-task" data-source-task="${index}">
      <header><strong>Задача ${index + 1}</strong>${index ? `<button type="button" class="text-button" data-source-task-remove="${index}">Убрать</button>` : ''}</header>
      <label class="field full"><span>Что сделать</span><input name="title" value="${esc(task.title)}" required></label>
      <div class="plan-source-three">
        <label class="field"><span>Начало</span><input name="startsAt" type="date" value="${esc(task.startsAt)}"></label>
        <label class="field"><span>Окончание</span><input name="endsAt" type="date" value="${esc(task.endsAt)}"></label>
        <label class="field"><span>Контрольный срок</span><input name="dueDate" type="date" value="${esc(task.dueDate)}"></label>
      </div>
      <div class="plan-source-two">
        <label class="field"><span>Направление</span><select name="direction">
          ${[['organizational','Организация'],['education','Образование'],['science','Наука'],['everyday','Повседневная']].map(([value,label]) => `<option value="${value}" ${task.direction === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="field"><span>Как учитывать</span><select name="executionMode" data-source-mode>
          <option value="track" ${mode === 'track' ? 'selected' : ''}>Событие / контроль</option>
          <option value="assigned" ${mode === 'assigned' ? 'selected' : ''}>Поручение</option>
          <option value="open" ${mode === 'open' ? 'selected' : ''}>Открытая задача</option>
        </select></label>
      </div>
      <label class="field"><span>Ответственный из документа</span><input name="responsibleRaw" list="plan-source-people" value="${esc(task.responsibleRaw)}" placeholder="Можно оставить как в документе"></label>
      <label class="field"><span>Ожидаемый результат</span><input name="expectedResult" value="${esc(task.expectedResult)}" placeholder="Отчёт, протокол, материалы…"></label>
      <label class="field"><span>Комментарий</span><textarea name="description" rows="2" placeholder="То, что важно сохранить вместе с задачей">${esc(task.description)}</textarea></label>
      <section class="plan-source-assignment ${mode === 'track' ? 'hidden' : ''}" data-source-assignment>
        <div><strong>Исполнители</strong><span>${mode === 'open' ? 'можно не выбирать — задачу смогут взять в работу' : 'можно выбрать нескольких'}</span></div>
        <div class="plan-source-people">${executorChecks(task.executorPersonIds)}</div>
        <label class="field"><span>Контролирует</span><select name="controllerPersonId">${personOptions(task.controllerPersonId, 'Определить по создателю')}</select></label>
      </section>
    </section>`;
}

function rawCells(row) {
  return (row.cells || []).map((cell) => `<div><span>${cell.label || (cell.column ? `Колонка ${cell.column}` : 'Поле')}</span><strong>${esc(cell.text)}</strong></div>`).join('');
}

async function renderEditor() {
  const editor = $s('#plan-source-editor');
  if (!editor) return;
  const row = sourceRowState.payload?.items?.find((item) => item.id === sourceRowState.selectedRowId);
  if (!row) {
    sourceRowState.selectedRowId = null;
    editor.innerHTML = '<div class="plan-source-editor-empty"><strong>Выберите строку слева</strong></div>';
    return;
  }
  try {
    await loadPeople();
  } catch {
    sourceRowState.people = [];
  }
  if (!$s('#plan-source-editor') || sourceRowState.selectedRowId !== row.id) return;
  const tasks = seedTasks(row);
  editor.innerHTML = `
    <form id="plan-source-form" data-source-row-id="${esc(row.id)}">
      <div class="plan-source-editor-head">
        <div><span>${esc(sourceLabel(row))}</span><h5>Проверить и сохранить</h5></div>
        <button type="button" class="icon-button" data-source-editor-close aria-label="Закрыть">×</button>
      </div>
      <details class="plan-source-original"><summary>Что написано в документе</summary><div>${rawCells(row)}</div></details>
      <datalist id="plan-source-people">${(sourceRowState.people || []).map((person) => `<option value="${esc(person.display_name)}"></option>`).join('')}</datalist>
      <div id="plan-source-task-list">${tasks.map(taskCard).join('')}</div>
      <button type="button" class="secondary-button plan-source-split" data-source-task-add>Разделить на ещё одну задачу</button>
      ${(row.unmapped || []).length ? `<label class="check-field plan-source-keep"><input name="keepUnmapped" type="checkbox" checked><span>Сохранить нераспознанные ячейки в комментарии</span></label>` : ''}
      <div class="plan-source-actions"><span>Исходная строка и доказательства останутся в истории.</span><button type="submit" class="primary-button">Сохранить задачи</button></div>
    </form>`;
}

function collectTask(card, keepUnmappedInComment) {
  const responsibleRaw = $s('[name="responsibleRaw"]', card)?.value.trim() || '';
  const executionMode = $s('[name="executionMode"]', card)?.value || 'track';
  let executorPersonIds = $$s('[name="executor"]:checked', card).map((input) => input.value).filter(Boolean);
  const responsiblePersonId = exactPersonId(responsibleRaw);
  if (executionMode === 'assigned' && !executorPersonIds.length && responsiblePersonId) executorPersonIds = [responsiblePersonId];
  return {
    title: $s('[name="title"]', card)?.value.trim() || '',
    startsAt: $s('[name="startsAt"]', card)?.value || null,
    endsAt: $s('[name="endsAt"]', card)?.value || null,
    dueDate: $s('[name="dueDate"]', card)?.value || null,
    direction: $s('[name="direction"]', card)?.value || 'organizational',
    responsibleRaw: responsibleRaw || null,
    responsiblePersonId: responsiblePersonId || null,
    expectedResult: $s('[name="expectedResult"]', card)?.value.trim() || null,
    description: $s('[name="description"]', card)?.value.trim() || null,
    executionMode,
    executorPersonIds,
    controllerPersonId: $s('[name="controllerPersonId"]', card)?.value || null,
    keepUnmappedInComment
  };
}

async function saveSourceRow(form) {
  const button = $s('button[type="submit"]', form);
  const sourceRowId = form.dataset.sourceRowId;
  const keepUnmappedInComment = $s('[name="keepUnmapped"]', form)?.checked !== false;
  const tasks = $$s('[data-source-task]', form).map((card) => collectTask(card, keepUnmappedInComment));
  if (!tasks.length || tasks.some((task) => !task.title)) {
    showNotice('У каждой задачи должно быть название.');
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = 'Сохраняем…';
  }
  try {
    const result = await api(`/api/plans/${encodeURIComponent(sourceRowState.planId)}/source-rows/${encodeURIComponent(sourceRowId)}/materialize`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tasks })
    });
    sourceRowState.plan = result.plan;
    sourceRowState.payload = result.sourceRows;
    sourceRowState.selectedRowId = sourceRowId;
    renderWorkbench();
    const retained = result.retainedItemIds?.length || 0;
    showNotice(retained
      ? 'Задачи сохранены. Ранее созданные дополнительные задачи не удалены.'
      : `Сохранено задач: ${result.savedItemIds?.length || tasks.length}. Календарь и поручения обновлены.`);
    if (typeof window.kafedraOpenPlan === 'function') setTimeout(() => window.kafedraOpenPlan(sourceRowState.planId), 60);
  } catch (error) {
    showNotice(error?.message || 'Не удалось сохранить разбор строки. Данные в форме не удалены.');
    if (button) {
      button.disabled = false;
      button.textContent = 'Сохранить задачи';
    }
  }
}

function cloneLastTask() {
  const list = $s('#plan-source-task-list');
  if (!list) return;
  const cards = $$s('[data-source-task]', list);
  const last = cards.at(-1);
  if (!last) return;
  const keep = $s('#plan-source-form [name="keepUnmapped"]')?.checked !== false;
  const task = collectTask(last, keep);
  task.executionMode = 'track';
  task.executorPersonIds = [];
  task.controllerPersonId = '';
  list.insertAdjacentHTML('beforeend', taskCard(task, cards.length));
  $s(`[data-source-task="${cards.length}"] [name="title"]`, list)?.focus();
}

async function loadForCurrentPlan() {
  simplifyPlansChrome();
  const planId = currentPlanId();
  const detail = $s('#plan-detail');
  if (!planId || !detail || !$s('.plan-detail-head', detail)) return;
  if (sourceRowState.loadingFor === planId) return;
  if (sourceRowState.planId === planId && $s('#plan-source-workbench', detail)) return;
  sourceRowState.loadingFor = planId;
  try {
    const plan = await api(`/api/plans/${encodeURIComponent(planId)}`);
    if (currentPlanId() !== planId) return;
    sourceRowState.planId = planId;
    sourceRowState.plan = plan;
    sourceRowState.selectedRowId = null;
    if (!plan.source_document_id) return;
    const payload = await api(`/api/plans/${encodeURIComponent(planId)}/source-rows`);
    if (currentPlanId() !== planId) return;
    sourceRowState.payload = payload;
    sourceRowState.filter = payload.summary?.attention ? 'attention' : 'all';
    renderWorkbench();
  } catch (error) {
    if (currentPlanId() === planId && $s('.plan-detail-head', detail)) {
      let root = $s('#plan-source-workbench', detail);
      if (!root) {
        root = document.createElement('section');
        root.id = 'plan-source-workbench';
        root.className = 'plan-source-workbench';
        $s('.plan-items-table-wrap', detail)?.before(root);
      }
      if (root) root.innerHTML = `<div class="plan-source-load-error"><strong>Не удалось открыть строки исходного плана.</strong><span>${esc(error.message)}</span><button type="button" class="secondary-button" data-source-retry>Повторить</button></div>`;
    }
  } finally {
    if (sourceRowState.loadingFor === planId) sourceRowState.loadingFor = null;
  }
}

document.addEventListener('click', (event) => {
  const rowButton = event.target.closest('[data-plan-source-row]');
  if (rowButton) {
    sourceRowState.selectedRowId = rowButton.dataset.planSourceRow;
    renderWorkbench();
    return;
  }
  const filter = event.target.closest('[data-plan-source-filter]');
  if (filter) {
    sourceRowState.filter = filter.dataset.planSourceFilter;
    renderWorkbench();
    return;
  }
  if (event.target.closest('[data-source-editor-close]')) {
    sourceRowState.selectedRowId = null;
    renderWorkbench();
    return;
  }
  if (event.target.closest('[data-source-task-add]')) {
    cloneLastTask();
    return;
  }
  const remove = event.target.closest('[data-source-task-remove]');
  if (remove) {
    const card = remove.closest('[data-source-task]');
    card?.remove();
    $$s('#plan-source-task-list [data-source-task]').forEach((item, index) => {
      item.dataset.sourceTask = String(index);
      const label = $s('header strong', item);
      if (label) label.textContent = `Задача ${index + 1}`;
    });
    return;
  }
  if (event.target.closest('[data-source-retry]')) {
    sourceRowState.planId = null;
    loadForCurrentPlan();
  }
}, true);

document.addEventListener('change', (event) => {
  const mode = event.target.closest('[data-source-mode]');
  if (!mode) return;
  const card = mode.closest('[data-source-task]');
  const assignment = $s('[data-source-assignment]', card);
  assignment?.classList.toggle('hidden', mode.value === 'track');
  const copy = $s('[data-source-assignment] > div > span', card);
  if (copy) copy.textContent = mode.value === 'open'
    ? 'можно не выбирать — задачу смогут взять в работу'
    : 'можно выбрать нескольких';
}, true);

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'plan-source-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  saveSourceRow(event.target);
}, true);

ensureStyles();
simplifyPlansChrome();
const observer = new MutationObserver(() => {
  simplifyPlansChrome();
  queueMicrotask(loadForCurrentPlan);
});
observer.observe(document.body, { childList: true, subtree: true });
queueMicrotask(loadForCurrentPlan);
