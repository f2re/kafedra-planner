import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import {
  academicExport,
  academicHierarchy,
  analyzeAcademicPerformance,
  archiveAcademicImport,
  getAcademicImport,
  importAcademicPerformance,
  listAcademicImports,
  normalizeGrade,
  restoreAcademicImport
} from '../packages/academic-performance/src/service.mjs';
import { columnLetters } from '../packages/academic-performance/src/table.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-academic-performance-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, database, workspace };
}

async function closeFixture(env) {
  env.database.close();
  await rm(env.root, { recursive: true, force: true });
}

async function addCsv(database, workspaceId, root, id, content) {
  const path = join(root, `${id}.csv`);
  await writeFile(path, content, 'utf8');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const now = new Date().toISOString();
  database.run(
    'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    sha256,
    Buffer.byteLength(content),
    'text/csv',
    path,
    now
  );
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,?,'other','processed',?,?,?)
  `, id, workspaceId, id, `${id}_version`, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at
    ) VALUES (?,?,1,?,?,'text/csv','csv','processed',?)
  `, `${id}_version`, id, sha256, `${id}.csv`, now);
  return id;
}

function cellMetadata() {
  return {
    academicYear: { mode: 'cell', sheetName: 'Таблица', cell: 'B1' },
    semester: { mode: 'cell', sheetName: 'Таблица', cell: 'B2' },
    groupCode: { mode: 'cell', sheetName: 'Таблица', cell: 'B3' }
  };
}

function manualMetadata() {
  return {
    academicYear: { mode: 'manual', value: '2026/2027' },
    semester: { mode: 'manual', value: '1' },
    groupCode: { mode: 'manual', value: 'ИВТ-31' }
  };
}

function profile() {
  return {
    sheetName: 'Таблица',
    headerRow: 5,
    studentColumn: 2,
    disciplines: [
      { column: 3, name: 'Математика' },
      { column: 4, name: 'Физика' }
    ]
  };
}

test('оценки, метаполя из ячеек и адреса после Z нормализуются детерминированно', () => {
  assert.deepEqual(normalizeGrade('5'), {
    kind: 'accepted', raw: '5', category: 'excellent', numericValue: 5, rule: 'numeric_5'
  });
  assert.equal(normalizeGrade('н/а').category, 'not_attested');
  assert.equal(normalizeGrade('-').kind, 'empty');
  assert.equal(normalizeGrade('зачтено').kind, 'review');
  assert.equal(columnLetters(1), 'A');
  assert.equal(columnLetters(26), 'Z');
  assert.equal(columnLetters(27), 'AA');
  assert.equal(columnLetters(703), 'AAA');
});

test('ведомость группируется по учебному году и семестру, а каждая оценка сохраняет источник', async () => {
  const env = await fixture();
  try {
    const { database, workspace, root } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Оператор ведомостей' });
    const documentId = await addCsv(database, workspace.id, root, 'grades_first', [
      'Учебный год;2026/2027',
      'Семестр;1 семестр',
      'Группа;ИВТ-31',
      'Ведомость итоговой аттестации',
      '№;ФИО;Математика;Физика',
      '1;Иванов Иван;5;н/а',
      '2;Петрова Анна;4;3',
      '3;Сидоров Пётр;2;зачтено',
      ';Без имени;3;4',
      '5;;3;4'
    ].join('\n'));

    const analysis = await analyzeAcademicPerformance(database, workspace.id, documentId);
    assert.equal(analysis.ready, true);
    assert.equal(analysis.preferredSheet, 'Таблица');
    assert.equal(analysis.sheets[0].headerRow, 5);
    assert.equal(analysis.sheets[0].studentColumn, 2);
    assert.equal(analysis.metadata.academicYear.preferred.cell, 'B1');
    assert.equal(analysis.metadata.semester.preferred.cell, 'B2');
    assert.equal(analysis.metadata.groupCode.preferred.cell, 'B3');

    const run = await importAcademicPerformance(database, workspace.id, {
      documentId,
      metadata: cellMetadata(),
      profile: profile(),
      idempotencyKey: 'academic-first'
    }, actor.id);

    assert.equal(run.processing_status, 'completed_with_review');
    assert.equal(run.is_current, true);
    assert.equal(run.lifecycle_status, 'active');
    assert.equal(run.academic_year, '2026/2027');
    assert.equal(run.semester, 1);
    assert.equal(run.group_code, 'ИВТ-31');
    assert.equal(run.total_students, 4);
    assert.equal(run.summary.length, 2);
    assert.equal(run.issue_count, 1);
    assert.deepEqual(
      run.metadata.map((item) => [item.fieldKey, item.sourceKind, item.locator.cell]),
      [
        ['academicYear', 'cell', 'B1'],
        ['groupCode', 'cell', 'B3'],
        ['semester', 'cell', 'B2']
      ]
    );

    const mathematics = run.summary.find((item) => item.discipline === 'Математика');
    assert.deepEqual({
      excellent: mathematics.excellent,
      good: mathematics.good,
      satisfactory: mathematics.satisfactory,
      unsatisfactory: mathematics.unsatisfactory,
      notAttested: mathematics.not_attested,
      review: mathematics.needs_review,
      average: mathematics.average_grade
    }, {
      excellent: 1,
      good: 1,
      satisfactory: 1,
      unsatisfactory: 1,
      notAttested: 0,
      review: 0,
      average: 3.5
    });
    const physics = run.summary.find((item) => item.discipline === 'Физика');
    assert.equal(physics.not_attested, 1);
    assert.equal(physics.needs_review, 1);
    assert.equal(physics.average_grade, 3.5);

    const evidence = database.get(`
      SELECT cell_address, raw_value, normalization_rule, source_locator_json
      FROM academic_grade_records
      WHERE import_id = ? AND cell_address = 'D8'
    `, run.id);
    assert.equal(evidence.raw_value, 'зачтено');
    assert.equal(evidence.normalization_rule, 'unrecognized');
    assert.equal(JSON.parse(evidence.source_locator_json).cell, 'D8');

    const hierarchy = academicHierarchy([run]);
    assert.equal(hierarchy[0].academicYear, '2026/2027');
    assert.equal(hierarchy[0].semesters[0].semester, 1);
    assert.equal(hierarchy[0].semesters[0].groups[0].groupCode, 'ИВТ-31');

    const repeated = await importAcademicPerformance(database, workspace.id, {
      documentId,
      metadata: cellMetadata(),
      profile: profile(),
      idempotencyKey: 'academic-first'
    }, actor.id);
    assert.equal(repeated.id, run.id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM academic_grade_imports').n, 1);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    await closeFixture(env);
  }
});

test('новая успешная версия заменяет прежнюю без двойного учёта; архив и восстановление обратимы', async () => {
  const env = await fixture();
  try {
    const { database, workspace, root } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Оператор версий' });
    const firstDocument = await addCsv(database, workspace.id, root, 'grades_version_1', [
      'Учебный год;2026/2027',
      'Семестр;1',
      'Группа;ИВТ-31',
      'Версия 1',
      '№;ФИО;Математика;Физика',
      '1;Иванов Иван;5;5',
      '2;Петрова Анна;4;4'
    ].join('\n'));
    const first = await importAcademicPerformance(database, workspace.id, {
      documentId: firstDocument,
      metadata: cellMetadata(),
      profile: profile(),
      idempotencyKey: 'academic-version-1'
    }, actor.id);

    const secondDocument = await addCsv(database, workspace.id, root, 'grades_version_2', [
      'Учебный год;2026/2027',
      'Семестр;1',
      'Группа;ИВТ-31',
      'Версия 2',
      '№;ФИО;Математика;Физика',
      '1;Иванов Иван;3;3',
      '2;Петрова Анна;2;н/а'
    ].join('\n'));
    const second = await importAcademicPerformance(database, workspace.id, {
      documentId: secondDocument,
      metadata: manualMetadata(),
      profile: profile(),
      idempotencyKey: 'academic-version-2'
    }, actor.id);

    const old = getAcademicImport(database, workspace.id, first.id);
    assert.equal(old.is_current, false);
    assert.equal(old.lifecycle_status, 'superseded');
    assert.equal(old.superseded_by_import_id, second.id);
    assert.equal(second.is_current, true);
    assert.ok(second.metadata.every((item) => item.sourceKind === 'manual'));

    const current = listAcademicImports(database, workspace.id);
    assert.deepEqual(current.map((item) => item.id), [second.id]);
    const history = listAcademicImports(database, workspace.id, { includeHistory: true });
    assert.equal(history.length, 2);

    const csv = academicExport(database, workspace.id, current.map((item) => item.id), 'csv');
    assert.match(csv.body, /2026\/2027;1;ИВТ-31;Математика;2;0;0;1;1;0;0;2,50/u);
    assert.doesNotMatch(csv.body, /;2;2;0;0;0;0;0;4,50/u);
    const json = JSON.parse(academicExport(database, workspace.id, [second.id], 'json').body);
    assert.equal(json.report.rows.length, 2);
    assert.ok(json.metadata.every((item) => item.import_id === second.id));
    const sources = JSON.parse(academicExport(database, workspace.id, [second.id], 'sources').body);
    assert.ok(sources.grades.some((item) => item.cell_address === 'D7'));

    const archived = archiveAcademicImport(database, workspace.id, second.id, actor.id, 'Загружена ошибочно');
    assert.equal(archived.lifecycle_status, 'archived');
    assert.equal(archived.is_current, false);
    assert.equal(listAcademicImports(database, workspace.id).length, 0);

    const restored = restoreAcademicImport(database, workspace.id, first.id, actor.id);
    assert.equal(restored.lifecycle_status, 'active');
    assert.equal(restored.is_current, true);
    assert.equal(getAcademicImport(database, workspace.id, second.id).is_current, false);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    await closeFixture(env);
  }
});
