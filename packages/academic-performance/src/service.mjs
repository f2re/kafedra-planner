import { createHash } from 'node:crypto';
import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import {
  cellOptions,
  cellsFromRow,
  clean,
  columnLetters,
  findCell,
  findTable,
  normalized,
  readTables,
  rowsAfter
} from './table.mjs';

const GRADE_CATEGORIES = Object.freeze({
  5: 'excellent',
  4: 'good',
  3: 'satisfactory',
  2: 'unsatisfactory'
});

const STUDENT_ALIASES = [
  'фио', 'ф и о', 'студент', 'обучающийся', 'слушатель',
  'фамилия имя отчество', 'фамилия и инициалы', 'student', 'student name', 'name'
];

const SERVICE_ALIASES = [
  '№', 'n', 'номер', 'п п', 'п/п', 'группа', 'код группы',
  'зачетная книжка', 'зачётная книжка', 'номер зачетной книжки',
  'номер зачётной книжки', 'student id', 'id', 'средний балл', 'итого',
  'задолженность', 'примечание', 'подпись', 'дата', 'курс', 'семестр', 'учебный год'
];

const METADATA_KEYS = ['groupCode', 'academicYear', 'semester'];

function problem(code, message, status = 400, details = undefined) {
  throw new AppError(code, message, status, details);
}

function text(value, max = 2000) {
  const result = clean(value);
  return result ? result.slice(0, max) : null;
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizedName(value) {
  return clean(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizedGroupKey(value) {
  return clean(value)
    .toLocaleUpperCase('ru-RU')
    .replace(/Ё/gu, 'Е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function sourceRow(database, workspaceId, documentId) {
  return database.get(`
    SELECT d.id AS document_id, d.title, dv.id AS version_id, dv.original_name,
      dv.detected_format, dv.processing_status, fb.storage_path, fb.sha256
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, documentId) || null;
}

function validateSource(source) {
  if (!source) problem('academic_document_not_found', 'Ведомость не найдена.', 404);
  if (!['processed', 'needs_review'].includes(source.processing_status)) {
    problem('academic_document_not_ready', 'Дождитесь завершения обработки ведомости.', 409, {
      status: source.processing_status
    });
  }
  const format = clean(source.detected_format || source.original_name?.split('.').at(-1)).toLowerCase();
  const extension = clean(source.original_name?.split('.').at(-1)).toLowerCase();
  if (!['xlsx', 'ods', 'csv', 'text'].includes(format) && !['csv', 'txt'].includes(extension)) {
    problem('academic_format_unsupported', 'Поддерживаются XLSX, ODS и CSV.', 400, {
      format,
      originalName: source.original_name
    });
  }
}

export function normalizeGrade(value) {
  const raw = clean(value);
  if (!raw || /^[—–-]+$/u.test(raw)) {
    return {
      kind: 'empty',
      raw,
      category: null,
      numericValue: null,
      rule: raw ? 'empty_marker' : 'empty'
    };
  }
  const candidate = raw
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[«»"']/gu, '')
    .replace(/[.,]0+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const compact = candidate.replace(/[\s/._-]+/gu, '');
  const numeric = candidate.match(/^[2-5](?:[.,]0+)?$/u)?.[0]?.[0];
  if (numeric) {
    const number = Number(numeric);
    return {
      kind: 'accepted',
      raw,
      category: GRADE_CATEGORIES[number],
      numericValue: number,
      rule: `numeric_${number}`
    };
  }

  const aliases = [
    ['excellent', 5, ['отлично', 'отл', 'отличная']],
    ['good', 4, ['хорошо', 'хор', 'хорошая']],
    ['satisfactory', 3, ['удовлетворительно', 'удовл', 'удовлетворительная']],
    ['unsatisfactory', 2, ['неудовлетворительно', 'неуд', 'неудовлетворительная']]
  ];
  for (const [category, numericValue, values] of aliases) {
    if (values.some((alias) => compact === alias.replace(/[\s/._-]+/gu, ''))) {
      return { kind: 'accepted', raw, category, numericValue, rule: `text_${category}` };
    }
  }

  const notAttested = [
    'н/а', 'н а', 'н.а.', 'н/атт', 'н атт', 'не аттестован', 'не аттестована',
    'неаттестован', 'неаттестована', 'не аттестация', 'неаттестация',
    'нет аттестации', 'не зачтено', 'незачтено', 'незачет', 'незачёт',
    'не допущен', 'не допущена', 'недопущен', 'недопущена',
    'неявка', 'не явился', 'не явилась'
  ];
  if (notAttested.some((alias) => compact === alias.replace(/ё/gu, 'е').replace(/[\s/._-]+/gu, ''))) {
    return {
      kind: 'accepted',
      raw,
      category: 'not_attested',
      numericValue: null,
      rule: 'text_not_attested'
    };
  }

  return {
    kind: 'review',
    raw,
    category: 'unknown',
    numericValue: null,
    rule: 'unrecognized',
    message: `Значение «${raw}» не распознано как оценка.`
  };
}

function normalizeGroupCode(value) {
  const raw = clean(value);
  if (!raw) problem('academic_group_required', 'Укажите учебную группу.');
  const labeled = raw.match(/(?:учебн(?:ая|ой)\s+)?групп(?:а|ы|е|у)?\s*[:№#-]?\s*(.+)$/iu)?.[1];
  const candidate = clean(labeled || raw)
    .toLocaleUpperCase('ru-RU')
    .replace(/Ё/gu, 'Е')
    .replace(/[–—]/gu, '-')
    .replace(/\s*[-/]\s*/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/^[№#:\s-]+|[,:;\s]+$/gu, '');
  if (!candidate || candidate.length > 100 || !/[\p{L}\p{N}]/u.test(candidate)) {
    problem('academic_group_invalid', 'Не удалось определить номер учебной группы.', 400, { value });
  }
  return { value: candidate, rule: labeled ? 'label_group' : 'group_value' };
}

function normalizeAcademicYear(value) {
  const raw = clean(value);
  const pair = raw.match(/((?:19|20|21)\d{2})\s*[/–—-]\s*((?:19|20|21)\d{2})/u);
  if (pair && Number(pair[2]) === Number(pair[1]) + 1) {
    return { value: `${pair[1]}/${pair[2]}`, rule: 'academic_year_pair' };
  }
  const single = raw.match(/(?:^|\D)((?:19|20|21)\d{2})(?:\D|$)/u)?.[1];
  if (single) {
    return { value: `${single}/${Number(single) + 1}`, rule: 'academic_year_start' };
  }
  problem('academic_year_invalid', 'Укажите учебный год в формате 2026/2027.', 400, { value });
}

function normalizeSemester(value) {
  const raw = clean(value).toLocaleLowerCase('ru-RU');
  const numeric = raw.match(/(?:^|\D)([12])(?:\D|$)/u)?.[1];
  if (numeric) return { value: Number(numeric), rule: 'semester_number' };
  const roman = raw.match(/(?:^|\s)(ii|i)(?:\s|$)/iu)?.[1]?.toLowerCase();
  if (roman) return { value: roman === 'ii' ? 2 : 1, rule: 'semester_roman' };
  problem('academic_semester_invalid', 'Укажите первый или второй семестр.', 400, { value });
}

function normalizeMetadataValue(fieldKey, value) {
  if (fieldKey === 'groupCode') return normalizeGroupCode(value);
  if (fieldKey === 'academicYear') return normalizeAcademicYear(value);
  if (fieldKey === 'semester') return normalizeSemester(value);
  problem('academic_metadata_field_invalid', 'Неизвестное метаполе ведомости.', 400, { fieldKey });
}

function aliasMatch(value, aliases) {
  const candidate = normalized(value);
  return aliases.some((alias) => {
    const expected = normalized(alias);
    return candidate === expected || candidate.includes(expected);
  });
}

function serviceHeader(value) {
  const candidate = normalized(value);
  return SERVICE_ALIASES.some((alias) => candidate === normalized(alias));
}

function followingRows(table, rowNo, limit = 16) {
  return rowsAfter(table, rowNo).slice(0, limit).map(([, row]) => row);
}

function headerCandidate(table, rowNo, row) {
  const cells = cellsFromRow(row).filter((cell) => cell.text);
  if (cells.length < 2) return null;
  const explicitStudent = cells.find((cell) => aliasMatch(cell.text, STUDENT_ALIASES));
  const nextRows = followingRows(table, rowNo);
  const evidence = new Map();
  for (const cell of cells) {
    let recognized = 0;
    let nonempty = 0;
    for (const next of nextRows) {
      const value = next.get(cell.column)?.text || '';
      if (!clean(value)) continue;
      nonempty += 1;
      if (normalizeGrade(value).kind === 'accepted') recognized += 1;
    }
    evidence.set(cell.column, { recognized, nonempty });
  }

  let studentCell = explicitStudent;
  if (!studentCell) {
    const firstGradeColumn = cells
      .filter((cell) => (evidence.get(cell.column)?.recognized || 0) > 0)
      .sort((left, right) => left.column - right.column)[0]?.column;
    if (firstGradeColumn) {
      studentCell = cells
        .filter((cell) => cell.column < firstGradeColumn && !serviceHeader(cell.text))
        .at(-1) || null;
    }
  }
  if (!studentCell) return null;

  const disciplines = cells
    .filter((cell) => cell.column > studentCell.column)
    .filter((cell) => !serviceHeader(cell.text))
    .map((cell) => ({
      column: cell.column,
      name: cell.text,
      cell: cell.cell,
      recognizedSamples: evidence.get(cell.column)?.recognized || 0,
      populatedSamples: evidence.get(cell.column)?.nonempty || 0
    }));
  if (!disciplines.length) return null;
  const evidenceScore = disciplines.reduce((sum, item) => sum + item.recognizedSamples, 0);
  return {
    score: (explicitStudent ? 100 : 20) + disciplines.length * 4 + evidenceScore * 3,
    headerRow: rowNo,
    studentColumn: studentCell.column,
    studentHeader: studentCell.text,
    disciplines
  };
}

function sheetPreview(table, candidate) {
  return rowsAfter(table, candidate.headerRow).slice(0, 12).map(([rowNo, row]) => ({
    row: rowNo,
    student: row.get(candidate.studentColumn)?.text || '',
    grades: candidate.disciplines.map((discipline) => ({
      column: discipline.column,
      name: discipline.name,
      value: row.get(discipline.column)?.text || '',
      cell: row.get(discipline.column)?.cell || `${columnLetters(discipline.column)}${rowNo}`
    }))
  }));
}

function analyzeSheet(table) {
  const candidates = [...table.rows.entries()]
    .filter(([rowNo]) => rowNo <= 50)
    .map(([rowNo, row]) => headerCandidate(table, rowNo, row))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.headerRow - right.headerRow);
  const candidate = candidates[0] || null;
  if (!candidate) {
    return { name: table.name, ready: false, headers: [], disciplines: [], preview: [] };
  }
  const header = table.rows.get(candidate.headerRow);
  return {
    name: table.name,
    ready: true,
    headerRow: candidate.headerRow,
    studentColumn: candidate.studentColumn,
    studentHeader: candidate.studentHeader,
    disciplines: candidate.disciplines,
    headers: cellsFromRow(header).map((cell) => ({
      column: cell.column,
      label: cell.text,
      cell: cell.cell
    })),
    preview: sheetPreview(table, candidate)
  };
}

function candidateFromCell(fieldKey, cell, { labeled = false, confidence = 60 } = {}) {
  try {
    const normalizedValue = normalizeMetadataValue(fieldKey, cell.text);
    return {
      fieldKey,
      value: normalizedValue.value,
      rawValue: cell.text,
      sourceKind: 'cell',
      sheetName: cell.sheetName,
      cell: cell.cell,
      row: cell.row,
      column: cell.column,
      locator: cell.locator,
      normalizationRule: normalizedValue.rule,
      confidence: labeled ? Math.max(confidence, 90) : confidence
    };
  } catch {
    return null;
  }
}

function metadataCandidates(tables) {
  const result = { groupCode: [], academicYear: [], semester: [] };
  const labels = {
    groupCode: ['группа', 'учебная группа', 'номер группы', 'код группы'],
    academicYear: ['учебный год', 'академический год'],
    semester: ['семестр']
  };
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate) return;
    const key = `${candidate.fieldKey}:${candidate.sheetName}:${candidate.cell}:${candidate.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    result[candidate.fieldKey].push(candidate);
  };

  for (const table of tables) {
    const orderedRows = [...table.rows.entries()].sort(([left], [right]) => left - right);
    for (const [rowNo, row] of orderedRows) {
      if (rowNo > 40) continue;
      for (const cell of cellsFromRow(row)) {
        const labelFields = METADATA_KEYS.filter((fieldKey) => aliasMatch(cell.text, labels[fieldKey]));
        for (const fieldKey of labelFields) {
          add(candidateFromCell(fieldKey, cell, { labeled: true, confidence: 94 }));
          const next = row.get(cell.column + 1);
          if (next) add(candidateFromCell(fieldKey, next, { labeled: true, confidence: 100 }));
          const below = table.rows.get(rowNo + 1)?.get(cell.column);
          if (below) add(candidateFromCell(fieldKey, below, { labeled: true, confidence: 92 }));
        }
        if (rowNo <= 16) {
          if (/(?:19|20|21)\d{2}\s*[/–—-]\s*(?:19|20|21)\d{2}/u.test(cell.text)) {
            add(candidateFromCell('academicYear', cell, { confidence: 78 }));
          }
          if (/семестр/iu.test(cell.text)) add(candidateFromCell('semester', cell, { confidence: 76 }));
          if (/[\p{L}]{1,12}[\s-]?\d{1,4}/u.test(cell.text) && !/семестр|курс|год/iu.test(cell.text)) {
            add(candidateFromCell('groupCode', cell, { confidence: 52 }));
          }
        }
      }
    }
  }

  for (const key of METADATA_KEYS) {
    result[key].sort((left, right) => right.confidence - left.confidence
      || left.sheetName.localeCompare(right.sheetName, 'ru')
      || left.row - right.row);
  }
  return result;
}

export async function analyzeAcademicPerformance(database, workspaceId, documentId) {
  const source = sourceRow(database, workspaceId, documentId);
  validateSource(source);
  const tables = await readTables(database, source);
  const sheets = tables.map(analyzeSheet);
  const preferred = sheets
    .filter((sheet) => sheet.ready)
    .sort((left, right) => right.disciplines.length - left.disciplines.length)[0] || null;
  const candidates = metadataCandidates(tables);
  return {
    source: {
      documentId: source.document_id,
      versionId: source.version_id,
      originalName: source.original_name,
      format: source.detected_format,
      sha256: source.sha256
    },
    ready: Boolean(preferred),
    preferredSheet: preferred?.name || null,
    sheets,
    metadata: Object.fromEntries(METADATA_KEYS.map((fieldKey) => [fieldKey, {
      preferred: candidates[fieldKey][0] || null,
      candidates: candidates[fieldKey]
    }])),
    cellOptions: cellOptions(tables)
  };
}

function validateProfile(input = {}) {
  const profile = {
    sheetName: text(input.sheetName, 300),
    headerRow: Number(input.headerRow),
    studentColumn: Number(input.studentColumn),
    disciplines: Array.isArray(input.disciplines)
      ? input.disciplines.map((item) => ({
        column: Number(item.column),
        name: text(item.name, 500)
      }))
      : []
  };
  if (!profile.sheetName) problem('academic_sheet_required', 'Выберите лист с оценками.');
  if (!Number.isInteger(profile.headerRow) || profile.headerRow < 1) {
    problem('academic_header_row_invalid', 'Укажите строку заголовков.');
  }
  if (!Number.isInteger(profile.studentColumn) || profile.studentColumn < 1) {
    problem('academic_student_column_invalid', 'Выберите колонку со студентами.');
  }
  profile.disciplines = profile.disciplines.filter(
    (item) => Number.isInteger(item.column) && item.column > 0 && item.name
  );
  if (!profile.disciplines.length) problem('academic_disciplines_required', 'Выберите хотя бы одну дисциплину.');
  if (profile.disciplines.some((item) => item.column === profile.studentColumn)) {
    problem('academic_student_column_conflict', 'Колонка со студентом не может быть дисциплиной.');
  }
  const columns = new Set();
  const names = new Set();
  for (const item of profile.disciplines) {
    if (columns.has(item.column)) problem('academic_discipline_column_duplicate', 'Колонка дисциплины выбрана дважды.');
    const nameKey = normalizedName(item.name);
    if (names.has(nameKey)) problem('academic_discipline_name_duplicate', 'Название дисциплины повторяется.', 400, { name: item.name });
    columns.add(item.column);
    names.add(nameKey);
  }
  return profile;
}

function resolveMetadataBinding(tables, fieldKey, input = {}) {
  const mode = input.mode === 'cell' ? 'cell' : input.mode === 'manual' ? 'manual' : null;
  if (!mode) problem('academic_metadata_mode_required', 'Выберите источник метаполя.', 400, { fieldKey });
  let rawValue;
  let locator;
  if (mode === 'cell') {
    const sheetName = text(input.sheetName, 300);
    const cellAddress = text(input.cell, 30)?.toUpperCase();
    if (!sheetName || !cellAddress) {
      problem('academic_metadata_cell_required', 'Укажите лист и ячейку метаполя.', 400, { fieldKey });
    }
    const cell = findCell(tables, sheetName, cellAddress);
    if (!cell || !cell.text) {
      problem('academic_metadata_cell_empty', 'В выбранной ячейке нет значения.', 400, {
        fieldKey,
        sheetName,
        cell: cellAddress
      });
    }
    rawValue = cell.text;
    locator = cell.locator;
  } else {
    rawValue = text(input.value, 500);
    if (!rawValue) problem('academic_metadata_manual_required', 'Введите значение метаполя.', 400, { fieldKey });
    locator = { kind: 'manual_academic_metadata', field: fieldKey };
  }
  const normalizedValue = normalizeMetadataValue(fieldKey, rawValue);
  return {
    fieldKey,
    value: normalizedValue.value,
    rawValue,
    sourceKind: mode,
    locator,
    normalizationRule: normalizedValue.rule
  };
}

function resolveMetadata(tables, input = {}) {
  return Object.fromEntries(METADATA_KEYS.map((fieldKey) => [
    fieldKey,
    resolveMetadataBinding(tables, fieldKey, input[fieldKey])
  ]));
}

function ensureGroup(database, workspaceId, code, now) {
  const key = normalizedGroupKey(code);
  const existing = database.get(
    'SELECT * FROM academic_groups WHERE workspace_id = ? AND normalized_code = ?',
    workspaceId,
    key
  );
  if (existing) return existing;
  const id = newId('acgroup');
  database.run(`
    INSERT INTO academic_groups(id, workspace_id, code, normalized_code, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, id, workspaceId, code, key, code, now, now);
  return database.get('SELECT * FROM academic_groups WHERE id = ?', id);
}

function ensurePeriod(database, workspaceId, academicYear, semester, now) {
  const existing = database.get(`
    SELECT * FROM academic_periods
    WHERE workspace_id = ? AND academic_year = ? AND semester = ?
  `, workspaceId, academicYear, semester);
  if (existing) return existing;
  const id = newId('acperiod');
  database.run(`
    INSERT INTO academic_periods(id, workspace_id, academic_year, semester, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, id, workspaceId, academicYear, semester, now);
  return database.get('SELECT * FROM academic_periods WHERE id = ?', id);
}

function ensureDiscipline(database, workspaceId, name, now) {
  const key = normalizedName(name);
  const existing = database.get(`
    SELECT * FROM academic_disciplines WHERE workspace_id = ? AND normalized_name = ?
  `, workspaceId, key);
  if (existing) return existing;
  const id = newId('acdisc');
  database.run(`
    INSERT INTO academic_disciplines(id, workspace_id, name, normalized_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, id, workspaceId, name, key, now, now);
  return database.get('SELECT * FROM academic_disciplines WHERE id = ?', id);
}

function ensureMembership(database, {
  workspaceId,
  groupId,
  periodId,
  studentName,
  sourceVersionId,
  locator,
  now
}) {
  const displayName = text(studentName, 500);
  const sourceKey = normalizedName(displayName);
  if (!displayName || !sourceKey) problem('academic_student_name_required', 'В строке не указано имя студента.');
  const existing = database.get(`
    SELECT agm.*, ast.display_name
    FROM academic_group_memberships agm
    JOIN academic_students ast ON ast.id = agm.student_id
    WHERE agm.group_id = ? AND agm.period_id = ? AND agm.source_student_key = ?
  `, groupId, periodId, sourceKey);
  if (existing) return existing;
  const studentId = newId('acstudent');
  database.run(`
    INSERT INTO academic_students(id, workspace_id, display_name, normalized_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, studentId, workspaceId, displayName, sourceKey, now, now);
  const membershipId = newId('acmember');
  database.run(`
    INSERT INTO academic_group_memberships(
      id, workspace_id, group_id, period_id, student_id, source_student_key,
      source_document_version_id, source_locator_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, membershipId, workspaceId, groupId, periodId, studentId, sourceKey,
  sourceVersionId, JSON.stringify(locator || {}), now);
  return database.get(`
    SELECT agm.*, ast.display_name
    FROM academic_group_memberships agm
    JOIN academic_students ast ON ast.id = agm.student_id
    WHERE agm.id = ?
  `, membershipId);
}

function insertIssue(database, importId, issue, now) {
  database.run(`
    INSERT INTO academic_grade_import_issues(
      id, import_id, code, message, sheet_name, cell_address, row_no, column_no,
      raw_value, source_locator_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('acissue'), importId, issue.code, issue.message, issue.sheetName || null,
  issue.cellAddress || null, issue.rowNo || null, issue.columnNo || null,
  issue.rawValue || null, JSON.stringify(issue.locator || {}), now);
}

function importCounts(database, importId) {
  return {
    accepted: Number(database.get(`
      SELECT COUNT(*) AS n FROM academic_grade_records WHERE import_id = ? AND status = 'accepted'
    `, importId)?.n || 0),
    review: Number(database.get(`
      SELECT COUNT(*) AS n FROM academic_grade_records WHERE import_id = ? AND status = 'needs_review'
    `, importId)?.n || 0),
    issues: Number(database.get(`
      SELECT COUNT(*) AS n FROM academic_grade_import_issues WHERE import_id = ?
    `, importId)?.n || 0),
    students: Number(database.get(`
      SELECT COUNT(*) AS n FROM academic_grade_import_students WHERE import_id = ?
    `, importId)?.n || 0)
  };
}

function processRows(database, context) {
  const {
    workspaceId,
    source,
    profile,
    table,
    group,
    period,
    disciplines,
    importId,
    now
  } = context;
  let emptyCells = 0;

  for (const [rowNo, row] of rowsAfter(table, profile.headerRow)) {
    const studentCell = row.get(profile.studentColumn) || null;
    const studentName = studentCell?.text || '';
    const nonemptyGrades = profile.disciplines.some((discipline) => clean(row.get(discipline.column)?.text));
    if (!studentName && !nonemptyGrades) continue;
    if (!studentName) {
      database.transaction(() => insertIssue(database, importId, {
        code: 'student_name_missing',
        message: 'В строке есть оценки, но не указано имя студента.',
        sheetName: table.name,
        rowNo,
        locator: { kind: 'academic_row', sheet: table.name, row: rowNo }
      }, now));
      continue;
    }

    let membership;
    try {
      database.transaction(() => {
        const fallbackCell = `${columnLetters(profile.studentColumn)}${rowNo}`;
        membership = ensureMembership(database, {
          workspaceId,
          groupId: group.id,
          periodId: period.id,
          studentName,
          sourceVersionId: source.version_id,
          locator: studentCell?.locator || {
            kind: 'academic_student_cell',
            sheet: table.name,
            row: rowNo,
            column: profile.studentColumn,
            cell: fallbackCell
          },
          now
        });
        database.run(`
          INSERT INTO academic_grade_import_students(
            id, import_id, membership_id, sheet_name, row_no, student_cell_address,
            source_locator_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, newId('acrunstudent'), importId, membership.id, table.name, rowNo,
        studentCell?.cell || fallbackCell, JSON.stringify(studentCell?.locator || {}), now);
      });
    } catch (error) {
      database.transaction(() => insertIssue(database, importId, {
        code: /UNIQUE constraint failed/u.test(String(error?.message || error))
          ? 'duplicate_student_row'
          : 'student_row_failed',
        message: /UNIQUE constraint failed/u.test(String(error?.message || error))
          ? `Студент «${studentName}» встречается в ведомости повторно.`
          : `Не удалось обработать студента «${studentName}».`,
        sheetName: table.name,
        cellAddress: studentCell?.cell || `${columnLetters(profile.studentColumn)}${rowNo}`,
        rowNo,
        columnNo: profile.studentColumn,
        rawValue: studentName,
        locator: studentCell?.locator || {}
      }, now));
      continue;
    }

    for (const discipline of profile.disciplines) {
      const cell = row.get(discipline.column) || {
        text: '',
        row: rowNo,
        column: discipline.column,
        cell: `${columnLetters(discipline.column)}${rowNo}`,
        locator: {
          kind: 'academic_empty_cell',
          sheet: table.name,
          row: rowNo,
          column: discipline.column,
          cell: `${columnLetters(discipline.column)}${rowNo}`
        }
      };
      const grade = normalizeGrade(cell.text);
      if (grade.kind === 'empty') {
        emptyCells += 1;
        continue;
      }
      try {
        database.transaction(() => database.run(`
          INSERT INTO academic_grade_records(
            id, workspace_id, import_id, membership_id, discipline_id, raw_value,
            grade_category, numeric_value, normalization_rule, status, review_message,
            sheet_name, cell_address, row_no, column_no, source_locator_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, newId('acgrade'), workspaceId, importId, membership.id,
        disciplines.get(discipline.column).id, grade.raw, grade.category, grade.numericValue,
        grade.rule, grade.kind === 'review' ? 'needs_review' : 'accepted', grade.message || null,
        table.name, cell.cell, rowNo, discipline.column, JSON.stringify(cell.locator || {}), now));
      } catch (error) {
        database.transaction(() => insertIssue(database, importId, {
          code: /UNIQUE constraint failed/u.test(String(error?.message || error))
            ? 'duplicate_grade'
            : 'grade_cell_failed',
          message: 'Не удалось сохранить значение этой ячейки.',
          sheetName: table.name,
          cellAddress: cell.cell,
          rowNo,
          columnNo: discipline.column,
          rawValue: cell.text,
          locator: cell.locator
        }, now));
      }
    }
  }

  const counts = importCounts(database, importId);
  const processingStatus = counts.review || counts.issues
    ? 'completed_with_review'
    : 'completed';
  const completedAt = new Date().toISOString();
  database.transaction(() => {
    database.run(`
      UPDATE academic_grade_imports
      SET is_current = 0, lifecycle_status = 'superseded', superseded_by_import_id = ?, updated_at = ?
      WHERE workspace_id = ? AND group_id = ? AND period_id = ?
        AND is_current = 1 AND id <> ?
    `, importId, completedAt, workspaceId, group.id, period.id, importId);
    database.run(`
      UPDATE academic_grade_imports
      SET processing_status = ?, lifecycle_status = 'active', is_current = 1,
        total_students = ?, accepted_cells = ?, review_cells = ?, empty_cells = ?,
        issue_count = ?, updated_at = ?, completed_at = ?, error_message = NULL
      WHERE id = ?
    `, processingStatus, counts.students, counts.accepted, counts.review, emptyCells,
    counts.issues, completedAt, completedAt, importId);
  });
}

function metadataRows(database, importId) {
  return database.all(`
    SELECT field_key, normalized_value, raw_value, source_kind,
      source_locator_json, normalization_rule
    FROM academic_grade_import_metadata
    WHERE import_id = ? ORDER BY field_key
  `, importId).map((item) => ({
    fieldKey: item.field_key,
    value: item.field_key === 'semester' ? Number(item.normalized_value) : item.normalized_value,
    rawValue: item.raw_value,
    sourceKind: item.source_kind,
    locator: parseJson(item.source_locator_json),
    normalizationRule: item.normalization_rule
  }));
}

export function academicSummary(database, workspaceId, importIds) {
  const ids = Array.isArray(importIds) ? importIds.filter(Boolean) : [importIds].filter(Boolean);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return database.all(`
    SELECT agi.id AS import_id, ad.id AS discipline_id, ad.name AS discipline,
      ag.code AS group_code, ap.academic_year, ap.semester,
      COUNT(DISTINCT agr.membership_id) AS students_with_values,
      SUM(agr.grade_category = 'excellent') AS excellent,
      SUM(agr.grade_category = 'good') AS good,
      SUM(agr.grade_category = 'satisfactory') AS satisfactory,
      SUM(agr.grade_category = 'unsatisfactory') AS unsatisfactory,
      SUM(agr.grade_category = 'not_attested') AS not_attested,
      SUM(agr.grade_category = 'unknown') AS needs_review,
      COUNT(agr.id) AS recorded_values,
      ROUND(AVG(agr.numeric_value), 2) AS average_grade
    FROM academic_grade_imports agi
    JOIN academic_groups ag ON ag.id = agi.group_id
    JOIN academic_periods ap ON ap.id = agi.period_id
    JOIN academic_grade_import_disciplines agid ON agid.import_id = agi.id
    JOIN academic_disciplines ad ON ad.id = agid.discipline_id
    LEFT JOIN academic_grade_records agr
      ON agr.import_id = agi.id AND agr.discipline_id = ad.id
    WHERE agi.workspace_id = ? AND agi.id IN (${placeholders})
    GROUP BY agi.id, ad.id, ad.name, ag.code, ap.academic_year, ap.semester, agid.source_column
    ORDER BY CAST(substr(ap.academic_year, 1, 4) AS INTEGER) DESC,
      ap.semester, ag.code COLLATE NOCASE, agid.source_column
  `, workspaceId, ...ids).map((row) => ({
    ...row,
    semester: Number(row.semester),
    students_with_values: Number(row.students_with_values || 0),
    excellent: Number(row.excellent || 0),
    good: Number(row.good || 0),
    satisfactory: Number(row.satisfactory || 0),
    unsatisfactory: Number(row.unsatisfactory || 0),
    not_attested: Number(row.not_attested || 0),
    needs_review: Number(row.needs_review || 0),
    recorded_values: Number(row.recorded_values || 0),
    average_grade: row.average_grade === null ? null : Number(row.average_grade)
  }));
}

export function getAcademicImport(database, workspaceId, importId) {
  const row = database.get(`
    SELECT agi.*, ag.code AS group_code, ag.name AS group_name,
      ap.academic_year, ap.semester,
      dv.document_id AS source_document_id, dv.original_name,
      fb.sha256 AS source_sha256
    FROM academic_grade_imports agi
    JOIN academic_groups ag ON ag.id = agi.group_id
    JOIN academic_periods ap ON ap.id = agi.period_id
    JOIN document_versions dv ON dv.id = agi.source_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE agi.workspace_id = ? AND agi.id = ?
  `, workspaceId, importId);
  if (!row) return null;
  return {
    ...row,
    semester: Number(row.semester),
    is_current: Boolean(row.is_current),
    profile: parseJson(row.profile_json),
    metadata: metadataRows(database, importId),
    summary: academicSummary(database, workspaceId, importId),
    issues: database.all(`
      SELECT * FROM academic_grade_import_issues
      WHERE import_id = ? ORDER BY row_no, column_no, created_at
    `, importId).map((item) => ({ ...item, locator: parseJson(item.source_locator_json) }))
  };
}

export function listAcademicImports(database, workspaceId, {
  includeHistory = false,
  academicYear = null,
  semester = null,
  groupCode = null,
  limit = 500
} = {}) {
  const clauses = ['agi.workspace_id = ?'];
  const params = [workspaceId];
  if (!includeHistory) clauses.push("agi.lifecycle_status = 'active'", 'agi.is_current = 1');
  if (academicYear) {
    clauses.push('ap.academic_year = ?');
    params.push(academicYear);
  }
  if (semester) {
    clauses.push('ap.semester = ?');
    params.push(Number(semester));
  }
  if (groupCode) {
    clauses.push('ag.normalized_code = ?');
    params.push(normalizedGroupKey(groupCode));
  }
  params.push(Math.max(1, Math.min(1000, Number(limit) || 500)));
  const ids = database.all(`
    SELECT agi.id
    FROM academic_grade_imports agi
    JOIN academic_groups ag ON ag.id = agi.group_id
    JOIN academic_periods ap ON ap.id = agi.period_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY CAST(substr(ap.academic_year, 1, 4) AS INTEGER) DESC,
      ap.semester, ag.code COLLATE NOCASE, agi.created_at DESC
    LIMIT ?
  `, ...params);
  return ids.map((item) => getAcademicImport(database, workspaceId, item.id));
}

export function academicHierarchy(runs) {
  const years = new Map();
  for (const run of runs) {
    if (!years.has(run.academic_year)) years.set(run.academic_year, new Map());
    const semesters = years.get(run.academic_year);
    if (!semesters.has(run.semester)) semesters.set(run.semester, []);
    semesters.get(run.semester).push({
      importId: run.id,
      groupCode: run.group_code,
      groupName: run.group_name,
      status: run.processing_status,
      totalStudents: run.total_students,
      disciplineCount: run.discipline_count,
      reviewCount: run.review_cells + run.issue_count,
      sourceName: run.source_name
    });
  }
  return [...years.entries()]
    .sort(([left], [right]) => Number(right.slice(0, 4)) - Number(left.slice(0, 4)))
    .map(([academicYear, semesters]) => ({
      academicYear,
      semesters: [...semesters.entries()]
        .sort(([left], [right]) => left - right)
        .map(([semester, groups]) => ({
          semester,
          groups: groups.sort((left, right) => left.groupCode.localeCompare(right.groupCode, 'ru'))
        }))
    }));
}

export async function importAcademicPerformance(database, workspaceId, input = {}, actorPersonId = null) {
  const source = sourceRow(database, workspaceId, input.documentId);
  validateSource(source);
  const profile = validateProfile(input.profile);
  const idempotencyKey = text(input.idempotencyKey, 500);
  if (!idempotencyKey) problem('academic_idempotency_required', 'Не удалось определить ключ безопасного повтора.');

  const tables = await readTables(database, source);
  const table = findTable(tables, profile.sheetName);
  if (!table) problem('academic_sheet_not_found', 'Выбранный лист не найден.', 400, { sheetName: profile.sheetName });
  const header = table.rows.get(profile.headerRow);
  if (!header) problem('academic_header_not_found', 'Строка заголовков не найдена.');
  if (!header.get(profile.studentColumn)) problem('academic_student_header_not_found', 'Колонка со студентами не найдена.');
  for (const discipline of profile.disciplines) {
    if (!header.get(discipline.column)) {
      problem('academic_discipline_header_not_found', 'Колонка дисциплины не найдена.', 400, {
        column: discipline.column
      });
    }
  }
  const metadata = resolveMetadata(tables, input.metadata || {});
  const groupCode = metadata.groupCode.value;
  const academicYear = metadata.academicYear.value;
  const semester = metadata.semester.value;
  const profileSnapshot = { mapping: profile, metadata: input.metadata || {} };
  const profileHash = hash(profileSnapshot);
  const requestHash = hash({
    sourceDocumentVersionId: source.version_id,
    profile: profileSnapshot,
    resolvedMetadata: Object.fromEntries(METADATA_KEYS.map((key) => [key, metadata[key].value]))
  });

  const existingByKey = database.get(`
    SELECT id, request_hash, processing_status FROM academic_grade_imports
    WHERE workspace_id = ? AND idempotency_key = ?
  `, workspaceId, idempotencyKey);
  if (existingByKey) {
    if (existingByKey.request_hash !== requestHash) {
      problem('academic_idempotency_conflict', 'Параметры повторного импорта отличаются от исходных.', 409, {
        importId: existingByKey.id
      });
    }
    if (existingByKey.processing_status !== 'failed') {
      return getAcademicImport(database, workspaceId, existingByKey.id);
    }
  }
  const retryImportId = existingByKey?.processing_status === 'failed' ? existingByKey.id : null;

  const now = new Date().toISOString();
  let importId;
  let group;
  let period;
  let created = false;
  database.transaction(() => {
    group = ensureGroup(database, workspaceId, groupCode, now);
    period = ensurePeriod(database, workspaceId, academicYear, semester, now);
    if (retryImportId) {
      importId = retryImportId;
      created = true;
      database.run('DELETE FROM academic_grade_records WHERE import_id = ?', importId);
      database.run('DELETE FROM academic_grade_import_issues WHERE import_id = ?', importId);
      database.run('DELETE FROM academic_grade_import_students WHERE import_id = ?', importId);
      database.run('DELETE FROM academic_grade_import_disciplines WHERE import_id = ?', importId);
      database.run('DELETE FROM academic_grade_import_metadata WHERE import_id = ?', importId);
      database.run(`
        UPDATE academic_grade_imports
        SET source_document_version_id = ?, source_name = ?, group_id = ?, period_id = ?,
          request_hash = ?, profile_hash = ?, processing_status = 'running', lifecycle_status = 'active',
          is_current = 0, superseded_by_import_id = NULL, profile_json = ?, discipline_count = ?,
          total_students = 0, accepted_cells = 0, review_cells = 0, empty_cells = 0,
          issue_count = 0, error_message = NULL, archived_at = NULL, archived_by_person_id = NULL,
          archive_reason = NULL, updated_at = ?, completed_at = NULL
        WHERE workspace_id = ? AND id = ?
      `, source.version_id, source.original_name, group.id, period.id, requestHash, profileHash,
      JSON.stringify(profileSnapshot), profile.disciplines.length, now, workspaceId, importId);
      for (const fieldKey of METADATA_KEYS) {
        const binding = metadata[fieldKey];
        database.run(`
          INSERT INTO academic_grade_import_metadata(
            id, import_id, field_key, normalized_value, raw_value, source_kind,
            source_locator_json, normalization_rule, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, newId('acmeta'), importId, fieldKey, String(binding.value), binding.rawValue,
        binding.sourceKind, JSON.stringify(binding.locator || {}), binding.normalizationRule, now);
      }
      return;
    }
    const equivalent = database.get(`
      SELECT id, request_hash FROM academic_grade_imports
      WHERE workspace_id = ? AND source_document_version_id = ?
        AND group_id = ? AND period_id = ? AND profile_hash = ?
    `, workspaceId, source.version_id, group.id, period.id, profileHash);
    if (equivalent) {
      if (equivalent.request_hash !== requestHash) {
        problem('academic_import_conflict', 'Эта версия ведомости уже импортирована с другим профилем.', 409, {
          importId: equivalent.id
        });
      }
      importId = equivalent.id;
      return;
    }
    importId = newId('acimport');
    created = true;
    database.run(`
      INSERT INTO academic_grade_imports(
        id, workspace_id, source_document_version_id, source_name, group_id, period_id,
        idempotency_key, request_hash, profile_hash, processing_status,
        lifecycle_status, is_current, profile_json, discipline_count,
        created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 'active', 0, ?, ?, ?, ?, ?)
    `, importId, workspaceId, source.version_id, source.original_name, group.id, period.id,
    idempotencyKey, requestHash, profileHash, JSON.stringify(profileSnapshot),
    profile.disciplines.length, actorPersonId, now, now);
    for (const fieldKey of METADATA_KEYS) {
      const binding = metadata[fieldKey];
      database.run(`
        INSERT INTO academic_grade_import_metadata(
          id, import_id, field_key, normalized_value, raw_value, source_kind,
          source_locator_json, normalization_rule, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, newId('acmeta'), importId, fieldKey, String(binding.value), binding.rawValue,
      binding.sourceKind, JSON.stringify(binding.locator || {}), binding.normalizationRule, now);
    }
  });
  if (!created) return getAcademicImport(database, workspaceId, importId);

  const disciplines = new Map();
  try {
    database.transaction(() => {
      for (const discipline of profile.disciplines) {
        const entity = ensureDiscipline(database, workspaceId, discipline.name, now);
        disciplines.set(discipline.column, entity);
        database.run(`
          INSERT INTO academic_grade_import_disciplines(
            id, import_id, discipline_id, source_column, source_name,
            source_header_cell, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, newId('acrundisc'), importId, entity.id, discipline.column, discipline.name,
        header.get(discipline.column)?.cell || `${columnLetters(discipline.column)}${profile.headerRow}`,
        now);
      }
    });
    processRows(database, {
      workspaceId,
      source,
      profile,
      table,
      group,
      period,
      disciplines,
      importId,
      now
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    database.run(`
      UPDATE academic_grade_imports
      SET processing_status = 'failed', is_current = 0, error_message = ?,
        updated_at = ?, completed_at = ? WHERE id = ?
    `, String(error?.code || error?.message || error), failedAt, failedAt, importId);
    throw error;
  }
  return getAcademicImport(database, workspaceId, importId);
}

export function archiveAcademicImport(database, workspaceId, importId, actorPersonId, reason = null) {
  const current = getAcademicImport(database, workspaceId, importId);
  if (!current) problem('academic_import_not_found', 'Ведомость не найдена.', 404);
  if (current.lifecycle_status === 'archived') return current;
  const now = new Date().toISOString();
  database.run(`
    UPDATE academic_grade_imports
    SET lifecycle_status = 'archived', is_current = 0, archived_at = ?,
      archived_by_person_id = ?, archive_reason = ?, updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `, now, actorPersonId, text(reason, 1000), now, workspaceId, importId);
  return getAcademicImport(database, workspaceId, importId);
}

export function restoreAcademicImport(database, workspaceId, importId, actorPersonId) {
  const current = getAcademicImport(database, workspaceId, importId);
  if (!current) problem('academic_import_not_found', 'Ведомость не найдена.', 404);
  if (!['completed', 'completed_with_review'].includes(current.processing_status)) {
    problem('academic_restore_unavailable', 'Восстановить можно только успешно обработанную ведомость.', 409);
  }
  const now = new Date().toISOString();
  database.transaction(() => {
    database.run(`
      UPDATE academic_grade_imports
      SET is_current = 0, lifecycle_status = 'superseded', superseded_by_import_id = ?, updated_at = ?
      WHERE workspace_id = ? AND group_id = ? AND period_id = ?
        AND is_current = 1 AND id <> ?
    `, importId, now, workspaceId, current.group_id, current.period_id, importId);
    database.run(`
      UPDATE academic_grade_imports
      SET lifecycle_status = 'active', is_current = 1, superseded_by_import_id = NULL,
        archived_at = NULL, archived_by_person_id = NULL, archive_reason = NULL, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, now, workspaceId, importId);
  });
  return getAcademicImport(database, workspaceId, importId);
}

export function academicDisciplineDetails(database, workspaceId, importId, disciplineId) {
  const run = getAcademicImport(database, workspaceId, importId);
  if (!run) problem('academic_import_not_found', 'Ведомость не найдена.', 404);
  const discipline = database.get(`
    SELECT * FROM academic_disciplines WHERE workspace_id = ? AND id = ?
  `, workspaceId, disciplineId);
  if (!discipline) problem('academic_discipline_not_found', 'Дисциплина не найдена.', 404);
  const items = database.all(`
    SELECT ast.id AS student_id, ast.display_name,
      agr.raw_value, agr.grade_category, agr.numeric_value,
      COALESCE(agr.status, 'empty') AS status, agr.review_message,
      agis.sheet_name, COALESCE(agr.cell_address, '') AS cell_address,
      agis.row_no, agid.source_column AS column_no,
      agr.source_locator_json,
      dv.document_id AS source_document_id,
      dv.id AS source_document_version_id
    FROM academic_grade_import_students agis
    JOIN academic_group_memberships agm ON agm.id = agis.membership_id
    JOIN academic_students ast ON ast.id = agm.student_id
    JOIN academic_grade_imports agi ON agi.id = agis.import_id
    JOIN academic_grade_import_disciplines agid
      ON agid.import_id = agi.id AND agid.discipline_id = ?
    JOIN document_versions dv ON dv.id = agi.source_document_version_id
    LEFT JOIN academic_grade_records agr
      ON agr.import_id = agi.id
      AND agr.membership_id = agis.membership_id
      AND agr.discipline_id = agid.discipline_id
    WHERE agi.workspace_id = ? AND agi.id = ?
    ORDER BY ast.display_name COLLATE NOCASE
  `, disciplineId, workspaceId, importId).map((item) => {
    const cellAddress = item.cell_address || `${columnLetters(item.column_no)}${item.row_no}`;
    return {
      ...item,
      cell_address: cellAddress,
      locator: item.source_locator_json
        ? parseJson(item.source_locator_json)
        : {
          kind: 'academic_empty_cell',
          sheet: item.sheet_name,
          row: Number(item.row_no),
          column: Number(item.column_no),
          cell: cellAddress
        }
    };
  });
  return { run, discipline, items };
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

export function academicExport(database, workspaceId, importIds, format = 'csv') {
  const ids = [...new Set((Array.isArray(importIds) ? importIds : [importIds]).filter(Boolean))];
  if (!ids.length) problem('academic_export_empty', 'Нет ведомостей для выгрузки.', 404);
  const rows = academicSummary(database, workspaceId, ids);
  const placeholders = ids.map(() => '?').join(',');
  const runs = ids.map((id) => getAcademicImport(database, workspaceId, id)).filter(Boolean);
  const metadata = database.all(`
    SELECT agim.import_id, agim.field_key, agim.normalized_value, agim.raw_value,
      agim.source_kind, agim.source_locator_json, agim.normalization_rule,
      dv.document_id, agi.source_document_version_id, fb.sha256
    FROM academic_grade_import_metadata agim
    JOIN academic_grade_imports agi ON agi.id = agim.import_id
    JOIN document_versions dv ON dv.id = agi.source_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE agim.import_id IN (${placeholders})
    ORDER BY agim.import_id, agim.field_key
  `, ...ids).map((item) => ({ ...item, locator: parseJson(item.source_locator_json) }));
  const grades = database.all(`
    SELECT agr.id AS grade_record_id, agr.import_id, ad.id AS discipline_id,
      ad.name AS discipline, ast.id AS student_id, ast.display_name AS student,
      agr.raw_value, agr.grade_category, agr.numeric_value, agr.status,
      agr.sheet_name, agr.cell_address, agr.row_no, agr.column_no,
      agr.source_locator_json, dv.document_id,
      dv.id AS document_version_id, fb.sha256
    FROM academic_grade_records agr
    JOIN academic_disciplines ad ON ad.id = agr.discipline_id
    JOIN academic_group_memberships agm ON agm.id = agr.membership_id
    JOIN academic_students ast ON ast.id = agm.student_id
    JOIN academic_grade_imports agi ON agi.id = agr.import_id
    JOIN document_versions dv ON dv.id = agi.source_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE agr.workspace_id = ? AND agr.import_id IN (${placeholders})
    ORDER BY agr.import_id, ad.name COLLATE NOCASE, ast.display_name COLLATE NOCASE
  `, workspaceId, ...ids).map((item) => ({ ...item, locator: parseJson(item.source_locator_json) }));

  if (format === 'csv') {
    const header = [
      'Учебный год', 'Семестр', 'Учебная группа', 'Дисциплина', 'Всего значений',
      'Отлично', 'Хорошо', 'Удовлетворительно', 'Неудовлетворительно',
      'Не аттестован', 'Требует проверки', 'Средний балл'
    ];
    const lines = [header, ...rows.map((row) => [
      row.academic_year,
      row.semester,
      row.group_code,
      row.discipline,
      row.recorded_values,
      row.excellent,
      row.good,
      row.satisfactory,
      row.unsatisfactory,
      row.not_attested,
      row.needs_review,
      localizedAverage(row.average_grade)
    ])];
    return {
      mediaType: 'text/csv; charset=utf-8',
      extension: 'csv',
      body: `\uFEFF${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: runs.map((run) => ({
      importId: run.id,
      academicYear: run.academic_year,
      semester: run.semester,
      groupCode: run.group_code,
      sourceDocumentId: run.source_document_id,
      sourceDocumentVersionId: run.source_document_version_id,
      sourceSha256: run.source_sha256
    })),
    rows
  };
  if (format === 'json') {
    return {
      mediaType: 'application/json; charset=utf-8',
      extension: 'json',
      body: `${JSON.stringify({ report, metadata, grades }, null, 2)}\n`
    };
  }
  if (format === 'sources') {
    return {
      mediaType: 'application/json; charset=utf-8',
      extension: 'sources.json',
      body: `${JSON.stringify({ generatedAt: report.generatedAt, metadata, grades }, null, 2)}\n`
    };
  }
  problem('academic_export_format_invalid', 'Неизвестный формат выгрузки.', 400, { format });
}
