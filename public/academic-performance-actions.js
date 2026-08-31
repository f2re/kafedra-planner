import {
  $ap,
  academicApi,
  academicState,
  closeDetails,
  currentPeriodRuns,
  esc,
  gradeLabel,
  pageError,
  selectedRun,
  selectedTotalRuns
} from './academic-performance-state.js';
import { renderAcademicPerformance } from './academic-performance-view.js';

function totalPeriodKey(run = selectedRun()) {
  return run ? `${run.academic_year}:${Number(run.semester)}` : null;
}

export function syncAcademicTotalSelection({ reset = false } = {}) {
  const key = totalPeriodKey();
  const available = currentPeriodRuns().map((item) => item.id);
  if (!key || !available.length) {
    academicState.totalsPeriodKey = key;
    academicState.selectedTotalIds = [];
    academicState.totals = null;
    return;
  }
  const previous = academicState.totalsPeriodKey === key && !reset
    ? academicState.selectedTotalIds.filter((id) => available.includes(id))
    : [];
  academicState.totalsPeriodKey = key;
  academicState.selectedTotalIds = previous.length ? previous : available;
}

export async function refreshAcademicTotals() {
  const request = ++academicState.totalsRequest;
  const runs = selectedTotalRuns();
  if (!runs.length) {
    academicState.totalsLoading = false;
    academicState.totals = null;
    renderAcademicPerformance();
    return;
  }
  academicState.totalsLoading = true;
  renderAcademicPerformance();
  try {
    const query = new URLSearchParams({ importIds: runs.map((item) => item.id).join(',') });
    const payload = await academicApi(`/api/academic-performance/totals?${query}`);
    if (request === academicState.totalsRequest) academicState.totals = payload;
  } catch (error) {
    if (request === academicState.totalsRequest) {
      academicState.totals = null;
      pageError(error.message);
    }
  } finally {
    if (request === academicState.totalsRequest) {
      academicState.totalsLoading = false;
      renderAcademicPerformance();
    }
  }
}

export async function refreshAcademicPerformance(preferredId = null) {
  if (academicState.loading) return;
  academicState.loading = true;
  pageError('');
  try {
    const suffix = academicState.includeHistory ? '?includeHistory=1' : '';
    const payload = await academicApi(`/api/academic-performance${suffix}`);
    academicState.items = payload.items || [];
    academicState.hierarchy = payload.hierarchy || [];
    const candidate = preferredId || academicState.selectedId;
    academicState.selectedId = academicState.items.some((item) => item.id === candidate)
      ? candidate
      : academicState.hierarchy[0]?.semesters?.[0]?.groups?.[0]?.importId || null;
    syncAcademicTotalSelection();
    renderAcademicPerformance();
    await refreshAcademicTotals();
  } catch (error) {
    pageError(error.message);
  } finally {
    academicState.loading = false;
  }
}

export async function selectAcademicRun(importId) {
  if (!academicState.items.some((item) => item.id === importId)) return;
  academicState.selectedId = importId;
  syncAcademicTotalSelection();
  renderAcademicPerformance();
  await refreshAcademicTotals();
}

export async function setAcademicTotalSelection(importId, selected) {
  const available = new Set(currentPeriodRuns().map((item) => item.id));
  if (!available.has(importId)) return;
  const next = new Set(academicState.selectedTotalIds.filter((id) => available.has(id)));
  if (selected) next.add(importId);
  else next.delete(importId);
  academicState.selectedTotalIds = [...next];
  await refreshAcademicTotals();
}

export async function openAcademicDetails(disciplineId) {
  const run = selectedRun();
  if (!run) return;
  const target = $ap('[data-academic-details]');
  target.innerHTML = '<div class="academic-empty"><span>Загружаем исходные оценки…</span></div>';
  target.classList.remove('hidden');
  $ap('[data-academic-backdrop]')?.classList.remove('hidden');
  document.body.classList.add('academic-modal-open');
  try {
    const data = await academicApi(`/api/academic-performance/${encodeURIComponent(run.id)}/disciplines/${encodeURIComponent(disciplineId)}`);
    target.innerHTML = `
      <header class="academic-modal-head"><div><span>${esc(run.academic_year)} · ${run.semester} семестр · ${esc(run.group_code)}</span><h3 id="academic-details-title">${esc(data.discipline.name)}</h3></div><button class="icon-button" type="button" data-academic-details-close>×</button></header>
      <div class="academic-modal-body"><div class="academic-student-list">${data.items.map((item) => `
        <article data-status="${esc(item.status)}"><div><strong>${esc(item.display_name)}</strong><span>${item.status === 'empty' ? 'Пустая ячейка' : esc(item.raw_value)}</span></div><div><strong>${item.status === 'empty' ? 'Нет оценки' : esc(gradeLabel(item.grade_category, item.raw_value))}</strong><span>${esc(item.sheet_name)} · ${esc(item.cell_address)}</span></div>${item.review_message ? `<p>${esc(item.review_message)}</p>` : ''}</article>`).join('')}</div></div>`;
  } catch (error) {
    target.innerHTML = `<header class="academic-modal-head"><h3 id="academic-details-title">Ошибка</h3><button class="icon-button" type="button" data-academic-details-close>×</button></header><div class="academic-modal-body"><p class="academic-inline-error">${esc(error.message)}</p></div>`;
  }
}

export async function archiveSelectedAcademicRun() {
  const run = selectedRun();
  if (!run) return;
  pageError('');
  try {
    await academicApi(`/api/academic-performance/${encodeURIComponent(run.id)}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Архивировано оператором' })
    });
    academicState.selectedId = null;
    academicState.totalsPeriodKey = null;
    await refreshAcademicPerformance();
  } catch (error) {
    pageError(error.message);
  }
}

export async function restoreSelectedAcademicRun() {
  const run = selectedRun();
  if (!run) return;
  pageError('');
  try {
    const restored = await academicApi(`/api/academic-performance/${encodeURIComponent(run.id)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    academicState.includeHistory = false;
    academicState.totalsPeriodKey = null;
    await refreshAcademicPerformance(restored.id);
  } catch (error) {
    pageError(error.message);
  }
}

export function closeAcademicDetails() {
  closeDetails();
}
