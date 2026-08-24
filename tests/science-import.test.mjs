import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { analyzeScienceImport, importScienceRows } from '../packages/science-import/src/service.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-science-import-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, database, workspace };
}

async function addCsv(database, workspaceId, root, id, content) {
  const path = join(root, `${id}.csv`);
  await writeFile(path, content, 'utf8');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const now = new Date().toISOString();
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)`,
    sha256, Buffer.byteLength(content), 'text/csv', path, now);
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

async function closeFixture(env) {
  env.database.close();
  await rm(env.root, { recursive: true, force: true });
}

test('CSV-анализ предлагает колонки и импортирует строки независимо', async () => {
  const env = await fixture();
  try {
    const { database, workspace, root } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Оператор Импорта' });
    const documentId = await addCsv(database, workspace.id, root, 'science_list', [
      'Название;Вид;Авторы;DOI;Год;Этап',
      'Радарный наукастинг;Статья;Иванов И.И.;10.1000/radar;2025;Опубликовано',
      ';Статья;Петров П.П.;;2025;Готовится',
      'Дубликат радара;Статья;Иванов И.И.;10.1000/radar;2025;Опубликовано',
      'Экспериментальный материал;Неизвестный вид;Сидоров С.С.;;2026;Готовится'
    ].join('\n'));

    const analysis = await analyzeScienceImport(database, workspace.id, documentId);
    assert.equal(analysis.ready, true);
    assert.equal(analysis.rowCount, 4);
    assert.equal(analysis.suggestedMapping.title, 0);
    assert.equal(analysis.suggestedMapping.authors, 2);

    const run = await importScienceRows(database, workspace.id, {
      documentId,
      mapping: analysis.suggestedMapping,
      options: { updateExisting: false },
      idempotencyKey: 'science-import-test-1'
    }, actor.id);
    assert.equal(run.imported_rows, 1);
    assert.equal(run.skipped_rows, 1);
    assert.equal(run.review_rows, 1);
    assert.equal(run.error_rows, 1);
    assert.equal(run.rows.length, 4);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM scientific_items WHERE workspace_id = ?', workspace.id).n, 2);
    assert.ok(run.rows.find((row) => row.status === 'error')?.message);

    const repeated = await importScienceRows(database, workspace.id, {
      documentId,
      mapping: analysis.suggestedMapping,
      options: { updateExisting: false },
      idempotencyKey: 'science-import-test-1'
    }, actor.id);
    assert.equal(repeated.id, run.id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM science_import_runs').n, 1);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM scientific_items').n, 2);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    await closeFixture(env);
  }
});

test('обновление дубликата выполняется только при явном выборе', async () => {
  const env = await fixture();
  try {
    const { database, workspace, root } = env;
    const actor = createPerson(database, workspace.id, { displayName: 'Оператор Обновления' });
    const firstId = await addCsv(database, workspace.id, root, 'science_first', [
      'Название;Авторы;DOI;Год',
      'Первое название;Иванов И.И.;10.1000/update;2025'
    ].join('\n'));
    const first = await analyzeScienceImport(database, workspace.id, firstId);
    await importScienceRows(database, workspace.id, {
      documentId: firstId, mapping: first.suggestedMapping, options: {}, idempotencyKey: 'initial'
    }, actor.id);

    const secondId = await addCsv(database, workspace.id, root, 'science_second', [
      'Название;Авторы;DOI;Год',
      'Уточнённое название;Иванов И.И.;10.1000/update;2026'
    ].join('\n'));
    const second = await analyzeScienceImport(database, workspace.id, secondId);
    const skipped = await importScienceRows(database, workspace.id, {
      documentId: secondId, mapping: second.suggestedMapping,
      options: { updateExisting: false }, idempotencyKey: 'skip-update'
    }, actor.id);
    assert.equal(skipped.skipped_rows, 1);
    assert.equal(database.get('SELECT title FROM scientific_items').title, 'Первое название');

    const updated = await importScienceRows(database, workspace.id, {
      documentId: secondId, mapping: second.suggestedMapping,
      options: { updateExisting: true }, idempotencyKey: 'explicit-update'
    }, actor.id);
    assert.equal(updated.updated_rows, 1);
    const override = database.get('SELECT * FROM scientific_item_manual_overrides');
    assert.equal(override.title, 'Уточнённое название');
    assert.match(override.reason, /science_second\.csv/u);
    assert.equal(database.get('SELECT title FROM scientific_items').title, 'Первое название');
  } finally {
    await closeFixture(env);
  }
});
