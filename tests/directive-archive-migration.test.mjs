import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { CURRENT_SCHEMA_VERSION } from './helpers/current-schema.mjs';

const migrationsDir = resolve('migrations');

test('обновление 019 → текущая схема переносит существующие распоряжения в календарь без потери данных', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-directive-archive-upgrade-'));
  const legacyMigrations = join(root, 'migrations-019');
  const databasePath = join(root, 'existing.sqlite3');
  await mkdir(legacyMigrations, { recursive: true });

  try {
    const names = (await readdir(migrationsDir))
      .filter((name) => /^\d+_.*\.sql$/u.test(name) && Number.parseInt(name, 10) <= 19)
      .sort();
    assert.equal(names.at(-1)?.startsWith('019_'), true);
    for (const name of names) await copyFile(join(migrationsDir, name), join(legacyMigrations, name));

    let database = new Database(databasePath, { migrationsDir: legacyMigrations });
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-08-01T08:00:00.000Z';
    database.run(`
      INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
      VALUES ('legacy-directive-blob', 123, 'application/pdf', '/tmp/legacy-directive.pdf', ?)
    `, now);
    database.run(`
      INSERT INTO documents(
        id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at
      ) VALUES (
        'legacy-directive-doc', ?, 'Старое распоряжение', 'directive', 'processed',
        'legacy-directive-version', ?, ?
      )
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO document_versions(
        id, document_id, version_no, blob_sha256, original_name, media_type,
        detected_format, processing_status, uploaded_at
      ) VALUES (
        'legacy-directive-version', 'legacy-directive-doc', 1, 'legacy-directive-blob',
        'legacy-directive.pdf', 'application/pdf', 'pdf', 'processed', ?
      )
    `, now);
    database.run(`
      INSERT INTO directives(
        id, workspace_id, source_document_version_id, directive_kind,
        document_number, issued_at, issuer_raw, title, summary, direction,
        status, confidence, evidence_json, created_at, updated_at
      ) VALUES (
        'legacy-directive', ?, 'legacy-directive-version', 'Распоряжение',
        '77-р', '2026-07-15', 'Руководитель', 'О проверке архива',
        'Существующая запись до миграции 020', 'organizational',
        'active', 1, '{}', ?, ?
      )
    `, workspace.id, now, now);

    assert.equal(database.get('SELECT MAX(version) AS v FROM schema_migrations').v, 19);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM calendar_items
      WHERE source_kind='directive' AND source_id='legacy-directive'
    `).n, 0);
    database.close();

    database = new Database(databasePath, { migrationsDir });
    try {
      assert.equal(database.get('SELECT MAX(version) AS v FROM schema_migrations').v, CURRENT_SCHEMA_VERSION);
      assert.ok(database.get(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='directive_report_materials'
      `));
      const calendar = database.get(`
        SELECT * FROM calendar_items
        WHERE source_kind='directive' AND source_id='legacy-directive'
      `);
      assert.ok(calendar);
      assert.equal(calendar.starts_at, '2026-07-15');
      assert.match(calendar.title, /77-р/u);
      assert.match(calendar.title, /О проверке архива/u);

      const directive = database.get("SELECT * FROM directives WHERE id='legacy-directive'");
      assert.equal(directive.document_number, '77-р');
      assert.equal(directive.title, 'О проверке архива');

      database.run(`
        UPDATE directives
        SET document_number='78-р', issued_at='2026-07-16', title='О проверке архива — уточнение',
            updated_at='2026-08-02T09:00:00.000Z'
        WHERE id='legacy-directive'
      `);
      const moved = database.get(`
        SELECT * FROM calendar_items
        WHERE source_kind='directive' AND source_id='legacy-directive'
      `);
      assert.equal(moved.starts_at, '2026-07-16');
      assert.match(moved.title, /78-р/u);
      assert.match(moved.title, /уточнение/u);

      assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
      assert.equal(database.quickCheck(), true);
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
