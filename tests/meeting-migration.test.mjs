import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';

test('017 сохраняет старые протоколы, вопросы и решения при обновлении существующей базы', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-migration-'));
  const oldMigrations = join(root, 'migrations-016');
  await mkdir(oldMigrations, { recursive: true });
  try {
    const files = (await readdir(resolve('migrations'))).filter((name) => /^0(?:0[1-9]|1[0-6])_.*\.sql$/u.test(name)).sort();
    assert.equal(files.length, 16);
    for (const file of files) await copyFile(resolve('migrations', file), join(oldMigrations, file));

    const databasePath = join(root, 'legacy.sqlite3');
    const oldDatabase = new Database(databasePath, { migrationsDir: oldMigrations });
    const workspace = ensureDefaultWorkspace(oldDatabase);
    const now = new Date().toISOString();
    oldDatabase.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES('legacyblob',1,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',?,?)`, join(root, 'legacy.docx'), now);
    oldDatabase.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES('legacydoc',?,'Протокол №3','department_protocol','processed','legacyv',?,?)`, workspace.id, now, now);
    oldDatabase.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,upload_key,uploaded_at) VALUES('legacyv','legacydoc',1,'legacyblob','Протокол 3.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx','processed','legacy-upload',?)`, now);
    oldDatabase.run(`INSERT INTO meetings(id,workspace_id,source_document_version_id,protocol_number,meeting_date,title,chairperson_raw,secretary_raw,confidence,status,evidence_json,created_at,updated_at) VALUES('legacy-meeting',?,'legacyv','3','2025-02-12','Старое заседание','Председатель','Секретарь',1,'confirmed','{}',?,?)`, workspace.id, now, now);
    oldDatabase.run(`INSERT INTO agenda_items(id,meeting_id,item_no,title,heard_text,decision_text,evidence_json,created_at) VALUES('legacy-agenda','legacy-meeting',4,'Старый вопрос','Слушали','Решили','{}',?)`, now);
    oldDatabase.run(`INSERT INTO decisions(id,agenda_item_id,text,status,evidence_json,created_at) VALUES('legacy-decision','legacy-agenda','Старое решение','confirmed','{}',?)`, now);
    oldDatabase.close();

    const upgraded = new Database(databasePath, { migrationsDir: resolve('migrations') });
    assert.equal(upgraded.get('SELECT COUNT(*) AS c FROM schema_migrations WHERE version = ?', 17).c, 1);
    assert.equal(upgraded.get("SELECT source_document_version_id FROM meetings WHERE id='legacy-meeting'").source_document_version_id, 'legacyv');
    assert.equal(upgraded.get("SELECT item_no FROM agenda_items WHERE id='legacy-agenda'").item_no, 4);
    assert.equal(upgraded.get("SELECT text FROM decisions WHERE id='legacy-decision'").text, 'Старое решение');
    upgraded.run(`INSERT INTO meetings(id,workspace_id,source_document_version_id,protocol_number,meeting_date,title,confidence,status,evidence_json,created_at,updated_at) VALUES('new-draft',?,NULL,'4','2026-02-12','Новый черновик',1,'draft','{}',?,?)`, workspace.id, now, now);
    assert.equal(upgraded.get("SELECT source_document_version_id FROM meetings WHERE id='new-draft'").source_document_version_id, null);
    upgraded.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
