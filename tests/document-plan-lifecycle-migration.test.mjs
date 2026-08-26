import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';

const migrationsDir = resolve('migrations');

test('schema 26 обновляется до 27 без потери документов, планов и источников', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-lifecycle-migration-'));
  const legacyMigrations = join(root, 'migrations-026');
  const databasePath = join(root, 'existing.sqlite3');
  await mkdir(legacyMigrations, { recursive: true });
  try {
    for (const name of (await readdir(migrationsDir)).filter((item) => /^\d+_.*\.sql$/u.test(item)).sort()) {
      if (Number.parseInt(name, 10) <= 26) await copyFile(join(migrationsDir, name), join(legacyMigrations, name));
    }
    let database = new Database(databasePath, { migrationsDir: legacyMigrations });
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-08-25T08:00:00.000Z';
    database.run(`
      INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
      VALUES ('lifecycle-old-blob', 20, 'text/plain', '/tmp/lifecycle-old-blob', ?)
    `, now);
    database.run(`
      INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
      VALUES ('lifecycle-old-doc',?,'Документ до обновления','plan','processed','lifecycle-old-version',?,?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO document_versions(
        id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
        processing_status,extracted_text,uploaded_at
      ) VALUES (
        'lifecycle-old-version','lifecycle-old-doc',1,'lifecycle-old-blob','old-plan.txt',
        'text/plain','txt','processed','План до обновления',?
      )
    `, now);
    database.run(`
      INSERT INTO plans(
        id,workspace_id,source_document_version_id,origin_kind,plan_kind,period_kind,period_key,
        year_start,year_end,title,status,confidence,evidence_json,created_at,updated_at
      ) VALUES (
        'lifecycle-old-plan',?,'lifecycle-old-version','document','department','calendar','2026',
        2026,2026,'План до обновления','active',1,'{}',?,?
      )
    `, workspace.id, now, now);
    assert.equal(database.getSchemaVersion(), 26);
    database.close();

    database = new Database(databasePath, { migrationsDir });
    try {
      assert.equal(database.getSchemaVersion(), 27);
      const document = database.get("SELECT * FROM documents WHERE id='lifecycle-old-doc'");
      const plan = database.get("SELECT * FROM plans WHERE id='lifecycle-old-plan'");
      assert.equal(document.title, 'Документ до обновления');
      assert.equal(document.lifecycle_state, 'active');
      assert.equal(document.replacement_document_id, null);
      assert.equal(plan.title, 'План до обновления');
      assert.equal(plan.lifecycle_state, 'active');
      assert.equal(plan.source_document_version_id, 'lifecycle-old-version');
      assert.equal(database.get("SELECT blob_sha256 FROM document_versions WHERE id='lifecycle-old-version'").blob_sha256, 'lifecycle-old-blob');
      assert.deepEqual(database.foreignKeyCheck(), []);
      assert.equal(database.quickCheck(), true);
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
