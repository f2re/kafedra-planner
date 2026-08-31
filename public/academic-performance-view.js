import {
  $ap,
  academicState,
  average,
  currentPeriodRuns,
  esc,
  lifecycleLabel,
  selectedRun
} from './academic-performance-state.js';

function hierarchyMarkup() {
  if (!academicState.hierarchy.length) {
    return '<div class="academic-empty academic-empty-small"><strong>Ведомостей пока нет</strong><span>Загрузите XLSX, ODS или CSV.</span></div>';
  }
  return academicState.hierarchy.map((year, yearIndex) => `
    <details class="academic-year" ${yearIndex === 0 ? 'open' : ''}>
      <summary><strong>${esc(year.academicYear)}</strong><span>${year.semesters.reduce((sum, item) => sum + item.groups.length, 0)} групп</span></summary>
      <div class="academic-semesters">${year.semesters.map((semester) => `
        <section class="academic-semester">
          <header><strong>${semester.semester} семестр</strong><button class="academic-link-button" type="button" data-academic-export-period data-year="${esc(year.academicYear)}" data-semester="${semester.semester}">CSV</button></header>
          <div>${semester.groups.map((group) => `
            <button class="academic-group-button ${academicState.selectedId === group.importId ? 'active' : ''}" type="button" data-academic-run="${esc(group.importId)}">
              <span><strong>${esc(group.groupCode)}</strong><small>${group.totalStudents} студентов · ${group.disciplineCount} дисциплин</small></span>
              ${group.reviewCount ? `<b>${group.reviewCount}</b>` : '<i>✓</i>'}
            </button>`).join('')}</div>
        </section>`).join('')}</div>
    </details>`).join('');
}

function historyMarkup() {
  const history = academicState.items.filter((item) => !item.is_current || item.lifecycle_status !== 'active');
  if (!history.length) return '<div class="academic-empty academic-empty-small"><span>Предыдущих версий нет.</span></div>';
  return history.map((run) => `
    <button class="academic-history-item ${academicState.selectedId === run.id ? 'active' : ''}" type="button" data-academic-run="${esc(run.id)}">
      <span><strong>${esc(run.academic_year)} · ${run.semester} семестр · ${esc(run.group_code)}</strong><small>${esc(run.source_name)}</small></span>
      <em>${esc(lifecycleLabel(run.lifecycle_status))}</em>
    </button>`).join('');
}

function metadataMarkup(run) {
  const labels = { groupCode: 'Группа', academicYear: 'Учебный год', semester: 'Семестр' };
  return `<div class="academic-metadata-strip">${(run.metadata || []).map((item) => {
    const value = item.fieldKey === 'semester' ? `${item.value} семестр` : item.value;
    const source = item.sourceKind === 'cell'
      ? `${item.locator?.sheet || 'Лист'} · ${item.locator?.cell || 'ячейка'}`
      : 'введено вручную';
    return `<div><span>${labels[item.fieldKey] || item.fieldKey}</span><strong>${esc(value)}</strong><small>${esc(source)}</small></div>`;
  }).join('')}</div>`;
}

function issueMarkup(run) {
  const issues = run.issues || [];
  if (!issues.length) return '';
  return `<details class="academic-issues"><summary>Ошибки отдельных строк: ${issues.length}</summary><div>${issues.map((issue) => `
    <article><strong>${esc(issue.cell_address || `строка ${issue.row_no || '—'}`)}</strong><span>${esc(issue.message)}</span></article>`).join('')}</div></details>`;
}

function tableMarkup(rows, { totals = false } = {}) {
  if (!rows.length) {
    return '<div class="academic-empty academic-empty-small"><strong>Нет рассчитанных значений</strong><span>Пустые ячейки не считаются неаттестацией.</span></div>';
  }
  return `<div class="academic-table-wrap"><table class="academic-summary-table ${totals ? 'academic-totals-table' : ''}">
    <thead><tr><th>Дисциплина</th><th>Отлично</th><th>Хорошо</th><th>Удовл.</th><th>Неуд.</th><th>Не аттестован</th><th>Проверить</th><th>Средний балл</th></tr></thead>
    <tbody>${rows.map((row) => `<tr ${totals ? '' : `tabindex="0" data-academic-discipline="${esc(row.discipline_id)}"`}>
      <th><strong>${esc(row.discipline)}</strong><span>${totals ? `${esc((row.groups || []).join(', '))} · ` : ''}${row.recorded_values} значений</span></th>
      <td data-label="Отлично">${row.excellent}</td>
      <td data-label="Хорошо">${row.good}</td>
      <td data-label="Удовлетворительно">${row.satisfactory}</td>
      <td data-label="Неудовлетворительно">${row.unsatisfactory}</td>
      <td data-label="Не аттестован">${row.not_attested}</td>
      <td data-label="Проверить" class="${row.needs_review ? 'academic-review' : ''}">${row.needs_review}</td>
      <td data-label="Средний балл" class="academic-average">${average(row.average_grade)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function periodTotalsMarkup() {
  const run = selectedRun();
  const groups = currentPeriodRuns();
  if (!run || !groups.length) return '';
  const selected = new Set(academicState.selectedTotalIds);
  const rows = academicState.totals?.rows || [];
  let content;
  if (!selected.size) {
    content = '<div class="academic-empty academic-empty-small"><strong>Выберите хотя бы одну группу</strong><span>Итог рассчитывается только по отмеченным актуальным ведомостям.</span></div>';
  } else if (academicState.totalsLoading) {
    content = '<div class="academic-empty academic-empty-small" role="status"><span>Пересчитываем сводку по выбранным группам…</span></div>';
  } else {
    content = tableMarkup(rows, { totals: true });
  }
  return `
    <section class="academic-period-totals" aria-labelledby="academic-period-totals-title">
      <header class="academic-period-totals-head">
        <div><span>${esc(run.academic_year)} · ${run.semester} семестр</span><h4 id="academic-period-totals-title">Итоги по выбранным группам</h4><p>Используются только актуальные успешно обработанные ведомости. Средний балл взвешен по числу оценок.</p></div>
        <button class="secondary-button" type="button" data-academic-export-selected ${selected.size ? '' : 'disabled'}>Скачать выбранное</button>
      </header>
      <div class="academic-group-selectors" role="group" aria-label="Группы для общей сводки">${groups.map((item) => `
        <label class="academic-group-selector ${selected.has(item.id) ? 'selected' : ''}"><input type="checkbox" data-academic-total-import value="${esc(item.id)}" ${selected.has(item.id) ? 'checked' : ''}><span><strong>${esc(item.group_code)}</strong><small>${item.total_students} студентов</small></span></label>`).join('')}</div>
      ${content}
    </section>`;
}

function summaryMarkup() {
  const run = selectedRun();
  if (!run) return '<div class="academic-empty"><strong>Выберите учебную группу</strong><span>Сводка по дисциплинам появится здесь.</span></div>';
  const rows = run.summary || [];
  const total = rows.reduce((sum, row) => sum + row.recorded_values, 0);
  const review = rows.reduce((sum, row) => sum + row.needs_review, 0) + Number(run.issue_count || 0);
  const current = run.is_current && run.lifecycle_status === 'active';
  return `
    ${periodTotalsMarkup()}
    <section class="academic-group-summary">
      <header class="academic-summary-head">
        <div><span>${esc(run.academic_year)} · ${run.semester} семестр</span><h3>Группа ${esc(run.group_code)}</h3><p>${esc(run.source_name)} · ${esc(lifecycleLabel(run.lifecycle_status))}</p></div>
        <div class="academic-summary-actions">
          ${current ? '<button class="quiet-button" type="button" data-academic-archive>В архив</button>' : '<button class="secondary-button" type="button" data-academic-restore>Сделать актуальной</button>'}
          <button class="secondary-button" type="button" data-academic-export="csv">Скачать CSV</button>
          <button class="quiet-button" type="button" data-academic-export="json">JSON</button>
          <button class="quiet-button" type="button" data-academic-export="sources">Источники</button>
        </div>
      </header>
      ${metadataMarkup(run)}
      <div class="academic-metrics">
        <div><strong>${run.total_students}</strong><span>студентов</span></div>
        <div><strong>${rows.length}</strong><span>дисциплин</span></div>
        <div><strong>${total}</strong><span>оценок и неаттестаций</span></div>
        <div class="${review ? 'attention' : ''}"><strong>${review}</strong><span>требует проверки</span></div>
      </div>
      ${tableMarkup(rows)}
      ${issueMarkup(run)}
      <p class="academic-source-note">Средний балл рассчитан только по оценкам 2–5. Нажмите дисциплину, чтобы увидеть студентов и адреса исходных ячеек.</p>
    </section>`;
}

export function renderAcademicPerformance() {
  const hierarchy = $ap('[data-academic-hierarchy]');
  const history = $ap('[data-academic-history-list]');
  const summary = $ap('[data-academic-summary]');
  if (hierarchy) hierarchy.innerHTML = hierarchyMarkup();
  if (history) {
    history.innerHTML = historyMarkup();
    history.classList.toggle('hidden', !academicState.includeHistory);
  }
  if (summary) summary.innerHTML = summaryMarkup();
  const toggle = $ap('[data-academic-history]');
  if (toggle) toggle.textContent = academicState.includeHistory ? 'Скрыть историю' : 'История';
}
