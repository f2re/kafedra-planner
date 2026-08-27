const standaloneAssignmentState = {
  assignmentId: null,
  assignment: null,
  documents: []
};

const $sa = (selector, root = document) => root.querySelector(selector);

function escapeStandalone(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function standaloneApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureStandaloneStyles() {
  if ($sa('#standalone-assignment-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'standalone-assignment-next-styles';
  link.rel = 'stylesheet';
  link.href = '/standalone-assignment-next.css';
  document.head.append(link);
}

function assignmentStatus(value) {
  return {
    open: 'В работе',
    submitted: 'В работе · материал приложен',
    rework: 'В работе',
    returned: 'В работе',
    completed: 'Выполнено',
    cancelled: 'Отменено'
  }[value] || value || 'Состояние не указано';
}

function dateLabel(value) {
  if (!value) return 'не указана';
  const date = new Date(`${String(value).slice(0, 10)}T09:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function executorSummary(assignment) {
  const rows = assignment.executors || [];
  const executors = rows
    .filter((item) => ['executor', 'coexecutor'].includes(item.role))
    .map((item) => item.display_name || item.executor_raw)
    .filter(Boolean);
  const controller = rows.find((item) => item.role === 'controller');
  return {
    executors: executors.length ? executors.join(', ') : 'не назначены',
    controller: controller?.display_name || controller?.executor_raw || 'не назначен'
  };
}

function documentOptions(documents) {
  return [
    '<option value="">Выберите ранее загруженный документ</option>',
    ...documents.map((item) => `<option value="${escapeStandalone(item.id)}">${escapeStandalone(item.title || item.original_name)}</option>`)
  ].join('');
}

function updateHistory(assignment) {
  if (!(assignment.updates || []).length) {
    return '<div class="standalone-empty">Отметок пока нет.</div>';
  }
  return `<ol class="standalone-history">${assignment.updates.map((item) => `
    <li>
      <div><strong>${escapeStandalone(assignmentStatus(item.status))}</strong><span>${escapeStandalone(item.actor_name || 'Сотрудник')}</span></div>
      <div><span>${item.progress_percent === null || item.progress_percent === undefined ? 'Готовность не указана' : `${Number(item.progress_percent)}%`}</span><time>${escapeStandalone(String(item.created_at || '').replace('T', ' ').replace('Z', ' UTC'))}</time></div>
      ${item.note ? `<p>${escapeStandalone(item.note)}</p>` : ''}
    </li>`).join('')}</ol>`;
}

function evidenceHistory(assignment) {
  if (!(assignment.reports || []).length) {
    return '<div class="standalone-empty">Подтверждающие материалы не приложены. Это не мешает завершить задачу.</div>';
  }
  return `<div class="standalone-reports">${assignment.reports.map((item) => `
    <a href="/api/documents/${encodeURIComponent(item.document_id)}/content?variant=original" target="_blank" rel="noopener">
      <span><strong>${escapeStandalone(item.document_title || item.original_name || 'Материал')}</strong><small>${escapeStandalone(item.note || 'Подтверждающий материал')}</small></span>
      <span aria-hidden="true">↗</span>
    </a>`).join('')}</div>`;
}

function planSource(assignment) {
  const evidence = assignment.evidence || {};
  return {
    planId: evidence.planId || null,
    planItemId: evidence.planItemId || null
  };
}

function progressActions(assignment) {
  if (assignment.status === 'cancelled') {
    return '<span class="standalone-muted">Отменённую задачу нельзя изменять.</span>';
  }
  if (assignment.status === 'completed') {
    return '<button class="secondary-button" name="action" value="reopen" type="submit">Вернуть в работу</button>';
  }
  return `
    <button class="primary-button" name="action" value="complete" type="submit">Выполнено</button>
    <button class="quiet-button" name="action" value="note" type="submit">Сохранить заметку</button>`;
}

function renderStandaloneAssignment(assignment, documents, message = '') {
  const inspector = $sa('#ux-inspector');
  const body = $sa('#ux-inspector-body');
  const actions = $sa('#ux-inspector-actions');
  if (!inspector || !body || !actions) return;
  const names = executorSummary(assignment);
  const source = planSource(assignment);
  const latestProgress = assignment.updates?.find((item) => item.progress_percent !== null && item.progress_percent !== undefined)?.progress_percent
    ?? (assignment.status === 'completed' ? 100 : 0);
  const evidenceLocked = assignment.status === 'cancelled';

  body.innerHTML = `<div id="standalone-assignment-inspector" class="standalone-assignment" data-assignment-id="${escapeStandalone(assignment.id)}">
    <section class="inspector-section standalone-assignment-summary">
      <div class="eyebrow">Задача из плана</div>
      <h2>${escapeStandalone(assignment.title)}</h2>
      <p>${escapeStandalone(assignment.instruction_text || assignment.title)}</p>
      <dl class="standalone-facts">
        <div><dt>Состояние</dt><dd>${escapeStandalone(assignmentStatus(assignment.status))}</dd></div>
        <div><dt>Начало</dt><dd>${escapeStandalone(dateLabel(assignment.starts_at))}</dd></div>
        <div><dt>Срок</dt><dd>${escapeStandalone(dateLabel(assignment.due_date))}</dd></div>
        <div><dt>Исполнители</dt><dd>${escapeStandalone(names.executors)}</dd></div>
        <div><dt>Координатор</dt><dd>${escapeStandalone(names.controller)}</dd></div>
        <div><dt>Результат</dt><dd>${escapeStandalone(assignment.expected_result || 'не указан')}</dd></div>
      </dl>
      ${message ? `<div class="standalone-success" role="status">${escapeStandalone(message)}</div>` : ''}
    </section>

    <article class="work-assignment standalone-work-assignment" data-assignment-id="${escapeStandalone(assignment.id)}">
      <header><strong>Выполнение</strong><span>${escapeStandalone(dateLabel(assignment.due_date))}</span></header>
      <div class="work-executors">Ответственный: ${escapeStandalone(names.executors)} · ${escapeStandalone(assignmentStatus(assignment.status))}</div>

      <section class="standalone-section">
        <div class="standalone-section-head"><div><strong>Состояние задачи</strong><span>Для завершения достаточно одного действия. Согласование не требуется.</span></div></div>
        <form data-standalone-progress-form data-assignment-id="${escapeStandalone(assignment.id)}">
          <div class="standalone-form-grid">
            <label class="field"><span>Готовность, %</span><input name="progressPercent" type="number" min="0" max="100" value="${Number(latestProgress)}" ${assignment.status === 'cancelled' ? 'disabled' : ''}></label>
            <label class="field standalone-full"><span>Заметка, необязательно</span><textarea name="note" rows="2" placeholder="Краткий комментарий" ${assignment.status === 'cancelled' ? 'disabled' : ''}></textarea></label>
          </div>
          <div class="standalone-actions">${progressActions(assignment)}<span data-standalone-progress-error role="alert"></span></div>
        </form>
        ${updateHistory(assignment)}
      </section>

      <section class="standalone-section">
        <div class="standalone-section-head"><div><strong>Подтверждающие материалы</strong><span>Необязательно. Файл не влияет на состояние задачи.</span></div></div>
        <form data-standalone-report-form data-assignment-id="${escapeStandalone(assignment.id)}">
          <label class="field"><span>Документ из системы</span><select name="documentId" ${evidenceLocked ? 'disabled' : ''}>${documentOptions(documents)}</select></label>
          <label class="field"><span>Новый файл</span><input name="file" type="file" accept=".pdf,.docx,.odt,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff" ${evidenceLocked ? 'disabled' : ''}></label>
          <label class="field"><span>Комментарий, необязательно</span><textarea name="note" rows="2" placeholder="Что подтверждает материал" ${evidenceLocked ? 'disabled' : ''}></textarea></label>
          <p class="standalone-upload-state hidden" data-standalone-upload-state></p>
          <div class="standalone-actions"><button class="secondary-button" type="submit" ${evidenceLocked ? 'disabled' : ''}>Приложить материал</button><span data-standalone-report-error role="alert"></span></div>
        </form>
        ${evidenceHistory(assignment)}
      </section>
    </article>
  </div>`;

  actions.innerHTML = source.planId
    ? `<button type="button" class="secondary-button" data-open-plan-source="${escapeStandalone(source.planId)}">Открыть исходный план</button>`
    : '';
  inspector.classList.remove('hidden');
  $sa('#sheet-backdrop')?.classList.remove('hidden');
}

async function findAssignment(assignmentId) {
  const response = await standaloneApi('/api/assignments?limit=2000');
  return (response.items || []).find((item) => item.id === assignmentId) || null;
}

async function openStandaloneAssignment(assignmentId, message = '') {
  const assignment = await findAssignment(assignmentId);
  if (!assignment || assignment.directive_id) return false;
  const documents = await standaloneApi('/api/documents?limit=500');
  standaloneAssignmentState.assignmentId = assignmentId;
  standaloneAssignmentState.assignment = assignment;
  standaloneAssignmentState.documents = documents.items || [];
  renderStandaloneAssignment(assignment, standaloneAssignmentState.documents, message);
  return true;
}

function localFileKey(prefix, assignmentId, file) {
  return `${prefix}:${assignmentId}:${file.name}:${file.size}:${file.lastModified}`;
}

async function uploadStandaloneFile(assignmentId, file) {
  return standaloneApi('/api/documents', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-document-type': 'report',
      'idempotency-key': localFileKey('assignment-evidence', assignmentId, file)
    },
    body: file
  });
}

function setFormError(form, selector, message) {
  const target = $sa(selector, form);
  if (target) target.textContent = message || '';
}

async function saveStandaloneProgress(form, submitter) {
  const buttons = [...form.querySelectorAll('button[type="submit"]')];
  setFormError(form, '[data-standalone-progress-error]', '');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const data = new FormData(form);
    const action = submitter?.value || 'note';
    const currentStatus = standaloneAssignmentState.assignment?.status || 'open';
    const status = action === 'complete'
      ? 'completed'
      : action === 'reopen'
        ? 'open'
        : currentStatus === 'completed'
          ? 'completed'
          : 'open';
    const requestedProgress = Number(data.get('progressPercent'));
    const progressPercent = status === 'completed'
      ? 100
      : Number.isFinite(requestedProgress)
        ? Math.max(0, Math.min(100, requestedProgress))
        : null;
    await standaloneApi(`/api/assignments/${encodeURIComponent(form.dataset.assignmentId)}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status,
        progressPercent,
        note: String(data.get('note') || '').trim() || null
      })
    });
    const message = action === 'complete'
      ? 'Задача выполнена. План, календарь и «План / факт» обновлены сразу.'
      : action === 'reopen'
        ? 'Задача возвращена в работу.'
        : 'Заметка сохранена.';
    await openStandaloneAssignment(form.dataset.assignmentId, message);
    if (typeof window.loadWork === 'function') window.loadWork();
  } catch (error) {
    setFormError(form, '[data-standalone-progress-error]', error.message);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function saveStandaloneEvidence(form) {
  const button = $sa('button[type="submit"]', form);
  const uploadState = $sa('[data-standalone-upload-state]', form);
  setFormError(form, '[data-standalone-report-error]', '');
  if (button) button.disabled = true;
  try {
    const data = new FormData(form);
    const file = data.get('file');
    let documentId = form.dataset.uploadedDocumentId || String(data.get('documentId') || '');
    if (!documentId && file instanceof File && file.size > 0) {
      const uploaded = await uploadStandaloneFile(form.dataset.assignmentId, file);
      documentId = uploaded.documentId;
      form.dataset.uploadedDocumentId = documentId;
      if (uploadState) {
        uploadState.textContent = 'Файл сохранён. При повторе он не будет загружен второй раз.';
        uploadState.classList.remove('hidden');
      }
    }
    if (!documentId) throw new Error('Выберите документ или приложите новый файл.');
    await standaloneApi(`/api/assignments/${encodeURIComponent(form.dataset.assignmentId)}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId,
        note: String(data.get('note') || '').trim() || null
      })
    });
    await openStandaloneAssignment(
      form.dataset.assignmentId,
      'Материал приложен. Состояние задачи не изменилось.'
    );
    if (typeof window.loadWork === 'function') window.loadWork();
  } catch (error) {
    setFormError(form, '[data-standalone-report-error]', error.message);
    if (form.dataset.uploadedDocumentId && uploadState) {
      uploadState.textContent = 'Файл уже сохранён. Исправьте ошибку и повторите только привязку.';
      uploadState.classList.remove('hidden');
    }
    if (button) button.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  const card = event.target.closest('.work-card[data-work-kind="assignment"]');
  if (card) {
    setTimeout(() => openStandaloneAssignment(card.dataset.workId).catch(() => {}), 0);
  }
}, true);

document.addEventListener('submit', (event) => {
  const progress = event.target.closest('[data-standalone-progress-form]');
  if (progress) {
    event.preventDefault();
    event.stopImmediatePropagation();
    saveStandaloneProgress(progress, event.submitter);
    return;
  }
  const evidence = event.target.closest('[data-standalone-report-form]');
  if (evidence) {
    event.preventDefault();
    event.stopImmediatePropagation();
    saveStandaloneEvidence(evidence);
  }
}, true);

ensureStandaloneStyles();
window.kafedraOpenStandaloneAssignment = openStandaloneAssignment;
