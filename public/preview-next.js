const previewState = {
  documentId: null,
  document: null
};

const $p = (selector, root = document) => root.querySelector(selector);

function ensurePreviewStyles() {
  if ($p('#preview-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'preview-next-styles';
  link.rel = 'stylesheet';
  link.href = '/preview-next.css';
  document.head.append(link);
}

async function previewApi(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function escapePreview(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function statusText(value) {
  return {
    ready: 'готов',
    unavailable: 'недоступен',
    failed: 'ошибка',
    disabled: 'отключён',
    unsupported: 'не поддерживается',
    pending: 'формируется',
    used: 'выполнено',
    not_needed: 'не требовалось',
    empty: 'текст не найден'
  }[value] || value || 'неизвестно';
}

function renderPreview(document) {
  const body = $p('#ux-inspector-body');
  if (!body || $p('#ux-inspector')?.classList.contains('hidden')) return;
  $p('#document-native-preview')?.remove();

  const previewUrl = document.previewUrl;
  let canvas = '';
  if (previewUrl && document.preview_media_type === 'application/pdf') {
    canvas = `<iframe id="document-preview-frame" class="document-preview-frame" src="${escapePreview(previewUrl)}" title="Предпросмотр документа"></iframe>`;
  } else if (previewUrl && String(document.preview_media_type || '').startsWith('image/')) {
    canvas = `<div class="document-preview-image-wrap"><img id="document-preview-image" src="${escapePreview(previewUrl)}" alt="Предпросмотр исходного изображения"></div>`;
  } else {
    const reason = document.preview_error
      ? `Причина: ${document.preview_error}`
      : document.preview_status === 'pending'
        ? 'Предпросмотр формируется в фоновом процессе.'
        : 'Для офисных документов требуется LibreOffice; структурный текст остаётся доступен ниже.';
    canvas = `<div class="document-preview-unavailable"><strong>Предпросмотр ${escapePreview(statusText(document.preview_status))}</strong><span>${escapePreview(reason)}</span></div>`;
  }

  const html = `<section id="document-native-preview" class="inspector-section document-native-preview">
    <div class="inspector-section-head">
      <h3>Исходный вид</h3>
      <div class="preview-statuses">
        <span>OCR: ${escapePreview(statusText(document.ocr_status))}</span>
        <span>Предпросмотр: ${escapePreview(statusText(document.preview_status))}</span>
      </div>
    </div>
    <div class="preview-actions">
      <a class="secondary-button" href="${escapePreview(document.originalUrl)}" target="_blank" rel="noopener">Открыть оригинал</a>
      ${previewUrl ? `<a class="text-button" href="${escapePreview(previewUrl)}" target="_blank" rel="noopener">Открыть отдельно</a>` : ''}
      <button class="secondary-button supporting-context-button" type="button" data-supporting-open data-target-kind="document" data-target-id="${escapePreview(document.id)}" data-target-label="${escapePreview(document.title || document.original_name || 'Документ')}">Сопроводительные</button>
    </div>
    ${document.ocr_error ? `<div class="source-note">OCR: ${escapePreview(document.ocr_error)}</div>` : ''}
    ${canvas}
  </section>`;

  body.insertAdjacentHTML('afterbegin', html);
}

async function loadPreview(documentId) {
  previewState.documentId = documentId;
  const document = await previewApi(`/api/documents/${encodeURIComponent(documentId)}`);
  if (previewState.documentId !== documentId) return;
  previewState.document = document;
  let attempts = 0;
  while ((!$p('#ux-inspector-body') || $p('#ux-inspector')?.classList.contains('hidden')) && attempts < 40) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    attempts += 1;
  }
  renderPreview(document);
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
  if (documentId) setTimeout(() => loadPreview(documentId).catch(() => {}), 60);

  const page = event.target.closest('[data-structure-page]');
  if (page && previewState.document?.preview_media_type === 'application/pdf') {
    const frame = $p('#document-preview-frame');
    if (frame) frame.src = `${previewState.document.previewUrl}#page=${Number(page.dataset.structurePage)}`;
  }
});

ensurePreviewStyles();
