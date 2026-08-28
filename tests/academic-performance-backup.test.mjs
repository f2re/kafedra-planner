import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createBackup, restoreBackup, verifyBackup } from '../packages/backup/src/service.mjs';
import { importAcademicPerformance } from '../packages/academic-performance/src/service.mjs';

async function addCsv(database, workspaceId, blobDir, content) {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const path = join(blobDir, sha256);
  await writeFile(path, content, 'utf8');
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
    VALUES ('academic-backup-document',?,?,'other','processed','academic-backup-version',?,?)
  `, workspaceId, 'Ведомость для резервной копии', now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at
    ) VALUES ('academic-backup-version','academic-backup-document',1,?,'backup-grades.csv','text/csv','csv','processed',?)
  `, sha256, now);
}

test('backup/restore сохраняет ведомость, метаполя, оценки и исходный файл', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-academic-backup-'));
  try {
    const dataDir = join(root, 'data');
    const blobDir = join(dataDir, 'blobs');
    const appDir = join(root, 'application');
    const backupDir = join(root, 'backups');
    const configPath = join(root, 'kafedra-planner.env');
    const databasePath = join(dataDir, 'kafedra-planner.sqlite3');
    await mkdir(blobDir, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, 'VERSION'), '0.4.0\n');
    await writeFile(configPath, 'KAFEDRA_HOST=127.0.0.1\n');

    const database = new Database(databasePath, { migrationsDir: resolve('migrations') });
    const workspace = ensureDefaultWorkspace(database);
    const content = [
      'Учебный год;2026/2027',
      'Семестр;2',
      'Группа;РЛ-42',
      'Ведомость',
      'ФИО;Метеорология',
      'Иванов Иван;5',
      'Петрова Анна;4'
    ].join('\n');
    await addCsv(database, workspace.id, blobDir, content);
    const imported = await importAcademicPerformance(database, workspace.id, {
      documentId: 'academic-backup-document',
      metadata: {
        academicYear: { mode: 'cell', sheetName: 'Таблица', cell: 'B1' },
        semester: { mode: 'cell', sheetName: 'Таблица', cell: 'B2' },
        groupCode: { mode: 'cell', sheetName: 'Таблица', cell: 'B3' }
      },
      profile: {
        sheetName: 'Таблица',
        headerRow: 5,
        studentColumn: 1,
        disciplines: [{ column: 2, name: 'Метеорология' }]
      },
      idempotencyKey: 'academic-backup-import'
    });
    assert.equal(imported.total_students, 2);
    database.close();

    const created = await createBackup({
      databasePath,
      dataDir,
      blobDir,
      configPath,
      applicationDir: appDir,
      versionPath: join(appDir, 'VERSION'),
      backupDir,
      includeApplication: true,
      keep: 1,
      reason: 'academic-test'
    });
    assert.equal((await verifyBackup({ archivePath: created.archivePath })).status, 'ok');

    const targetDataDir = join(root, 'restored-data');
    await restoreBackup({
      archivePath: created.archivePath,
      targetDataDir,
      targetConfigPath: join(root, 'restored.env'),
      targetApplicationDir: join(root, 'restored-application'),
      apply: true,
      force: true
    });
    const restored = new Database(join(targetDataDir, 'kafedra-planner.sqlite3'), { readonly: true });
    assert.equal(restored.get('SELECT COUNT(*) AS n FROM academic_grade_imports').n, 1);
    assert.equal(restored.get('SELECT COUNT(*) AS n FROM academic_grade_import_metadata').n, 3);
    assert.equal(restored.get('SELECT COUNT(*) AS n FROM academic_grade_records').n, 2);
    assert.equal(restored.get('SELECT is_current FROM academic_grade_imports').is_current, 1);
    assert.equal(restored.quickCheck(), true);
    assert.deepEqual(restored.foreignKeyCheck(), []);
    const blobPath = restored.get('SELECT storage_path FROM file_blobs').storage_path;
    restored.close();
    assert.equal(await readFile(blobPath, 'utf8'), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
