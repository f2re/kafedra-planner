import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';
import { scanDirectory, syncWatchedFolder } from '../packages/folder-sync/src/sync-engine.mjs';
import {
  saveWatchedFolder,
  listWatchedFolders,
  getWatchedFolder,
  deleteWatchedFolder
} from '../packages/folder-sync/src/folder-sync-store.mjs';

const migrationsDir = resolve('migrations');

async function withFixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-fsync-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const blobDir = join(dir, 'blobs');
  const watchedDir = join(dir, 'watched');
  await mkdir(blobDir, { recursive: true });
  await mkdir(watchedDir, { recursive: true });

  try {
    await run({ database, workspace, dir, blobDir, watchedDir });
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('scanDirectory находит поддерживаемые файлы и игнорирует скрытые и блокировочные файлы', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-scan-'));
  try {
    await writeFile(join(dir, 'protocol_1.docx'), 'dummy docx');
    await writeFile(join(dir, 'plan_2026.pdf'), '%PDF-1.4 dummy pdf');
    await writeFile(join(dir, 'report.txt'), 'dummy report text');
    await writeFile(join(dir, '~$temp_lock.docx'), 'lock');
    await writeFile(join(dir, '.hidden.docx'), 'hidden');
    await writeFile(join(dir, 'test.tmp'), 'tmp');

    const subDir = join(dir, 'sub');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, 'nested.docx'), 'nested docx');

    const flat = await scanDirectory(dir, { recursive: false });
    const flatNames = flat.map((f) => f.fileName).sort();
    assert.deepEqual(flatNames, ['plan_2026.pdf', 'protocol_1.docx', 'report.txt']);

    const recursive = await scanDirectory(dir, { recursive: true });
    const recNames = recursive.map((f) => f.fileName).sort();
    assert.deepEqual(recNames, ['nested.docx', 'plan_2026.pdf', 'protocol_1.docx', 'report.txt']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('folder-sync-store сохраняет, читает и удаляет конфигурации папок', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-store-'));
  try {
    const f1 = saveWatchedFolder(dir, {
      name: 'Протоколы',
      folderPath: '/tmp/protocols',
      documentType: 'protocol',
      targetYear: 2026,
      recursive: true,
      intervalSeconds: 30
    });
    assert.ok(f1.id);
    assert.equal(f1.name, 'Протоколы');

    const list1 = listWatchedFolders(dir);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].id, f1.id);

    const got = getWatchedFolder(dir, f1.id);
    assert.equal(got.folderPath, '/tmp/protocols');

    // Update
    saveWatchedFolder(dir, { id: f1.id, name: 'Протоколы обновлено' });
    const got2 = getWatchedFolder(dir, f1.id);
    assert.equal(got2.name, 'Протоколы обновлено');

    // Delete
    const deleted = deleteWatchedFolder(dir, f1.id);
    assert.equal(deleted, true);
    assert.equal(listWatchedFolders(dir).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncWatchedFolder импортирует новые файлы, переиндексирует изменённые и сохраняет версии', () => withFixture(async (ctx) => {
  const { database, workspace, dir, blobDir, watchedDir } = ctx;

  const file1 = join(watchedDir, 'protocol_1.txt');
  await writeFile(file1, 'ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ № 1 от 01.09.2026');

  const folder = saveWatchedFolder(dir, {
    name: 'Протоколы 2026',
    folderPath: watchedDir,
    documentType: 'protocol',
    targetYear: 2026,
    recursive: false,
    intervalSeconds: 30
  });

  // 1. First sync - registers file
  const res1 = await syncWatchedFolder({
    database,
    workspaceId: workspace.id,
    dataDir: dir,
    blobDir,
    folder,
    logger: null
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.addedCount, 1);
  assert.equal(res1.updatedCount, 0);
  assert.equal(res1.unchangedCount, 0);

  // Check document in DB
  const docs = database.all('SELECT * FROM documents WHERE workspace_id = ?', workspace.id);
  assert.equal(docs.length, 1);
  const doc = docs[0];
  assert.equal(doc.title, 'protocol_1');

  const versions1 = database.all('SELECT * FROM document_versions WHERE document_id = ?', doc.id);
  assert.equal(versions1.length, 1);
  assert.equal(versions1[0].version_no, 1);

  const jobs1 = database.all('SELECT * FROM jobs WHERE kind = ?', 'process_document');
  assert.equal(jobs1.length, 1);

  // 2. Second sync with no changes - idempotent
  const res2 = await syncWatchedFolder({
    database,
    workspaceId: workspace.id,
    dataDir: dir,
    blobDir,
    folder,
    logger: null
  });

  assert.equal(res2.ok, true);
  assert.equal(res2.addedCount, 0);
  assert.equal(res2.updatedCount, 0);
  assert.equal(res2.unchangedCount, 1);

  // 3. Modify file in watched directory
  await writeFile(file1, 'ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ № 1 от 01.09.2026 (ИСПРАВЛЕННЫЙ)');

  const res3 = await syncWatchedFolder({
    database,
    workspaceId: workspace.id,
    dataDir: dir,
    blobDir,
    folder,
    logger: null
  });

  assert.equal(res3.ok, true);
  assert.equal(res3.addedCount, 0);
  assert.equal(res3.updatedCount, 1);
  assert.equal(res3.unchangedCount, 0);

  // Check versions: now version_no 2 exists and documents.current_version_id points to it
  const versions2 = database.all('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_no ASC', doc.id);
  assert.equal(versions2.length, 2);
  assert.equal(versions2[0].version_no, 1);
  assert.equal(versions2[1].version_no, 2);

  const updatedDoc = database.get('SELECT * FROM documents WHERE id = ?', doc.id);
  assert.equal(updatedDoc.current_version_id, versions2[1].id);

  // New reprocess job enqueued
  const jobs2 = database.all('SELECT * FROM jobs WHERE kind = ?', 'process_document');
  assert.equal(jobs2.length, 2);

  // 4. Missing folder error handling
  const badFolder = {
    id: 'f_bad',
    name: 'Nonexistent',
    folderPath: join(dir, 'nonexistent_directory'),
    documentType: 'auto',
    recursive: false
  };

  const res4 = await syncWatchedFolder({
    database,
    workspaceId: workspace.id,
    dataDir: dir,
    blobDir,
    folder: badFolder,
    logger: null
  });

  assert.equal(res4.ok, false);
  assert.match(res4.error, /Папка не существует/);
}));

test('HTTP API /api/folder-sync управляет папками и запускает синхронизацию', () => withFixture(async (ctx) => {
  const { database, dir, blobDir, watchedDir } = ctx;
  const config = loadConfig({
    KAFEDRA_DATA_DIR: dir,
    KAFEDRA_AUTH_ENABLED: 'false',
    KAFEDRA_PREVIEW_ENABLED: 'false',
    KAFEDRA_OCR_ENABLED: 'false',
    KAFEDRA_LLM_ENABLED: 'false'
  });
  const logger = { info() {}, error() {}, warn() {}, debug() {} };
  const server = createApp({ database, config, logger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. GET /api/folder-sync -> initially empty
    const resGet = await fetch(`${base}/api/folder-sync`);
    assert.equal(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.ok(Array.isArray(dataGet.folders));

    // 2. POST /api/folder-sync -> create watched folder
    const file1 = join(watchedDir, 'meeting_10.txt');
    await writeFile(file1, 'ПРОТОКОЛ ЗАСЕДАНИЯ № 10 от 01.10.2026');

    const resPost = await fetch(`${base}/api/folder-sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Папка протоколов',
        folderPath: watchedDir,
        documentType: 'protocol',
        targetYear: 2026,
        intervalSeconds: 30,
        recursive: false
      })
    });
    assert.equal(resPost.status, 201);
    const dataPost = await resPost.json();
    assert.ok(dataPost.folder?.id);
    const folderId = dataPost.folder.id;

    // 3. POST /api/folder-sync/:id/sync -> trigger sync
    const resSync = await fetch(`${base}/api/folder-sync/${folderId}/sync`, { method: 'POST' });
    assert.equal(resSync.status, 200);
    const dataSync = await resSync.json();
    assert.equal(dataSync.ok, true);
    assert.equal(dataSync.result.addedCount, 1);

    // 4. PATCH /api/folder-sync/:id -> update folder
    const resPatch = await fetch(`${base}/api/folder-sync/${folderId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(resPatch.status, 200);
    const dataPatch = await resPatch.json();
    assert.equal(dataPatch.folder.enabled, false);

    // 5. DELETE /api/folder-sync/:id -> delete folder
    const resDel = await fetch(`${base}/api/folder-sync/${folderId}`, { method: 'DELETE' });
    assert.equal(resDel.status, 200);
    const dataDel = await resDel.json();
    assert.equal(dataDel.ok, true);
  } finally {
    server.close();
  }
}));

