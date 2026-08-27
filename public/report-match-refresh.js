const matchEscape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

async function refreshReportMatchesOnOpen() {
  const panel = document.querySelector('#report-match-panel');
  const list = document.querySelector('#report-match-list');
  const count = document.querySelector('#report-match-count');
  if (!panel || !list || !count) return;

  try {
    const response = await fetch('/api/report-matches?status=suggested&limit=50');
    if (!response.ok) return;
    const data = await response.json();
    const items = data.items || [];
    panel.classList.toggle('hidden', items.length === 0);
    count.textContent = String(items.length);
    list.innerHTML = items.map((match) => `<article class="report-match-card" data-report-match="${matchEscape(match.id)}">
      <div><strong>${matchEscape(match.document_title)}</strong><p>Возможная задача: ${matchEscape(match.assignment_title)}</p><small>Совпадение ${Math.round(Number(match.score) * 100)}%${match.document_number ? ` · основание № ${matchEscape(match.document_number)}` : ''}</small></div>
      <div class="report-match-actions"><button class="primary-button" type="button" data-match-action="accept">Приложить</button><button class="quiet-button" type="button" data-match-action="reject">Не относится</button></div>
    </article>`).join('');
  } catch {
    // Фоновое обновление не должно мешать основной работе раздела.
  }
}

function releaseInspectorBackdrop() {
  const inspector = document.querySelector('#ux-inspector');
  const openSheet = document.querySelector('.sheet:not(.hidden)');
  if (!inspector?.classList.contains('hidden') || openSheet) return;
  document.querySelector('#sheet-backdrop')?.classList.add('hidden');
  document.body.style.overflow = '';
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-view="work"]')) {
    setTimeout(() => refreshReportMatchesOnOpen(), 0);
  }
  if (event.target.closest('#ux-inspector-close')) {
    setTimeout(releaseInspectorBackdrop, 0);
  }
}, true);

window.refreshReportMatches = refreshReportMatchesOnOpen;
