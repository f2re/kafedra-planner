import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson, persistDirective, attachAssignmentReport, addAssignmentProgress } from '../packages/work-management/src/service.mjs';
import { createPeriodicTaskV2 } from '../packages/work-management/src/periodic-tasks.mjs';
import { searchFaceted } from '../packages/storage/src/faceted-search.mjs';

const migrationsDir = resolve('migrations');

async function addDocument(database, workspaceId, root, { id, versionId, title, text, documentType }) {
  const path = join(root, `${id}.txt`);
  await writeFile(path, text);
  const bytes = Buffer.from(text);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const now = '2026-08-08T10:00:00.000Z';
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)`, sha, bytes.length, 'text/plain', path, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES (?,?,?,?, 'processed', ?, ?, ?)`, id, workspaceId, title, documentType, versionId, now, now);
  database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,extracted_text,uploaded_at) VALUES (?,?,1,?,'source.txt','text/plain','text','processed',?,?)`, versionId, id, sha, text, now);
  return { id, versionId };
}

test('единый поиск работает без текста и фильтрует номер, человека, просрочку, отчёт и период', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-faceted-search-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Смирнов Сергей Сергеевич' });
    const executor = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович', managerId: manager.id });
    const periodicOwner = createPerson(database, workspace.id, { displayName: 'Петров Пётр Петрович', managerId: manager.id });
    const source = await addDocument(database, workspace.id, root, {
      id: 'directive-doc', versionId: 'directive-v', title: 'Приказ 77-р', documentType: 'order',
      text: 'ПРИКАЗ № 77-р. Подготовить отчёт по НИР.'
    });
    const directive = persistDirective(database, {
      workspaceId: workspace.id, documentVersionId: source.versionId, documentTitle: 'Приказ 77-р',
      now: '2026-08-08T10:00:00.000Z',
      result: {
        kind: 'order', documentNumber: '77-р', issuedAt: '2026-08-08', issuerRaw: 'Директор А.А. Смирнов',
        title: 'О подготовке отчёта по НИР', summary: 'Подготовить отчёт', direction: 'science', status: 'active', confidence: 1,
        evidence: {}, assignments: [{ itemNo: '1', title: 'Подготовить отчёт по НИР', instructionText: 'Подготовить отчёт по НИР', dueDate: '2026-08-20', executorRaw: executor.display_name, coexecutorRaws: [], controllerRaw: manager.display_name, direction: 'science', priority: 'normal', expectedResult: 'Отчёт', reportRequired: true, confidence: 1, evidence: { locator: { startLine: 1, endLine: 1 } } }]
      }
    });
    const assignment = directive.assignments[0];
    createPeriodicTaskV2(database, workspace.id, {
      ownerPersonId: periodicOwner.id, title: 'Семестровая сверка', periodKind: 'semester', periodKey: '2026-1', startsAt: '2026-08-15', dueDate: '2026-09-10', direction: 'education'
    }, { actorPersonId: manager.id, now: '2026-08-08T10:00:00.000Z' });

    const byNumber = searchFaceted(database, workspace.id, { sourceKind: 'directive', number: '77-р' }, 20);
    assert.equal(byNumber.items.length, 1);
    assert.equal(byNumber.items[0].source_id, directive.id);
    assert.equal(byNumber.items[0].source_document_id, 'directive-doc');

    const byExecutor = searchFaceted(database, workspace.id, { sourceKind: 'assignment', person: 'Иванов', role: 'executor' }, 20);
    assert.equal(byExecutor.items.length, 1);
    assert.equal(byExecutor.items[0].source_id, assignment.id);
    assert.match(byExecutor.items[0].executor, /Иванов/u);

    const overdue = searchFaceted(database, workspace.id, { sourceKind: 'assignment', status: 'overdue', today: '2026-08-21' }, 20);
    assert.equal(overdue.items.length, 1);
    assert.equal(overdue.items[0].overdue, true);

    const withoutReport = searchFaceted(database, workspace.id, { sourceKind: 'assignment', report: 'without' }, 20);
    assert.equal(withoutReport.items.length, 1);

    const periodic = searchFaceted(database, workspace.id, { sourceKind: 'periodic_task', period: '2026-1', person: 'Петров' }, 20);
    assert.equal(periodic.items.length, 1);
    assert.equal(periodic.items[0].event_date, '2026-09-10');
    assert.equal(periodic.items[0].period, '2026-1');

    const report = await addDocument(database, workspace.id, root, {
      id: 'report-doc', versionId: 'report-v', title: 'Отчёт 77-р', documentType: 'report', text: 'Отчёт выполнен полностью.'
    });
    attachAssignmentReport(database, workspace.id, assignment.id, { documentId: report.id, actorPersonId: executor.id }, '2026-08-19T10:00:00.000Z');
    addAssignmentProgress(database, workspace.id, assignment.id, { status: 'completed', actorPersonId: manager.id }, '2026-08-20T10:00:00.000Z');
    const confirmed = searchFaceted(database, workspace.id, { sourceKind: 'assignment', report: 'confirmed' }, 20);
    assert.equal(confirmed.items.length, 1);
    assert.equal(confirmed.items[0].report_state, 'confirmed');

    const text = searchFaceted(database, workspace.id, { q: 'отчёт', direction: 'science' }, 50);
    assert.ok(text.items.some((item) => item.source_id === assignment.id));
    assert.ok(text.facets.directions.includes('science'));
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
