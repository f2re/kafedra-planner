const supportingState = {
  target: null,
  inspectorContext: null,
  mutationTimer: null
};

const $sd = (selector, root = document) => root.querySelector(selector);
const $$sd = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeSupporting(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function supportingApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function ensureSupportingStyles() {
  if ($sd('#supporting-documents-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'supporting-documents-next-styles';
  link.rel = 'stylesheet';
  link.href = '/supporting-documents-next.css';
  document.head.append(link);
}

function ensureSupportingModal() {
  if (!$sd('#manual-plan-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', '<div id="manual-plan-backdrop" class="manual-plan-backdrop hidden"></div>');
  }
  if (!$sd('#manual-plan-modal')) {
    document.body.insertAdjacentHTML('beforeend', '<section id="manual-plan-modal" class="manual-plan-modal hidden" role="dialog" aria-modal="true" aria-labelledby="manual-plan-modal-title"></section>');
  }
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function displayDate(value) {
  if (!value) return 'дата не указана';
  const date = new Date(`${String(value).slice(0, 10)}T09:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function relationLabel(value) {
  return {
    evidence: 'Подтверждение',
    basis: 'Основание',
    publication: 'Публикация',
    completion: 'Выполнение',
    reference: 'Ссылка'
  }[value] || value || 'Подтверждение';
}

function defaultRelation(kind) {
  return {
    assignment: 'completion',
    scientific_item: 'publication',
    meeting: 'reference',
    document: 'evidence',
    plan_item: 'completion'
  }[kind] || 'evidence';
}

function targetTitle(kind) {
  return {
    document: 'документа',
    assignment: 'поручения',
    scientific_item: 'научного материала',
    meeting: 'заседания',
    plan_item: 'пункта плана'
  }[kind] || 'объекта';
}

function relationFor(document, target) {
  return (document.links || []).find((link) =>
    link.target_kind === target.kind && link.target_id === target.id
  )?.relation_kind || defaultRelation(target.kind);
}

function relationOptions(selected) {
  return [
    ['evidence', 'Подтверждение'],
    ['basis', 'Основание'],
    ['publication', 'Публикация'],
    ['completion', 'Выполнение'],
    ['reference', 'Ссылка']
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function supportingList(items, target) {
  if (!items.length) return '<div class="supporting-empty">Сопроводительных документов пока нет.</div>';
  return `<div class="supporting-list">${items.map((item) => {
    const relation = relationFor(item, target);
    return `<article class="supporting-card" data-supporting-document-id="${escapeSupporting(item.id)}">
      <div class="supporting-card-copy">
        <strong>№ ${escapeSupporting(item.document_number)} от ${escapeSupporting(displayDate(item.document_date))}</strong>
        <span>${escapeSupporting(item.title || item.note || 'Без названия')}</span>
        <small>${escapeSupporting(relationLabel(relation))}</small>
      </div>
      <div class="supporting-card-actions">
        ${item.document_id ? `<a class="secondary-button" href="/api/documents/${encodeURIComponent(item.document_id)}/content?variant=original" target="_blank" rel="noopener">Открыть файл</a>` : '<span class="supporting-no-file">Без файла</span>'}
        <button class="quiet-button" type="button" data-supporting-unlink="${escapeSupporting(item.id)}" data-relation-kind="${escapeSupporting(relation)}">Убрать связь</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function showSupportingModal(items, { message = '', error = '' } = {}) {
  ensureSupportingModal();
  const target = supportingState.target;
  const modal = $sd('#manual-plan-modal');
  if (!target || !modal) return;
  const relation = defaultRelation(target.kind);
  modal.innerHTML = `
    <header class="manual-modal-head">
      <div><span>Реквизиты и подтверждение</span><h3 id="manual-plan-modal-title">Сопроводительные документы ${escapeSupporting(targetTitle(target.kind))}</h3></div>
      <button class="icon-button" type="button" data-manual-close aria-label="Закрыть">×</button>
    </header>
    <div class="manual-modal-body supporting-modal-body">
      <div class="supporting-target"><strong>${escapeSupporting(target.label || 'Выбранный объект')}</strong><span>Связь хранится отдельно и не изменяет исходный документ.</span></div>
      ${message ? `<div class="supporting-message" role="status">${escapeSupporting(message)}</div>` : ''}
      ${error ? `<div class="supporting-error" role="alert">${escapeSupporting(error)}</div>` : '<div class="supporting-error hidden" role="alert" data-supporting-global-error></div>'}
      ${supportingList(items, target)}
      <form data-supporting-form data-target-kind="${escapeSupporting(target.kind)}" data-target-id="${escapeSupporting(target.id)}">
        <div class="manual-grid-two">
          <label class="field"><span>Номер</span><input name="documentNumber" required maxlength="300" placeholder="Например, 12-03/26"></label>
          <label class="field"><span>Дата</span><input name="documentDate" type="date" value="${localDateKey()}" required></label>
        </div>
        <div class="manual-grid-two">
          <label class="field"><span>Относится как</span><select name="relationKind">${relationOptions(relation)}</select></label>
          <label class="field"><span>Название</span><input name="title" maxlength="1000" placeholder="Например, письмо о публикации"></label>
        </div>
        <label class="field"><span>Примечание</span><textarea name="note" rows="2" maxlength="12000" placeholder="Необязательное пояснение"></textarea></label>
        <label class="field"><span>PDF, DOCX или скан, если есть</span><input name="file" type="file" accept=".pdf,.docx,.odt,.xlsx,.ods,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff"></label>
        <p class="supporting-upload-state hidden" data-supporting-upload-state></p>
        <p class="manual-helper">Номер и дата сохраняются и без файла. Приложенный исходник регистрируется как неизменяемая версия документа.</p>
        <div class="manual-modal-actions">
          <button class="secondary-button" type="button" data-manual-close>Закрыть</button>
          <button class="primary-button" type="submit">Добавить</button>
        </div>
      </form>
    </div>`;
  $sd('#manual-plan-backdrop')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.classList.add('manual-plan-modal-open');
}

async function loadSupportingItems(target) {
  const query = new URLSearchParams({ targetKind: target.kind, targetId: target.id });
  const data = await supportingApi(`/api/supporting-documents?${query}`);
  return data.items || [];
}

async function openSupportingDocuments(target, options = {}) {
  supportingState.target = target;
  try {
    const items = await loadSupportingItems(target);
    showSupportingModal(items, options);
  } catch (error) {
    showSupportingModal([], { error: error.message });
  }
}

function fileKey(target, file) {
  return `supporting-document:${target.kind}:${target.id}:${file.name}:${file.size}:${file.lastModified}`;
}

async function uploadSupportingFile(target, file) {
  return supportingApi('/api/documents', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-document-type': 'auto',
      'idempotency-key': fileKey(target, file)
    },
    body: file
  });
}

function supportFormError(form, message) {
  let target = $sd('[data-supporting-form-error]', form);
  if (!target) {
    target = document.createElement('div');
    target.dataset.supportingFormError = '1';
    target.className = 'supporting-error';
    target.setAttribute('role', 'alert');
    $sd('.manual-modal-actions', form)?.insertAdjacentElement('beforebegin', target);
  }
  target.textContent = message || '';
  target.classList.toggle('hidden', !message);
}

async function alreadyCreated(target, body) {
  try {
    const items = await loadSupportingItems(target);
    return items.find((item) => {
      const relation = relationFor(item, target);
      const sameFile = body.documentId ? item.document_id === body.documentId : !item.document_id;
      return item.document_number === body.documentNumber
        && item.document_date === body.documentDate
        && relation === body.relationKind
        && sameFile;
    }) || null;
  } catch {
    return null;
  }
}

function refreshSupportingTarget(target) {
  if (target.kind === 'plan_item' && typeof window.kafedraOpenPlan === 'function') {
    const planId = $sd('.plan-card.active[data-plan-id]')?.dataset.planId;
    if (planId) window.kafedraOpenPlan(planId);
  }
  if (target.kind === 'assignment' && typeof window.loadWork === 'function') window.loadWork();
}

async function saveSupporting(form) {
  const target = supportingState.target;
  if (!target) return;
  const button = $sd('button[type="submit"]', form);
  const uploadState = $sd('[data-supporting-upload-state]', form);
  supportFormError(form, '');
  if (button) button.disabled = true;
  const data = new FormData(form);
  const file = data.get('file');
  let documentId = form.dataset.uploadedDocumentId || null;
  try {
    if (!documentId && file instanceof File && file.size > 0) {
      const uploaded = await uploadSupportingFile(target, file);
      documentId = uploaded.documentId;
      form.dataset.uploadedDocumentId = documentId;
      if (uploadState) {
        uploadState.textContent = 'Файл уже сохранён. Повторное нажатие не создаст вторую копию.';
        uploadState.classList.remove('hidden');
      }
    }
    const body = {
      documentNumber: String(data.get('documentNumber') || '').trim(),
      documentDate: String(data.get('documentDate') || ''),
      title: String(data.get('title') || '').trim() || null,
      note: String(data.get('note') || '').trim() || null,
      documentId,
      targetKind: target.kind,
      targetId: target.id,
      relationKind: String(data.get('relationKind') || defaultRelation(target.kind))
    };
    await supportingApi('/api/supporting-documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    await openSupportingDocuments(target, {
      message: documentId
        ? 'Реквизиты и файл сохранены. Исходный файл не изменён.'
        : 'Реквизиты сохранены без файла.'
    });
    refreshSupportingTarget(target);
  } catch (error) {
    const body = {
      documentNumber: String(data.get('documentNumber') || '').trim(),
      documentDate: String(data.get('documentDate') || ''),
      relationKind: String(data.get('relationKind') || defaultRelation(target.kind)),
      documentId
    };
    const existing = await alreadyCreated(target, body);
    if (existing) {
      await openSupportingDocuments(target, { message: 'Документ уже был сохранён; повтор не создал дубль.' });
      return;
    }
    supportFormError(form, error.message);
    if (documentId && uploadState) {
      uploadState.textContent = 'Файл уже сохранён в документах. Исправьте реквизиты и повторите — файл не загрузится второй раз.';
      uploadState.classList.remove('hidden');
    }
    if (button) button.disabled = false;
  }
}

async function unlinkSupporting(button) {
  const target = supportingState.target;
  if (!target) return;
  button.disabled = true;
  try {
    await supportingApi(`/api/supporting-documents/${encodeURIComponent(button.dataset.supportingUnlink)}/unlink`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetKind: target.kind,
        targetId: target.id,
        relationKind: button.dataset.relationKind || defaultRelation(target.kind)
      })
    });
    await openSupportingDocuments(target, {
      message: 'Связь убрана. Реквизиты, история и исходный файл сохранены.'
    });
  } catch (error) {
    const global = $sd('[data-supporting-global-error]');
    if (global) {
      global.textContent = error.message;
      global.classList.remove('hidden');
    }
    button.disabled = false;
  }
}

function supportButton(target, label = 'Сопроводительные') {
  return `<button type="button" class="secondary-button supporting-context-button"
    data-supporting-open data-target-kind="${escapeSupporting(target.kind)}"
    data-target-id="${escapeSupporting(target.id)}" data-target-label="${escapeSupporting(target.label || '')}">${escapeSupporting(label)}</button>`;
}

function decoratePlanItems() {
  $$sd('[data-manual-support]').forEach((button) => {
    const id = button.dataset.manualSupport;
    if (!id) return;
    const row = button.closest('[data-plan-item-row]');
    button.removeAttribute('data-manual-support');
    button.dataset.supportingOpen = '1';
    button.dataset.targetKind = 'plan_item';
    button.dataset.targetId = id;
    button.dataset.targetLabel = $sd('strong', row)?.textContent || 'Пункт плана';
    button.textContent = 'Документы';
  });
}

function decorateAssignments() {
  $$sd('.work-assignment[data-assignment-id]').forEach((card) => {
    const id = card.dataset.assignmentId;
    if (!id || $sd(`[data-supporting-open][data-target-kind="assignment"][data-target-id="${CSS.escape(id)}"]`, card)) return;
    const header = $sd('header', card);
    const target = { kind: 'assignment', id, label: $sd('strong', header)?.textContent || 'Поручение' };
    const holder = document.createElement('div');
    holder.className = 'supporting-inline-actions';
    holder.innerHTML = supportButton(target, 'Сопроводительные документы');
    (header || card).insertAdjacentElement('afterend', holder);
  });
}

function decorateMeeting() {
  const active = $sd('.meeting-card.active[data-meeting-id]');
  const head = $sd('#meeting-detail .meeting-detail-head');
  const id = active?.dataset.meetingId;
  if (!id || !head || $sd('[data-supporting-open][data-target-kind="meeting"]', head)) return;
  const label = $sd('h3', head)?.textContent || 'Заседание';
  head.insertAdjacentHTML('beforeend', supportButton({ kind: 'meeting', id, label }, 'Сопроводительные'));
}

function decorateInspector() {
  const context = supportingState.inspectorContext;
  const inspector = $sd('#ux-inspector');
  if (!context || !inspector || inspector.classList.contains('hidden')) return;
  if (context.kind === 'document') {
    const actions = $sd('#document-native-preview .preview-actions');
    if (actions && !$sd('[data-supporting-open][data-target-kind="document"]', actions)) {
      actions.insertAdjacentHTML('beforeend', supportButton(context, 'Сопроводительные'));
    }
    return;
  }
  if (context.kind === 'scientific_item') {
    const section = $sd('#ux-inspector-body > .inspector-section, #ux-inspector-body .inspector-section');
    if (section && !$sd('[data-supporting-open][data-target-kind="scientific_item"]', section)) {
      const holder = document.createElement('div');
      holder.className = 'supporting-inline-actions';
      holder.innerHTML = supportButton(context, 'Подтверждение публикации');
      section.append(holder);
    }
  }
}

function decorateSupportingContexts() {
  decoratePlanItems();
  decorateAssignments();
  decorateMeeting();
  decorateInspector();
}

function scheduleSupportingDecoration() {
  clearTimeout(supportingState.mutationTimer);
  supportingState.mutationTimer = setTimeout(decorateSupportingContexts, 40);
}

document.addEventListener('click', (event) => {
  const open = event.target.closest('[data-supporting-open]');
  if (open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openSupportingDocuments({
      kind: open.dataset.targetKind,
      id: open.dataset.targetId,
      label: open.dataset.targetLabel || open.textContent.trim()
    });
    return;
  }
  const unlink = event.target.closest('[data-supporting-unlink]');
  if (unlink) {
    event.preventDefault();
    unlinkSupporting(unlink);
    return;
  }

  const science = event.target.closest('[data-science-id]');
  if (science) {
    supportingState.inspectorContext = {
      kind: 'scientific_item',
      id: science.dataset.scienceId,
      label: $sd('strong', science)?.textContent || 'Научный материал'
    };
    setTimeout(decorateInspector, 80);
  }
  const documentTitle = event.target.closest('.document-open');
  const documentSource = event.target.closest('[data-inspector-document]');
  const documentId = documentTitle?.closest('[data-document-id]')?.dataset.documentId
    || documentSource?.dataset.inspectorDocument;
  if (documentId) {
    supportingState.inspectorContext = {
      kind: 'document',
      id: documentId,
      label: documentTitle?.textContent?.trim() || 'Документ'
    };
    setTimeout(decorateInspector, 100);
  }
  if (event.target.closest('#ux-inspector-close')) supportingState.inspectorContext = null;
}, true);

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-supporting-form]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  saveSupporting(form);
}, true);

ensureSupportingStyles();
ensureSupportingModal();
new MutationObserver(scheduleSupportingDecoration).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
scheduleSupportingDecoration();
window.kafedraOpenSupportingDocuments = openSupportingDocuments;
