const rs = { science: [], matches: [], documents: [] };
const one = (selector, root = document) => root.querySelector(selector);
const many = (selector, root = document) => [...root.querySelectorAll(selector)];
const safe = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

async function rsApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureReportsScienceUi() {
  if (!one('[data-view="science"]')) {
    one('#navigation')?.insertAdjacentHTML('beforeend', '<button class="nav-item" data-view="science"><span class="nav-icon" aria-hidden="true">⌁</span><span>Наука</span></button>');
    one('.mobile-tabs')?.insertAdjacentHTML('beforeend', '<button class="mobile-tab" data-view="science"><span>⌁</span>Наука</button>');
  }
  if (!one('[data-view-panel="science"]')) {
    one('.workspace')?.insertAdjacentHTML('beforeend', `<section class="view" data-view-panel="science">
      <div class="section-heading"><div><h2>Научная деятельность</h2><p>Статьи, конференции, проекты, гранты, патенты и отчёты НИР.</p></div></div>
      <form id="science-search-form" class="science-toolbar">
        <input name="q" type="search" placeholder="Название, DOI, журнал…">
        <input name="author" placeholder="Автор">
        <input name="from" type="date" aria-label="Дата с">
        <input name="to" type="date" aria-label="Дата по">
        <select name="kind"><option value="">Все виды</option><option value="article">Статьи</option><option value="conference">Конференции</option><option value="grant">Гранты</option><option value="patent">Патенты</option><option value="project">Проекты</option><option value="nir_report">Отчёты НИР</option></select>
        <input name="classification" placeholder="ВАК, РИНЦ, Scopus…">
      </form>
      <div id="science-summary" class="science-summary"></div>
      <div id="science-results" class="science-list"></div>
    </section>`);
  }
  const workPanel = one('[data-view-panel="work"]');
  if (workPanel && !one('#report-match-panel')) {
    const heading = workPanel.querySelector('.section-heading');
    heading?.insertAdjacentHTML('afterend', `<section id="report-match-panel" class="report-match-panel hidden">
      <div class="rail-head"><strong>Возможные подтверждающие материалы</strong><span id="report-match-count" class="count-pill">0</span></div>
      <p>Система предложила связь загруженного документа с задачей. Связь необязательна и не меняет состояние задачи.</p>
      <div id="report-match-list"></div>
    </section>`);
  }
  if (!one('#reports-science-styles')) {
    const link = document.createElement('link');
    link.id = 'reports-science-styles'; link.rel = 'stylesheet'; link.href = '/reports-science-next.css';
    document.head.append(link);
  }
}

function openScienceView() {
  many('.nav-item,.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'science'));
  many('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'science'));
  one('#page-title').textContent = 'Наука';
  one('#page-subtitle').textContent = 'Публикации и научная деятельность с доказательствами';
  one('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  loadScience().catch(() => {});
}

function kindLabel(kind) {
  return ({ article:'Статья', conference:'Конференция', grant:'Грант', patent:'Патент', project:'Проект', nir_report:'Отчёт НИР' })[kind] || kind;
}

function renderScience(items) {
  const authors = new Set(items.flatMap((item) => item.authors.map((author) => author.display_name || author.author_raw)));
  one('#science-summary').innerHTML = `<span>Материалов: ${items.length}</span><span>Авторов: ${authors.size}</span><span>Подтверждено: ${items.filter((item) => item.status === 'confirmed').length}</span>`;
  one('#science-results').innerHTML = items.length ? items.map((item) => `<button class="science-card" type="button" data-science-id="${safe(item.id)}">
    <div><span class="science-kind">${safe(kindLabel(item.item_kind))}</span><strong>${safe(item.title)}</strong><p>${safe(item.authors.map((author) => author.display_name || author.author_raw).join(', ') || 'Автор не определён')}</p></div>
    <div class="science-side"><span>${safe(item.publication_year || '')}</span><span>${safe(item.doi || item.venue || '')}</span></div>
  </button>`).join('') : '<div class="empty-state">Научные материалы по выбранным условиям не найдены.</div>';
}

async function loadScience() {
  const form = one('#science-search-form');
  const params = new URLSearchParams(new FormData(form));
  [...params].forEach(([key, value]) => { if (!value) params.delete(key); });
  const data = await rsApi(`/api/science?${params}`);
  rs.science = data.items || [];
  renderScience(rs.science);
}

async function showScience(id) {
  const item = await rsApi(`/api/science/${encodeURIComponent(id)}`);
  const inspector = one('#ux-inspector'); const body = one('#ux-inspector-body');
  if (!inspector || !body) return;
  body.innerHTML = `<section class="inspector-section"><div class="eyebrow">${safe(kindLabel(item.item_kind))}</div><h2>${safe(item.title)}</h2>
    <p>${safe(item.authors.map((author) => author.display_name || author.author_raw).join(', ') || 'Автор не определён')}</p>
    <p>${safe([item.venue, item.publication_year, item.doi].filter(Boolean).join(' · '))}</p>
    ${item.abstract_text ? `<p>${safe(item.abstract_text)}</p>` : ''}
    <div class="science-classifications">${item.classifications.map((entry) => `<span>${safe(entry.classification_value)}</span>`).join('')}</div>
    ${item.source_document_id ? `<button class="secondary-button" type="button" data-inspector-document="${safe(item.source_document_id)}">Открыть исходный документ</button>` : ''}
  </section>`;
  inspector.classList.remove('hidden'); one('#sheet-backdrop')?.classList.remove('hidden');
}

function renderReportMatches(items) {
  const panel = one('#report-match-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !items.length);
  one('#report-match-count').textContent = items.length;
  one('#report-match-list').innerHTML = items.map((match) => `<article class="report-match-card" data-report-match="${safe(match.id)}">
    <div><strong>${safe(match.document_title)}</strong><p>Возможная задача: ${safe(match.assignment_title)}</p><small>Совпадение ${Math.round(Number(match.score) * 100)}%${match.document_number ? ` · основание № ${safe(match.document_number)}` : ''}</small></div>
    <div class="report-match-actions"><button class="primary-button" type="button" data-match-action="accept">Приложить</button><button class="quiet-button" type="button" data-match-action="reject">Не относится</button></div>
  </article>`).join('');
}

async function loadReportMatches() {
  const data = await rsApi('/api/report-matches?status=suggested&limit=50');
  rs.matches = data.items || [];
  renderReportMatches(rs.matches);
}

document.addEventListener('click', async (event) => {
  const scienceButton = event.target.closest('[data-view="science"]');
  if (scienceButton) { event.preventDefault(); event.stopPropagation(); openScienceView(); }
  const scienceCard = event.target.closest('[data-science-id]');
  if (scienceCard) showScience(scienceCard.dataset.scienceId).catch(() => {});
  const actionButton = event.target.closest('[data-match-action]');
  if (actionButton) {
    const card = actionButton.closest('[data-report-match]');
    const action = actionButton.dataset.matchAction;
    await rsApi(`/api/report-matches/${encodeURIComponent(card.dataset.reportMatch)}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    await loadReportMatches();
    if (typeof window.loadWork === 'function') window.loadWork();
  }
}, true);

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'science-search-form') {
    event.preventDefault();
    await loadScience();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#science-search-form')) {
    clearTimeout(rs.scienceTimer); rs.scienceTimer = setTimeout(() => loadScience().catch(() => {}), 250);
  }
});

ensureReportsScienceUi();
loadReportMatches().catch(() => {});
setInterval(() => loadReportMatches().catch(() => {}), 30_000);
