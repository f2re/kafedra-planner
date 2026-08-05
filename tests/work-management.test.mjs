import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson, persistDirective, createPeriodicTask, attachAssignmentReport, searchWork } from '../packages/work-management/src/service.mjs';
import { extractDirective } from '../packages/work-management/src/extractor.mjs';

const migrationsDir = resolve('migrations');

test('сохраняет распоряжение, поручения, календарь и отчёт', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-work-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const person = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const now = new Date().toISOString();
    database.run("INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES ('a',1,'text/plain','/tmp/a',?)", now);
    database.run("INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES ('d',?,'Распоряжение','directive','processed','v',?,?)", workspace.id, now, now);
    database.run("INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at) VALUES ('v','d',1,'a','r.txt','text/plain','text','processed',?)", now);

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
