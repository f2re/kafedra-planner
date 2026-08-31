import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { importAcademicPerformance } from '../packages/academic-performance/src/service.mjs';
import {
  academicPeriodTotals,
  academicReportExport
} from '../packages/academic-performance/src/report.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-academic-totals-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const actor = createPerson(database, workspace.id, { displayName: 'Оператор сводки' });
  return { root, database, workspace, actor };
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

function profile() {
  return {
    sheetName: 'Таблица',
    headerRow: 5,
    studentColumn: 2,
    disciplines: [{ column: 3, name: 'Математика' }]
  };
}

function metadata(groupCode) {
  return {
    academicYear: { mode: 'manual', value: '2026/2027' },
    semester: { mode: 'manual', value: '1' },
    groupCode: { mode: 'manual', value: groupCode }
  };
}

async function importGroup(env, id, groupCode, rows) {
  const documentId = await addCsv(env.database, env.workspace.id, env.root, id, [
    'Учебный год;2026/2027',
    'Семестр;1',
    `Группа;${groupCode}`,
    'Ведомость',
    '№;ФИО;Математика',
    ...rows
  ].join('\n'));
  return importAcademicPerformance(env.database, env.workspace.id, {
    documentId,
    metadata: metadata(groupCode),
    profile: profile(),
    idempotencyKey: `totals:${id}`
  }, env.actor.id);
}

test('сводка выбранных актуальных групп считает взвешенный средний балл и не удваивает историю', async () => {
  const env = await fixture();
  try {
    const firstA = await importGroup(env, 'group_a_v1', 'ИВТ-31', [
      '1;Иванов Иван;5',
      '2;Петрова Анна;4'
    ]);
    const groupB = await importGroup(env, 'group_b_v1', 'ИВТ-32', [
      '1;Сидоров Пётр;2'
    ]);

    const selected = academicPeriodTotals(env.database, env.workspace.id, {
      importIds: [firstA.id, groupB.id]
    });
    assert.deepEqual(selected.scope.groups.map((item) => item.groupCode), ['ИВТ-31', 'ИВТ-32']);
    assert.equal(selected.rows.length, 1);
    assert.deepEqual({
      groups: selected.rows[0].groups,
      excellent: selected.rows[0].excellent,
      good: selected.rows[0].good,
      unsatisfactory: selected.rows[0].unsatisfactory,
      values: selected.rows[0].recorded_values,
      average: selected.rows[0].average_grade
    }, {
      groups: ['ИВТ-31', 'ИВТ-32'],
      excellent: 1,
      good: 1,
      unsatisfactory: 1,
      values: 3,
      average: 3.67
    });

    const secondA = await importGroup(env, 'group_a_v2', 'ИВТ-31', [
      '1;Иванов Иван;3'
    ]);
    assert.notEqual(secondA.id, firstA.id);

    const currentPeriod = academicPeriodTotals(env.database, env.workspace.id, {
      academicYear: '2026/2027',
      semester: 1
    });
    assert.deepEqual(currentPeriod.scope.groups.map((item) => item.importId).sort(), [groupB.id, secondA.id].sort());
    assert.deepEqual(currentPeriod.rows[0].groups, ['ИВТ-31', 'ИВТ-32']);
    assert.equal(currentPeriod.rows[0].recorded_values, 2);
    assert.equal(currentPeriod.rows[0].satisfactory, 1);
    assert.equal(currentPeriod.rows[0].unsatisfactory, 1);
    assert.equal(currentPeriod.rows[0].average_grade, 2.5);

    const oneGroup = academicPeriodTotals(env.database, env.workspace.id, { importIds: [groupB.id] });
    assert.deepEqual(oneGroup.rows[0].groups, ['ИВТ-32']);
    assert.equal(oneGroup.rows[0].average_grade, 2);

    assert.throws(
      () => academicPeriodTotals(env.database, env.workspace.id, { importIds: [firstA.id] }),
      (error) => error?.code === 'academic_totals_selection_invalid'
    );

    const csv = academicReportExport(env.database, env.workspace.id, [secondA.id, groupB.id], 'csv');
    assert.match(csv.body, /ИТОГИ ПО ДИСЦИПЛИНАМ/u);
    assert.match(csv.body, /2026\/2027;1;ИВТ-31, ИВТ-32;Математика;2;0;0;1;1;0;0;2,50/u);

    const json = JSON.parse(academicReportExport(
      env.database,
      env.workspace.id,
      [secondA.id, groupB.id],
      'json'
    ).body);
    assert.equal(json.report.totals[0].average_grade, 2.5);
    assert.deepEqual(json.report.selectedGroups.map((item) => item.groupCode), ['ИВТ-31', 'ИВТ-32']);
    assert.deepEqual(env.database.foreignKeyCheck(), []);
    assert.equal(env.database.quickCheck(), true);
  } finally {
    env.database.close();
    await rm(env.root, { recursive: true, force: true });
  }
});
