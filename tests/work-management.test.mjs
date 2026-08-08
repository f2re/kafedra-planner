import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  createPerson,
  persistDirective,
  createPeriodicTask,
  attachAssignmentReport,
  searchWork
} from '../packages/work-management/src/service.mjs';
import { extractDirective } from '../packages/work-management/src/extractor.mjs';

const migrationsDir = resolve('migrations');

function addTextDocument(database, workspaceId, { id, versionId, blobSha, title, fileName, now }) {
  database.run(
    'INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    blobSha, 1, 'text/plain', `/tmp/${blobSha}`, now
  );
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?, ?, ?, 'directive', 'processed', ?, ?, ?)
  `, id, workspaceId, title, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at
    ) VALUES (?, ?, 1, ?, ?, 'text/plain', 'text', 'processed', ?)
  `, versionId, id, blobSha, fileName, now);
}

test('сохраняет распоряжение, поручения, календарь и отчёт', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-work-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const person = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const now = new Date().toISOString();
    addTextDocument(database, workspace.id, {
      id: 'd', versionId: 'v', blobSha: 'a', title: 'Распоряжение', fileName: 'r.txt', now
    });

    const result = extractDirective('РАСПОРЯЖЕНИЕ\nот 5 августа 2026 года № 1-р\nРАСПОРЯЖАЮСЬ:\n1. Подготовить отчёт до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.');
    const directive = persistDirective(database, {
      workspaceId: workspace.id, documentVersionId: 'v', documentTitle: 'Распоряжение', result
    });
    assert.equal(directive.assignments.length, 1);
    assert.equal(directive.assignments[0].executors[0].person_id, person.id);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='assignment'").n, 1);

    database.run("INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES ('b',1,'text/plain','/tmp/b',?)", now);
    database.run("INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES ('report',?,'Отчёт','report','processed','rv',?,?)", workspace.id, now, now);
    database.run("INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at) VALUES ('rv','report',1,'b','report.txt','text/plain','text','processed',?)", now);
    const withReport = attachAssignmentReport(database, workspace.id, directive.assignments[0].id, { documentId: 'report' });
    assert.equal(withReport.status, 'submitted');
    assert.equal(withReport.reports.length, 1);

    createPeriodicTask(database, workspace.id, {
      ownerPersonId: person.id, periodKind: 'semester', periodKey: '2026-1',
      title: 'Семестровый отчёт', dueDate: '2026-12-20', direction: 'education'
    });
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='periodic_task'").n, 1);
    const search = searchWork(database, workspace.id, { executor: 'Иванов' });
    assert.ok(search.items.some((item) => item.sourceKind === 'assignment'));
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('соисполнители сохраняются, повторный persist идемпотентен, а неполный пункт не блокирует документ', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-work-directive-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    for (const displayName of [
      'Иванов Иван Иванович',
      'Петров Пётр Петрович',
      'Сидоров Сергей Сергеевич',
      'Кузнецов Алексей Алексеевич',
      'Орлов Олег Олегович'
    ]) createPerson(database, workspace.id, { displayName });

    const now = new Date().toISOString();
    addTextDocument(database, workspace.id, {
      id: 'order-doc', versionId: 'order-v', blobSha: 'order-blob', title: 'Приказ', fileName: 'order.txt', now
    });
    const orderText = await readFile(new URL('./fixtures/directive-order.txt', import.meta.url), 'utf8');
    const orderResult = extractDirective(orderText);
    const first = persistDirective(database, {
      workspaceId: workspace.id, documentVersionId: 'order-v', documentTitle: 'Приказ', result: orderResult, now
    });
    const second = persistDirective(database, {
      workspaceId: workspace.id, documentVersionId: 'order-v', documentTitle: 'Приказ', result: orderResult, now
    });
    assert.equal(second.id, first.id);
    const firstExecutors = first.assignments[0].executors;
    assert.equal(firstExecutors.filter((item) => item.role === 'executor').length, 1);
    assert.equal(firstExecutors.filter((item) => item.role === 'coexecutor').length, 2);
    assert.equal(firstExecutors.every((item) => item.person_id), true);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM directives').n, 1);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM assignments').n, 2);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM assignment_executors').n, 4);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='assignment'").n, 1);

    addTextDocument(database, workspace.id, {
      id: 'decree-doc', versionId: 'decree-v', blobSha: 'decree-blob', title: 'Указ', fileName: 'decree.txt', now
    });
    const decreeText = await readFile(new URL('./fixtures/directive-decree.txt', import.meta.url), 'utf8');
    const decree = persistDirective(database, {
      workspaceId: workspace.id,
      documentVersionId: 'decree-v',
      documentTitle: 'Указ',
      result: extractDirective(decreeText),
      now
    });
    assert.equal(decree.assignments.length, 2);
    assert.equal(decree.assignments[0].executors.length, 0);
    assert.equal(decree.assignments[1].executors[0].display_name, 'Орлов Олег Олегович');
    const reviews = database.all(`
      SELECT issue_code FROM review_items
      WHERE source_kind = 'assignment' AND source_id IN (?, ?)
      ORDER BY issue_code
    `, decree.assignments[0].id, decree.assignments[1].id).map((row) => row.issue_code);
    assert.ok(reviews.includes('executor_missing'));
    assert.ok(reviews.includes('due_date_missing'));
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
