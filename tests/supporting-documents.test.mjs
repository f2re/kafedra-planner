import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import {
  createSupportingDocument,
  deleteSupportingDocument,
  getSupportingDocument,
  linkSupportingDocument,
  listSupportingDocuments,
  unlinkSupportingDocument
} from '../packages/supporting-documents/src/service.mjs';

const migrationsDir = resolve('migrations');

function addDocument(database, workspaceId, id, versionId, originalName, now = '2026-08-18T06:00:00.000Z') {
  const blob = `blob_${id}`;
  database.run(
    'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    blob, 1, 'application/pdf', `/tmp/${id}`, now
  );
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,?,'other','processed',?,?,?)
  `, id, workspaceId, originalName.replace(/\.[^.]+$/u, ''), versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,
      processing_status,uploaded_at
    ) VALUES (?,?,1,?,?,?,'pdf','processed',?)
  `, versionId, id, blob, originalName, 'application/pdf', now);
}

test('сопроводительные документы связываются идемпотентно и отвязываются без удаления исходника', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-supporting-documents-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const actor = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    addDocument(database, workspace.id, 'doc_source', 'ver_source', 'source.pdf');
    addDocument(database, workspace.id, 'doc_evidence', 'ver_evidence', 'evidence.pdf');

    const support = createSupportingDocument(database, workspace.id, {
      documentNumber: 'ВХ-18/26',
      documentDate: '2026-08-18',
      title: 'Регистрационная карточка',
      documentVersionId: 'ver_evidence',
      targetKind: 'document',
      targetId: 'doc_source',
      relationKind: 'evidence'
    }, actor.id);
    assert.equal(support.document_version_id, 'ver_evidence');
    assert.equal(listSupportingDocuments(database, workspace.id, {
      targetKind: 'document', targetId: 'doc_source'
    }).length, 1);

    linkSupportingDocument(database, workspace.id, support.id, {
      targetKind: 'document', targetId: 'doc_source', relationKind: 'evidence', note: 'Повторная привязка'
    }, actor.id);
    assert.equal(database.get(`
      SELECT COUNT(*) AS count FROM supporting_document_links
      WHERE supporting_document_id = ? AND target_kind = 'document' AND target_id = 'doc_source'
    `, support.id).count, 1);

    unlinkSupportingDocument(database, workspace.id, support.id, {
      targetKind: 'document', targetId: 'doc_source', relationKind: 'evidence'
    }, actor.id);
    assert.equal(listSupportingDocuments(database, workspace.id, {
      targetKind: 'document', targetId: 'doc_source'
    }).length, 0);
    assert.ok(getSupportingDocument(database, workspace.id, support.id));
    assert.ok(database.get("SELECT id FROM documents WHERE id = 'doc_source'"));
    assert.ok(database.get("SELECT id FROM documents WHERE id = 'doc_evidence'"));
    assert.ok(database.get("SELECT id FROM document_versions WHERE id = 'ver_evidence'"));
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('ошибка связи откатывает реквизиты, а мягкое удаление сохраняет доказательство публикации', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-supporting-rollback-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const actor = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович' });
    addDocument(database, workspace.id, 'doc_publication', 'ver_publication', 'publication-proof.pdf');
    const science = createScientificItem(database, workspace.id, {
      title: 'Методы прогноза осадков',
      kind: 'article',
      authors: ['Петров Пётр Петрович'],
      publicationYear: 2026
    });

    const before = database.get('SELECT COUNT(*) AS count FROM supporting_documents').count;
    assert.throws(() => createSupportingDocument(database, workspace.id, {
      documentNumber: 'BAD-1',
      documentDate: '2026-08-18',
      targetKind: 'assignment',
      targetId: 'missing-assignment',
      relationKind: 'completion'
    }, actor.id), /supporting_document_target_not_found/u);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM supporting_documents').count, before);

    const support = createSupportingDocument(database, workspace.id, {
      documentNumber: 'PUB-2026-18',
      documentDate: '2026-08-18',
      title: 'Справка о публикации',
      documentId: 'doc_publication',
      targetKind: 'scientific_item',
      targetId: science.id,
      relationKind: 'publication'
    }, actor.id);
    assert.ok(support.links.some((link) =>
      link.target_kind === 'scientific_item' && link.relation_kind === 'publication'
    ));

    deleteSupportingDocument(database, workspace.id, support.id, actor.id);
    assert.equal(getSupportingDocument(database, workspace.id, support.id).status, 'deleted');
    assert.ok(database.get("SELECT id FROM documents WHERE id = 'doc_publication'"));
    assert.ok(database.get("SELECT id FROM document_versions WHERE id = 'ver_publication'"));
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
