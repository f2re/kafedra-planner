import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { registerDocument, requestDocumentReprocess } from '../packages/storage/src/documents.mjs';

const migrationsDir = resolve('migrations');

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-reprocess-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try { await run(database, ensureDefaultWorkspace(database), dir); }
  finally { database.close(); await rm(dir, { recursive: true, force: true }); }
}

test('повторная обработка использует ту же immutable document_version и идемпотентна пока job активен', () => fixture(async (database, workspace, dir) => {
  const created = registerDocument(database, {
    workspaceId: workspace.id,
    title: 'Протокол 7',
    originalName: 'protocol.pdf',
    mediaType: 'application/pdf',
    detectedFormat: 'pdf',
    requestedType: 'protocol',
    idempotencyKey: 'protocol-year:2026:fixture',
    blob: {
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
      storagePath: join(dir, 'protocol.pdf')
    }
  });
  database.run("UPDATE jobs SET status='completed' WHERE id=?", created.jobId);
  database.run("UPDATE document_versions SET processing_status='needs_review' WHERE id=?", created.versionId);
  database.run("UPDATE documents SET status='needs_review' WHERE id=?", created.documentId);
  database.run(`INSERT INTO extraction_runs(
    id,document_version_id,extractor_code,extractor_version,status,started_at,completed_at
  ) VALUES ('extract_old',?,'department-protocol','1','needs_review',?,?)`,
  created.versionId, '2026-09-05T08:00:00.000Z', '2026-09-05T08:00:01.000Z');

  const first = requestDocumentReprocess(database, {
    workspaceId: workspace.id,
    documentId: created.documentId
  });
  assert.equal(first.documentId, created.documentId);
  assert.equal(first.versionId, created.versionId);
  assert.equal(first.sha256, created.sha256);
  assert.equal(first.status, 'queued');
  assert.equal(first.duplicateRequest, false);
  assert.equal(database.get('SELECT processing_status FROM document_versions WHERE id=?', created.versionId).processing_status, 'queued');

  const duplicate = requestDocumentReprocess(database, {
    workspaceId: workspace.id,
    documentId: created.documentId
  });
  assert.equal(duplicate.jobId, first.jobId);
  assert.equal(duplicate.duplicateRequest, true);

  assert.equal(database.get('SELECT COUNT(*) count FROM documents').count, 1);
  assert.equal(database.get('SELECT COUNT(*) count FROM document_versions').count, 1);
  assert.equal(database.get('SELECT COUNT(*) count FROM extraction_runs WHERE document_version_id=?', created.versionId).count, 1);
  assert.equal(database.get('SELECT COUNT(*) count FROM audit_log WHERE action=?', 'document.reprocess_requested').count, 1);

  database.run("UPDATE jobs SET status='completed' WHERE id=?", first.jobId);
  const second = requestDocumentReprocess(database, {
    workspaceId: workspace.id,
    documentId: created.documentId
  });
  assert.notEqual(second.jobId, first.jobId);
  assert.equal(second.versionId, created.versionId);
  assert.equal(second.sha256, created.sha256);
  assert.equal(database.get("SELECT COUNT(*) count FROM jobs WHERE idempotency_key LIKE 'reprocess:%'").count, 2);
  assert.equal(database.quickCheck(), true);
  assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
}));

test('повторная обработка отсутствующего документа не создаёт job', () => fixture(async (database, workspace) => {
  const result = requestDocumentReprocess(database, { workspaceId: workspace.id, documentId: 'missing' });
  assert.equal(result, null);
  assert.equal(database.get("SELECT COUNT(*) count FROM jobs WHERE idempotency_key LIKE 'reprocess:%'").count, 0);
}));
