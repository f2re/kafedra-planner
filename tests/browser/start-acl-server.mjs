import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from '../../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../../packages/storage/src/bootstrap.mjs';
import { createAuthAccount } from '../../packages/auth/src/service.mjs';
import { ensureObjectPolicy } from '../../packages/access-control/src/service.mjs';
import { addSearchFragment } from '../../packages/storage/src/search.mjs';

const port = String(process.env.KAFEDRA_BROWSER_PORT || '4179');
const dataDir = mkdtempSync(join(tmpdir(), `kafedra-acl-browser-${port}-`));
const blobDir = join(dataDir, 'blobs');
mkdirSync(blobDir, { recursive: true });
const databasePath = join(dataDir, 'browser.sqlite3');
const env = {
  ...process.env,
  KAFEDRA_DATA_DIR: dataDir,
  KAFEDRA_DATABASE_PATH: databasePath,
  KAFEDRA_HOST: '127.0.0.1',
  KAFEDRA_PORT: port,
  KAFEDRA_AUTH_ENABLED: 'true',
  KAFEDRA_AUTH_CSRF_ENABLED: 'true',
  KAFEDRA_AUTH_SECURE_COOKIES: 'false',
  KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION: 'false',
  KAFEDRA_OCR_ENABLED: 'false',
  KAFEDRA_PREVIEW_ENABLED: 'false',
  KAFEDRA_LOG_LEVEL: 'error'
};

const database = new Database(databasePath, { migrationsDir: resolve('migrations') });
const workspace = ensureDefaultWorkspace(database);
const now = '2026-08-07T02:00:00.000Z';
const people = [
  ['person-admin', 'Администратор Системы', null],
  ['person-manager', 'Орлов Олег Олегович', null],
  ['person-staff', 'Сидоров Сергей Сергеевич', 'person-manager'],
  ['person-outsider', 'Иванов Иван Иванович', null]
];
for (const [id, name, managerId] of people) {
  database.run(`
    INSERT INTO people(id, workspace_id, display_name, normalized_name, position,
      manager_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'сотрудник', ?, 'active', ?, ?)
  `, id, workspace.id, name, name.toLowerCase(), managerId, now, now);
}
createAuthAccount(database, workspace.id, {
  personId: 'person-admin', username: 'admin', password: 'AdminPassword2026', role: 'admin'
}, now);
createAuthAccount(database, workspace.id, {
  personId: 'person-manager', username: 'manager', password: 'ManagerPass2026', role: 'manager'
}, now);
createAuthAccount(database, workspace.id, {
  personId: 'person-staff', username: 'staff', password: 'StaffPassword2026', role: 'staff'
}, now);
createAuthAccount(database, workspace.id, {
  personId: 'person-outsider', username: 'outsider', password: 'OutsiderPass2026', role: 'staff'
}, now);

function addDocument(id, versionId, title, content, ownerId) {
  const sha = createHash('sha256').update(content).digest('hex');
  const path = join(blobDir, sha);
  writeFileSync(path, content);
  database.run(`
    INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES(?,?,'text/plain',?,?)
  `, sha, Buffer.byteLength(content), path, now);
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES(?,?,?,'report','processed',?,?,?)
  `, id, workspace.id, title, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,
      detected_format,processing_status,extracted_text,uploaded_at)
    VALUES(?,?,1,?,?, 'text/plain','txt','processed',?,?)
  `, versionId, id, sha, `${title}.txt`, content, now);
  ensureObjectPolicy(database, {
    workspaceId: workspace.id, objectKind: 'document', objectId: id,
    ownerPersonId: ownerId, accessScope: 'restricted', now
  });
  addSearchFragment(database, {
    workspaceId: workspace.id, sourceKind: 'document_version', sourceId: versionId,
    documentVersionId: versionId, title, content, locator: { documentId: id }
  });
}
addDocument('doc-staff', 'ver-staff', 'Личный документ', 'МОЙДОКУМЕНТ виден сотруднику', 'person-staff');
addDocument('doc-outsider', 'ver-outsider', 'Чужой документ', 'ЧУЖОЙСЕКРЕТ не должен утечь', 'person-outsider');

database.run(`
  INSERT INTO scientific_items(id,workspace_id,source_document_version_id,item_kind,title,status,direction,
    confidence,evidence_json,created_at,updated_at)
  VALUES('science-outsider',?,'ver-outsider','article','Чужая научная статья','confirmed','science',1,'{}',?,?)
`, workspace.id, now, now);
database.run(`
  INSERT INTO scientific_item_authors(scientific_item_id,person_id,author_raw,author_order,created_at)
  VALUES('science-outsider','person-outsider','Иванов Иван Иванович',1,?)
`, now);
ensureObjectPolicy(database, {
  workspaceId: workspace.id, objectKind: 'scientific_item', objectId: 'science-outsider',
  ownerPersonId: 'person-outsider', accessScope: 'restricted', now
});
database.close();

const api = spawn(process.execPath, ['apps/api/src/main.mjs'], {
  cwd: resolve('.'), env, stdio: 'inherit'
});
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  api.kill('SIGTERM');
  setTimeout(() => {
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(code);
  }, 250).unref();
}
process.on('SIGINT', () => close(0));
process.on('SIGTERM', () => close(0));
api.on('exit', (code) => { if (!closing && code) close(code); });
setInterval(() => {}, 60_000);
