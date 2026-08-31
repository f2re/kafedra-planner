const STYLE_ID = 'plans-lifecycle-segment-stylesheet';
const ENHANCED_ATTRIBUTE = 'data-plans-lifecycle-enhanced';

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function optionIdentity(option) {
  return normalize(`${option?.value || ''} ${option?.textContent || ''}`);
}

function isArchivedOption(option) {
  return /(?:архив|archiv|archive|archived|^true$)/u.test(optionIdentity(option));
}

function isCurrentOption(option) {
  return /(?:текущ|действ|в работе|рабоч|active|current|working|^false$)/u.test(optionIdentity(option));
}

export function resolveLifecycleOptions(select) {
  const options = Array.from(select?.options || []);
  const archived = options.find(isArchivedOption) || null;
  if (!archived) return null;
  const current = options.find((option) => option !== archived && isCurrentOption(option))
    || options.find((option) => option !== archived && normalize(option.value) === '')
    || options.find((option) => option !== archived)
    || null;
  return current ? { current, archived } : null;
}

function plansContext(select) {
  return select.closest('[data-plans-root], [data-view="plans"], #plans, #plans-view, #plansView, .plans-next, .plans-view')
    || select.closest('section, main');
}

function selectScore(select) {
  if (!(select instanceof HTMLSelectElement)) return -1;
  if (select.closest('dialog, [role="dialog"], .modal, .sheet, .drawer')) return -1;
  if (!resolveLifecycleOptions(select)) return -1;
  const identity = normalize(`${select.id} ${select.name} ${select.className} ${select.getAttribute('aria-label') || ''}`);
  const ownerIdentity = normalize(`${select.parentElement?.className || ''} ${select.parentElement?.id || ''}`);
  const context = plansContext(select);
  const contextText = normalize(context?.textContent || '').slice(0, 1800);
  let score = 0;
  if (/(?:archive|archiv|lifecycle|status|состоя|архив)/u.test(identity)) score += 6;
  if (/(?:filter|toolbar|control|search|фильтр)/u.test(ownerIdentity)) score += 4;
  if (select.closest('[data-plans-root], [data-view="plans"], #plans, #plans-view, #plansView, .plans-next, .plans-view')) score += 5;
  if (/(?:план|plans)/u.test(contextText)) score += 3;
  return score;
}

function findLifecycleSelect(root = document) {
  return Array.from(root.querySelectorAll('select'))
    .map((select) => ({ select, score: selectScore(select) }))
    .filter((entry) => entry.score >= 5)
    .sort((left, right) => right.score - left.score)[0]?.select || null;
}

function ensureStylesheet(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plans-lifecycle-segment.css';
  doc.head.append(link);
}

function sourceOwner(select) {
  const label = select.closest('label');
  if (label && label.querySelectorAll('select').length === 1 && !label.querySelector('input, textarea, button')) return label;
  const parent = select.parentElement;
  if (parent && parent.querySelectorAll('select').length === 1 && !parent.querySelector('input, textarea, button')) {
    const identity = normalize(`${parent.className || ''} ${parent.textContent || ''}`);
    if (/(?:filter|field|control|архив|состоя)/u.test(identity)) return parent;
  }
  return select;
}

function hideSourceControl(select, owner) {
  select.hidden = true;
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  select.dataset.lifecycleSource = 'true';
  if (owner !== select) {
    owner.hidden = true;
    owner.dataset.lifecycleSourceHidden = 'true';
  }
  if (select.id) {
    for (const label of document.querySelectorAll('label[for]')) {
      if (label.htmlFor === select.id && /(?:архив|состоя|lifecycle)/u.test(normalize(label.textContent))) {
        label.hidden = true;
        label.dataset.lifecycleSourceHidden = 'true';
      }
    }
  }
}

function dispatchLifecycleChange(select, value) {
  if (select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export function enhanceLifecycleSelect(select) {
  if (!(select instanceof HTMLSelectElement) || !select.isConnected) return null;
  const lifecycle = resolveLifecycleOptions(select);
  if (!lifecycle) return null;
  const existingId = select.getAttribute(ENHANCED_ATTRIBUTE);
  if (existingId) {
    const existing = document.getElementById(existingId);
    if (existing?.isConnected) return existing;
  }

  const owner = sourceOwner(select);
  const segment = document.createElement('div');
  segment.className = 'plans-lifecycle-segment';
  segment.id = `plans-lifecycle-segment-${Math.random().toString(36).slice(2, 10)}`;
  segment.setAttribute('role', 'tablist');
  segment.setAttribute('aria-label', 'Показать планы');
  segment.dataset.sourceSelectId = select.id || '';

  const definitions = [
    { key: 'current', label: 'Текущие', option: lifecycle.current },
    { key: 'archived', label: 'Архив', option: lifecycle.archived }
  ];
  const buttons = definitions.map(({ key, label, option }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plans-lifecycle-segment__button';
    button.dataset.lifecycleView = key;
    button.dataset.lifecycleValue = option.value;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', select.getAttribute('aria-controls') || '');
    button.textContent = label;
    segment.append(button);
    return button;
  });

  const sync = () => {
    const archivedSelected = select.value === lifecycle.archived.value;
    buttons.forEach((button) => {
      const selected = button.dataset.lifecycleView === (archivedSelected ? 'archived' : 'current');
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      dispatchLifecycleChange(select, button.dataset.lifecycleValue || '');
      sync();
      queueMicrotask(sync);
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
      if (event.key === 'ArrowRight') next = Math.min(buttons.length - 1, index + 1);
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      buttons[next].focus();
      buttons[next].click();
    });
  });

  select.addEventListener('change', sync);
  select.setAttribute(ENHANCED_ATTRIBUTE, segment.id);
  owner.before(segment);
  hideSourceControl(select, owner);
  sync();
  return segment;
}

let observer = null;
let scanScheduled = false;

function scan(root = document) {
  const source = findLifecycleSelect(root);
  if (source) enhanceLifecycleSelect(source);
  for (const segment of document.querySelectorAll('.plans-lifecycle-segment')) {
    const sourceId = segment.dataset.sourceSelectId;
    const sourceSelect = sourceId ? document.getElementById(sourceId) : null;
    if (sourceId && (!sourceSelect || !sourceSelect.isConnected)) segment.remove();
  }
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    scan(document);
  });
}

export function installPlansLifecycleSegment(root = document) {
  ensureStylesheet(root.ownerDocument || root);
  scan(root);
  if (observer || !document.body) return;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  globalThis.KafedraPlansLifecycleSegment = {
    enhanceLifecycleSelect,
    installPlansLifecycleSegment,
    resolveLifecycleOptions
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installPlansLifecycleSegment(), { once: true });
  } else {
    installPlansLifecycleSegment();
  }
}
