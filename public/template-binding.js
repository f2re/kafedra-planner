const previousFetch = window.fetch.bind(window);

const bindingState = {
  source: null,
  currentLine: null,
  bindings: [],
  selectedBlock: null,
  selectedDocumentId: null
};

const $b = (selector, root = document) => root.querySelector(selector);
const $$b = (selector, root = document) => [...root.querySelectorAll(selector)];

function cloneInitWithJson(init, body) {
  const headers = new Headers(init?.headers || {});
  headers.set('content-type', 'application/json');
  return { ...(init || {}), headers, body: JSON.stringify(body) };
}

function augmentFields(fields) {
  if (!Array.isArray(fields)) return fields;
  return fields.map((field, index) => {
    const binding = field.sourceLocator ? field : bindingState.bindings[index];
    if (!binding?.sourceLocator) return field;
    return {
      ...field,
      sourceLocator: binding.sourceLocator,
      sourceBlockType: binding.sourceBlockType || null
    };
  });
}

window.fetch = async function boundTemplateFetch(input, init = {}) {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

  let nextInit = init;
  if (url.origin === window.location.origin && init.body && ['POST', 'PUT'].includes(method)) {
    try {
      const body = JSON.parse(String(init.body));
      if (url.pathname === '/api/templates' || url.pathname === '/api/templates/preview') {
        body.fields = augmentFields(body.fields);
        nextInit = cloneInitWithJson(init, body);
      } else if (url.pathname === '/api/templates/draft' && body.payload) {
        body.payload.fields = augmentFields(body.payload.fields);
        nextInit = cloneInitWithJson(init, body);
      }
    } catch {}
  }

  const response = await previousFetch(input, nextInit);
  if (url.origin === window.location.origin && response.ok) {
    if (method === 'GET' && url.pathname === '/api/templates/source') {
      response.clone().json().then((data) => {
        const changed = bindingState.source?.version_id !== data.version_id;
        bindingState.source = data;
        bindingState.currentLine = null;
        if (changed) bindingState.bindings = [];
      }).catch(() => {});
    }
    if (method === 'GET' && url.pathname === '/api/templates/draft') {
      response.clone().json().then((data) => {
        const fields = data?.draft?.payload?.fields || [];
        if (fields.length) {
          bindingState.bindings = fields.map((field) => field.sourceLocator
            ? { sourceLocator: field.sourceLocator, sourceBlockType: field.sourceBlockType || null }
            : null);
        }
      }).catch(() => {});
    }
  }
  return response;
};

function lineMetadata(number) {
  return bindingState.source?.lines?.find((line) => Number(line.number) === Number(number)) || null;
}

function suggestedLabel(text) {
  const source = String(text || '').trim();
  const colon = source.search(/[:：]/);
  if (colon > 0 && colon < 80) return source.slice(0, colon).trim();
  return source.split(/\s+/).slice(0, 6).join(' ');
}

function ensureBindButton() {
  const section = $b('.structure-source-section');
  if (!section || $b('#create-field-from-block')) return;
  const helper = $b('.structure-helper', section);
  helper?.insertAdjacentHTML('afterend', `
    <button id="create-field-from-block" class="secondary-button structure-bind-button" type="button" disabled>
      Создать поле из выбранного фрагмента
    </button>
  `);
}

async function chooseBlock(blockId) {
  const templateButton = $b('[data-inspector-template]');
  const documentId = templateButton?.dataset.inspectorTemplate;
  if (!documentId) return;
  const response = await previousFetch(`/api/documents/${encodeURIComponent(documentId)}/structure?limit=5000`);
  if (!response.ok) return;
  const data = await response.json();
  const block = data.blocks?.find((item) => item.id === blockId);
  if (!block) return;
  bindingState.selectedBlock = block;
  bindingState.selectedDocumentId = documentId;
  ensureBindButton();
  const button = $b('#create-field-from-block');
  if (button) {
    button.disabled = false;
    button.textContent = `Создать поле: ${suggestedLabel(block.text) || 'выбранный фрагмент'}`;
  }
}

async function openWizardFromBlock() {
  const block = bindingState.selectedBlock;
  const documentId = bindingState.selectedDocumentId;
  if (!block || !documentId) return;
  const templateButton = $b(`[data-inspector-template="${CSS.escape(documentId)}"]`);
  bindingState.source = null;
  bindingState.currentLine = null;
  templateButton?.click();

  let attempts = 0;
  while (($b('#template-sheet')?.classList.contains('hidden') || !bindingState.source) && attempts < 80) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    attempts += 1;
  }
  const line = bindingState.source?.lines?.find((item) => item.blockId === block.id)
    || bindingState.source?.lines?.find((item) => item.text === block.text);
  if (!line) return;
  const element = $b(`[data-line-number="${Number(line.number)}"]`);
  element?.click();
  bindingState.currentLine = line;

  const label = $b('#field-label');
  const anchor = $b('#field-anchor');
  const strategy = $b('#field-strategy');
  if (label) label.value = suggestedLabel(block.text) || 'Извлечённое поле';
  if (anchor) anchor.value = String(block.text || '').trim().slice(0, 160);
  if (strategy) {
    strategy.value = block.locator?.kind === 'xlsx_cell'
      || block.locator?.kind === 'docx_table_cell'
      || block.locator?.kind === 'odf_table_cell'
      ? 'line'
      : String(block.text || '').includes(':') ? 'after_label' : 'line';
    strategy.dispatchEvent(new Event('change', { bubbles: true }));
  }
  label?.focus();
  element?.scrollIntoView({ block: 'center' });
  const hint = $b('#template-selection-hint');
  if (hint) hint.textContent = 'Поле привязано к структурному фрагменту; назовите его и добавьте.';
}

document.addEventListener('click', (event) => {
  const line = event.target.closest('[data-line-number]');
  if (line) bindingState.currentLine = lineMetadata(line.dataset.lineNumber);

  const add = event.target.closest('#add-template-field');
  if (add) {
    setTimeout(() => {
      const count = $$b('#template-fields .template-field').length;
      if (!count || count <= bindingState.bindings.length) return;
      while (bindingState.bindings.length < count - 1) bindingState.bindings.push(null);
      const metadata = bindingState.currentLine;
      bindingState.bindings.push(metadata?.locator
        ? { sourceLocator: metadata.locator, sourceBlockType: metadata.blockType || null }
        : null);
    }, 0);
  }

  const remove = event.target.closest('[data-remove-field]');
  if (remove) bindingState.bindings.splice(Number(remove.dataset.removeField), 1);

  const block = event.target.closest('[data-structure-block]');
  if (block) chooseBlock(block.dataset.structureBlock).catch(() => {});

  const bind = event.target.closest('#create-field-from-block');
  if (bind) openWizardFromBlock().catch(() => {});

  if (event.target.closest('#discard-template-draft')) bindingState.bindings = [];
  if (event.target.closest('#resume-template-draft')) {
    setTimeout(() => {
      const fields = $b('#template-draft-banner')?._draft?.payload?.fields || [];
      bindingState.bindings = fields.map((field) => field.sourceLocator
        ? { sourceLocator: field.sourceLocator, sourceBlockType: field.sourceBlockType || null }
        : null);
    }, 0);
  }
});

const bindingObserver = new MutationObserver(() => ensureBindButton());
bindingObserver.observe(document.documentElement, { childList: true, subtree: true });
ensureBindButton();
