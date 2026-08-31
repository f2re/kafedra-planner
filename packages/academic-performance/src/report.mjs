import { AppError } from '../../core/src/errors.mjs';
import { academicExport } from './service.mjs';

function problem(code, message, status = 400, details = undefined) {
  throw new AppError(code, message, status, details);
}

function uniqueIds(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
}

function selectedRuns(database, workspaceId, {
  importIds = [],
  academicYear = null,
  semester = null
} = {}) {
  const ids = uniqueIds(importIds);
  const clauses = [
    'agi.workspace_id = ?',
    "agi.processing_status IN ('completed', 'completed_with_review')",
    "agi.lifecycle_status = 'active'",
    'agi.is_current = 1'
  ];
  const params = [workspaceId];
  if (ids.length) {
    clauses.push(`agi.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (academicYear) {
    clauses.push('ap.academic_year = ?');
    params.push(String(academicYear));
  }
  if (semester !== null && semester !== undefined && semester !== '') {
    const value = Number(semester);
    if (![1, 2].includes(value)) {
      problem('academic_semester_invalid', 'Укажите первый или второй семестр.', 400, { semester });
    }
    clauses.push('ap.semester = ?');
    params.push(value);
  }
  const rows = database.all(`
    SELECT agi.id AS import_id, ag.code AS group_code,
      ap.academic_year, ap.semester
    FROM academic_grade_imports agi
    JOIN academic_groups ag ON ag.id = agi.group_id
    JOIN academic_periods ap ON ap.id = agi.period_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY CAST(substr(ap.academic_year, 1, 4) AS INTEGER) DESC,
      ap.semester, ag.code COLLATE NOCASE, agi.created_at DESC
  `, ...params).map((row) => ({ ...row, semester: Number(row.semester) }));
  if (ids.length) {
    const found = new Set(rows.map((row) => row.import_id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) {
      problem(
        'academic_totals_selection_invalid',
        'В сводку можно включить только актуальные успешно обработанные ведомости.',
        409,
        { importIds: missing }
      );
    }
  }
  return rows;
}

function aggregateRows(database, workspaceId, runs) {
  if (!runs.length) return [];
  const ids = runs.map((run) => run.import_id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = database.all(`
    SELECT agi.id AS import_id, ag.code AS group_code,
      ap.academic_year, ap.semester,
      ad.id AS discipline_id, ad.name AS discipline,
      COUNT(DISTINCT agr.membership_id) AS students_with_values,
      COUNT(agr.id) AS recorded_values,
      SUM(agr.grade_category = 'excellent') AS excellent,
      SUM(agr.grade_category = 'good') AS good,
      SUM(agr.grade_category = 'satisfactory') AS satisfactory,
      SUM(agr.grade_category = 'unsatisfactory') AS unsatisfactory,
      SUM(agr.grade_category = 'not_attested') AS not_attested,
      SUM(agr.grade_category = 'unknown') AS needs_review,
      COUNT(agr.numeric_value) AS numeric_count,
      COALESCE(SUM(agr.numeric_value), 0) AS numeric_sum
    FROM academic_grade_imports agi
    JOIN academic_groups ag ON ag.id = agi.group_id
    JOIN academic_periods ap ON ap.id = agi.period_id
    JOIN academic_grade_import_disciplines agid ON agid.import_id = agi.id
    JOIN academic_disciplines ad ON ad.id = agid.discipline_id
    LEFT JOIN academic_grade_records agr
      ON agr.import_id = agi.id AND agr.discipline_id = ad.id
    WHERE agi.workspace_id = ? AND agi.id IN (${placeholders})
    GROUP BY agi.id, ag.code, ap.academic_year, ap.semester, ad.id, ad.name
  `, workspaceId, ...ids);

  const aggregated = new Map();
  for (const row of rows) {
    const key = `${row.academic_year}\u0000${Number(row.semester)}\u0000${row.discipline_id}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        academic_year: row.academic_year,
        semester: Number(row.semester),
        discipline_id: row.discipline_id,
        discipline: row.discipline,
        import_ids: [],
        groups: [],
        group_count: 0,
        students_with_values: 0,
        recorded_values: 0,
        excellent: 0,
        good: 0,
        satisfactory: 0,
        unsatisfactory: 0,
        not_attested: 0,
        needs_review: 0,
        numeric_count: 0,
        numeric_sum: 0,
        average_grade: null
      });
    }
    const target = aggregated.get(key);
    target.import_ids.push(row.import_id);
    target.groups.push(row.group_code);
    target.students_with_values += Number(row.students_with_values || 0);
    target.recorded_values += Number(row.recorded_values || 0);
    target.excellent += Number(row.excellent || 0);
    target.good += Number(row.good || 0);
    target.satisfactory += Number(row.satisfactory || 0);
    target.unsatisfactory += Number(row.unsatisfactory || 0);
    target.not_attested += Number(row.not_attested || 0);
    target.needs_review += Number(row.needs_review || 0);
    target.numeric_count += Number(row.numeric_count || 0);
    target.numeric_sum += Number(row.numeric_sum || 0);
  }

  return [...aggregated.values()].map((row) => {
    row.import_ids = [...new Set(row.import_ids)];
    row.groups = [...new Set(row.groups)].sort((left, right) => left.localeCompare(right, 'ru'));
    row.group_count = row.groups.length;
    row.average_grade = row.numeric_count
      ? Number((row.numeric_sum / row.numeric_count).toFixed(2))
      : null;
    return row;
  }).sort((left, right) => {
    const leftYear = Number(String(left.academic_year).slice(0, 4));
    const rightYear = Number(String(right.academic_year).slice(0, 4));
    return rightYear - leftYear
      || left.semester - right.semester
      || left.discipline.localeCompare(right.discipline, 'ru');
  });
}

export function academicPeriodTotals(database, workspaceId, options = {}) {
  const runs = selectedRuns(database, workspaceId, options);
  const rows = aggregateRows(database, workspaceId, runs);
  const periods = [...new Map(runs.map((run) => [
    `${run.academic_year}:${run.semester}`,
    { academicYear: run.academic_year, semester: run.semester }
  ])).values()];
  return {
    generatedAt: new Date().toISOString(),
    scope: {
      importIds: runs.map((run) => run.import_id),
      groups: runs.map((run) => ({
        importId: run.import_id,
        groupCode: run.group_code,
        academicYear: run.academic_year,
        semester: run.semester
      })),
      periods
    },
    rows
  };
}

function csvCell(value) {
  const source = String(value ?? '');
  return /[;"\r\n]/u.test(source) ? `"${source.replaceAll('"', '""')}"` : source;
}

function localizedAverage(value) {
  return value === null || value === undefined
    ? ''
    : Number(value).toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
}

function totalsCsv(totals) {
  const header = [
    'Учебный год', 'Семестр', 'Группы', 'Дисциплина', 'Всего значений',
    'Отлично', 'Хорошо', 'Удовлетворительно', 'Неудовлетворительно',
    'Не аттестован', 'Требует проверки', 'Средний балл'
  ];
  const lines = [
    ['ИТОГИ ПО ДИСЦИПЛИНАМ'],
    header,
    ...totals.rows.map((row) => [
      row.academic_year,
      row.semester,
      row.groups.join(', '),
      row.discipline,
      row.recorded_values,
      row.excellent,
      row.good,
      row.satisfactory,
      row.unsatisfactory,
      row.not_attested,
      row.needs_review,
      localizedAverage(row.average_grade)
    ])
  ];
  return lines.map((line) => line.map(csvCell).join(';')).join('\r\n');
}

export function academicReportExport(database, workspaceId, importIds, format = 'csv') {
  const ids = uniqueIds(importIds);
  if (!ids.length) problem('academic_export_empty', 'Нет ведомостей для выгрузки.', 404);
  const totals = academicPeriodTotals(database, workspaceId, { importIds: ids });
  if (format === 'csv') {
    const base = academicExport(database, workspaceId, ids, 'csv');
    const detail = String(base.body || '').replace(/^\uFEFF/u, '').replace(/[\r\n]+$/u, '');
    return {
      ...base,
      body: `\uFEFF${detail}\r\n\r\n${totalsCsv(totals)}\r\n`
    };
  }
  if (format === 'json') {
    const base = academicExport(database, workspaceId, ids, 'json');
    const payload = JSON.parse(base.body);
    payload.report = {
      ...payload.report,
      selectedGroups: totals.scope.groups,
      totals: totals.rows
    };
    return { ...base, body: `${JSON.stringify(payload, null, 2)}\n` };
  }
  if (format === 'sources') {
    const base = academicExport(database, workspaceId, ids, 'sources');
    const payload = JSON.parse(base.body);
    payload.scope = totals.scope;
    return { ...base, body: `${JSON.stringify(payload, null, 2)}\n` };
  }
  problem('academic_export_format_invalid', 'Неизвестный формат выгрузки.', 400, { format });
}
