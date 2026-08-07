import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  assignmentAccess,
  canReadSearchResult,
  ensureObjectPolicy,
  explainObjectAccess,
  resolveObjectAccess,
  setObjectAccess
} from '../packages/access-control/src/service.mjs';

function context(personId, role = 'staff') {
  return { authenticated: true, enabled: true, personId, role };
}

function addPerson(database, workspaceId, id, name, managerId = null) {
  const now = '2026-08-07T00:00:00.000Z';
  database.run(`
    INSERT INTO people(id, workspace_id, display_name, normalized_name, position, manager_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'сотрудник', ?, 'active', ?, ?)
  `, id, workspaceId, name, name.toLowerCase(), managerId, now, now);
}

function addDocument(database, workspaceId, id, versionId, title) {
  const now = '2026-08-07T00:00:00.000Z';
  const sha = `sha-${id}`;
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES(?,1,'text/plain',?,?)`, sha, `/tmp/${id}.txt`, now);
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES(?,?,?,'unknown','processed',?,?,?)
  `, id, workspaceId, title, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at)
    VALUES(?,?,1,?,?, 'text/plain','txt','processed',?,?)
  `, versionId, id, sha, `${title}.txt`, title, now);
}

test('ACL ограничивает прямой документ, поиск и поддерживает явные гранты', () => {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-acl-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addPerson(database, workspace.id, 'manager', 'Руководитель');
    addPerson(database, workspace.id, 'staff', 'Сотрудник', 'manager');
    addPerson(database, workspace.id, 'outsider', 'Посторонний');
    addDocument(database, workspace.id, 'doc-staff', 'ver-staff', 'Личный отчёт');
    addDocument(database, workspace.id, 'doc-outsider', 'ver-outsider', 'Чужой отчёт');

    ensureObjectPolicy(database, {
      workspaceId: workspace.id, objectKind: 'document', objectId: 'doc-staff',
      ownerPersonId: 'staff', accessScope: 'restricted'
    });
    ensureObjectPolicy(database, {
      workspaceId: workspace.id, objectKind: 'document', objectId: 'doc-outsider',
      ownerPersonId: 'outsider', accessScope: 'restricted'
    });

    assert.equal(resolveObjectAccess(database, workspace.id, context('staff'), 'document', 'doc-staff').allowed, true);
    assert.equal(resolveObjectAccess(database, workspace.id, context('staff'), 'document', 'doc-outsider').allowed, false);
    assert.equal(resolveObjectAccess(database, workspace.id, context('manager', 'manager'), 'document', 'doc-staff').role, 'controller');
    assert.equal(resolveObjectAccess(database, workspace.id, context('manager', 'manager'), 'document', 'doc-outsider').allowed, false);

    assert.equal(canReadSearchResult(database, workspace.id, context('staff'), {
      source_kind: 'document_version', source_id: 'ver-outsider'
    }), false);

    const changed = setObjectAccess(database, workspace.id, 'document', 'doc-outsider', {
      ownerPersonId: 'outsider', accessScope: 'restricted',
      grants: [{ personId: 'staff', role: 'reader' }]
    }, 'manager');
    assert.equal(changed.grants.length, 1);
    assert.equal(resolveObjectAccess(database, workspace.id, context('staff'), 'document', 'doc-outsider', 'read').allowed, true);
    assert.equal(resolveObjectAccess(database, workspace.id, context('staff'), 'document', 'doc-outsider', 'edit').allowed, false);

    const explanation = explainObjectAccess(database, workspace.id, 'document', 'doc-outsider');
    assert.equal(explanation.policy.owner_person_id, 'outsider');
    assert.equal(explanation.grants[0].access_role, 'reader');
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('поручение, распоряжение и научный материал наследуют связь с человеком', () => {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-acl-rel-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addPerson(database, workspace.id, 'manager', 'Руководитель');
    addPerson(database, workspace.id, 'staff', 'Сотрудник', 'manager');
    addPerson(database, workspace.id, 'outsider', 'Посторонний');
    addDocument(database, workspace.id, 'directive-doc', 'directive-ver', 'Приказ');
    const now = '2026-08-07T00:00:00.000Z';
    database.run(`
      INSERT INTO directives(id,workspace_id,source_document_version_id,directive_kind,title,direction,status,confidence,evidence_json,created_at,updated_at)
      VALUES('directive-1',?,'directive-ver','order','Приказ','organizational','active',1,'{}',?,?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO assignments(id,workspace_id,directive_id,title,instruction_text,direction,status,confidence,evidence_json,created_at,updated_at)
      VALUES('assignment-1',?,'directive-1','Задание','Исполнить','organizational','open',1,'{}',?,?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO assignment_executors(assignment_id,person_id,executor_raw,role,created_at)
      VALUES('assignment-1','staff','Сотрудник','executor',?)
    `, now);
    database.run(`
      INSERT INTO scientific_items(id,workspace_id,item_kind,title,status,direction,confidence,evidence_json,created_at,updated_at)
      VALUES('science-1',?,'article','Статья','confirmed','science',1,'{}',?,?)
    `, workspace.id, now, now);
    database.run(`
      INSERT INTO scientific_item_authors(scientific_item_id,person_id,author_raw,author_order,created_at)
      VALUES('science-1','staff','Сотрудник',1,?)
    `, now);

    assert.equal(assignmentAccess(database, workspace.id, context('staff'), 'assignment-1', 'edit').allowed, true);
    assert.equal(assignmentAccess(database, workspace.id, context('outsider'), 'assignment-1').allowed, false);
    assert.equal(resolveObjectAccess(database, workspace.id, context('staff'), 'directive', 'directive-1').allowed, true);
    assert.equal(resolveObjectAccess(database, workspace.id, context('manager', 'manager'), 'directive', 'directive-1').role, 'controller');
    assert.equal(resolveObjectAccess(database, workspace.id, context('staff'), 'scientific_item', 'science-1').role, 'owner');
    assert.equal(resolveObjectAccess(database, workspace.id, context('manager', 'manager'), 'scientific_item', 'science-1').role, 'controller');
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
