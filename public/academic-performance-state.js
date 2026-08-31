export const academicState = {
  items: [],
  hierarchy: [],
  selectedId: null,
  analysis: null,
  documentId: null,
  uploadedName: '',
  mappingDraft: null,
  includeHistory: false,
  loading: false,
  selectedTotalIds: [],
  totals: null,
  totalsLoading: false,
  totalsRequest: 0,
  totalsPeriodKey: null
};

export const $ap = (selector, root = document) => root.querySelector(selector);

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function average(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function statusLabel(value) {
  return {
    completed: 'Готово',
    completed_with_review: 'Нужно проверить',
    failed: 'Ошибка',
    running: 'Обработка'
  }[value] || value || '—';
}

export function lifecycleLabel(value) {
  return {
    active: 'Актуальная',
    archived: 'В архиве',
    superseded: 'Предыдущая версия'
  }[value] || value || '—';
}

export function gradeLabel(value, raw = '') {
  return {
    excellent: 'Отлично',
    good: 'Хорошо',
    satisfactory: 'Удовлетворительно',
    unsatisfactory: 'Неудовлетворительно',
    not_attested: 'Не аттестован',
    unknown: raw || 'Не распознано'
  }[value] || raw || 'Не распознано';
}

export async function academicApi(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Ошибка HTTP ${response.status}`);
  return payload;
}

function ensureStyles() {
  if ($ap('#academic-performance-styles')) return;
  const link = document.createElement('link');
  link.id = 'academic-performance-styles';
  link.rel = 'stylesheet';
  link.href = '/academic-performance-next.css';
  document.head.append(link);
}

function navButton(container, reference, mobile = false) {
  if (!container || $ap('[data-view="academic-performance"]', container)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'academic-performance';
  button.className = mobile ? 'mobile-tab' : 'nav-item';
  button.innerHTML = mobile
    ? 'Учёба'
    : '<span class="nav-icon">▥</span><span>Учебный процесс</span>';
  if (reference?.nextSibling) container.insertBefore(button, reference.nextSibling);
  else container.append(button);
}

function screenMarkup() {
  return `
    <section class="view academic-performance-view" data-view-panel="academic-performance">
      <header class="academic-page-head">
        <div><h2>Успеваемость</h2><p>Ведомости сгруппированы по учебным годам, семестрам и группам. Каждая цифра раскрывается до исходной ячейки.</p></div>
        <div class="academic-head-actions">
          <button class="secondary-button" type="button" data-academic-export-all>Выгрузить общую таблицу</button>
          <button class="primary-button" type="button" data-academic-import-open>Загрузить ведомость</button>
        </div>
      </header>
      <p class="academic-inline-error hidden" data-academic-page-error role="alert"></p>
      <div class="academic-layout">
        <aside class="academic-period-panel">
          <header><strong>Учебные периоды</strong><button class="quiet-button academic-history-toggle" type="button" data-academic-history>История</button></header>
          <div data-academic-hierarchy></div>
          <div class="academic-history-list hidden" data-academic-history-list></div>
        </aside>
        <section class="academic-summary-panel" data-academic-summary>
          <div class="academic-empty"><strong>Выберите учебную группу</strong><span>Сводка по дисциплинам появится здесь.</span></div>
        </section>
      </div>
    </section>
    <div class="academic-backdrop hidden" data-academic-backdrop></div>
    <section class="academic-modal hidden" data-academic-modal role="dialog" aria-modal="true" aria-labelledby="academic-modal-title"></section>
    <section class="academic-modal academic-modal-wide hidden" data-academic-details role="dialog" aria-modal="true" aria-labelledby="academic-details-title"></section>`;
}

export function ensureUi() {
  ensureStyles();
  const sidebar = $ap('.sidebar-nav');
  navButton(sidebar, $ap('[data-view="reports"]', sidebar));
  const mobile = $ap('.mobile-tabs');
  navButton(mobile, $ap('[data-view="reports"]', mobile), true);
  if (!$ap('[data-view-panel="academic-performance"]')) {
    const workspace = $ap('.workspace');
    if (workspace) workspace.insertAdjacentHTML('beforeend', screenMarkup());
  }
}

export function showView() {
  ensureUi();
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  $ap('[data-view-panel="academic-performance"]')?.classList.add('active');
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === 'academic-performance');
  });
  const title = $ap('#page-title');
  const subtitle = $ap('#page-subtitle');
  if (title) title.textContent = 'Учебный процесс';
  if (subtitle) subtitle.textContent = 'Учебный год → семестр → группа → дисциплины';
  $ap('#create-button')?.classList.add('hidden');
  window.dispatchEvent(new CustomEvent('kafedra:view-changed', {
    detail: { view: 'academic-performance' }
  }));
}

export function pageError(message = '') {
  const target = $ap('[data-academic-page-error]');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('hidden', !message);
}

export function selectedRun() {
  return academicState.items.find((item) => item.id === academicState.selectedId) || null;
}

export function currentPeriodRuns() {
  const run = selectedRun();
  if (!run) return [];
  return academicState.items.filter((item) =>
    item.is_current
    && item.lifecycle_status === 'active'
    && item.academic_year === run.academic_year
    && Number(item.semester) === Number(run.semester)
  );
}

export function selectedTotalRuns() {
  const selected = new Set(academicState.selectedTotalIds);
  return currentPeriodRuns().filter((item) => selected.has(item.id));
}

export function modal(html, wide = false) {
  ensureUi();
  const target = $ap('[data-academic-modal]');
  target.classList.toggle('academic-modal-wide', wide);
  target.innerHTML = html;
  target.classList.remove('hidden');
  $ap('[data-academic-backdrop]')?.classList.remove('hidden');
  document.body.classList.add('academic-modal-open');
}

export function closeModal() {
  $ap('[data-academic-modal]')?.classList.add('hidden');
  if ($ap('[data-academic-details]')?.classList.contains('hidden')) {
    $ap('[data-academic-backdrop]')?.classList.add('hidden');
    document.body.classList.remove('academic-modal-open');
  }
}

export function closeDetails() {
  $ap('[data-academic-details]')?.classList.add('hidden');
  if ($ap('[data-academic-modal]')?.classList.contains('hidden')) {
    $ap('[data-academic-backdrop]')?.classList.add('hidden');
    document.body.classList.remove('academic-modal-open');
  }
}

export function modalError(form, message = '') {
  const target = $ap('[data-academic-error]', form);
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('hidden', !message);
}

export function exportUrl(format, params = {}) {
  const query = new URLSearchParams({ format, ...params });
  return `/api/academic-performance/export?${query}`;
}
