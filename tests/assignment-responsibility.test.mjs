import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { assignmentAccess } from '../packages/access-control/src/service.mjs';
import { createPerson, persistDirective } from '../packages/work-management/src/service.mjs';
import {
  getAssignmentResponsibility,
  updateAssignmentResponsibility
} from '../packages/work-management/src/responsibility.mjs';

const migrationsDir = resolve('migrations');

function auth(personId, role = 'staff') {
  return { authenticated: true, enabled: true, personId, role };
}

function addDirectiveSource(database, workspaceId, now) {
  database.run(`
    INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES ('responsibility-blob',1,'text/plain','/tmp/responsibility-blob',?)
  `, now);
  database.run(`
    INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES ('responsibility-doc',?,'Распоряжение','directive','processed','responsibility-v',?,?)
  `, workspaceId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at
    ) VALUES ('responsibility-v','responsibility-doc',1,'responsibility-blob','r.txt','text/plain','text','processed',?)
  `, now);
}

test('ответственность поручения меняется с историей, наблюдатель остаётся read-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-responsibility-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Смирнов Сергей Сергеевич' });
    const executor = createPerson(database, workspace.id, {
      displayName: 'Иванов Иван Иванович', managerId: manager.id
    });
    const replacement = createPerson(database, workspace.id, {
      displayName: 'Петров Пётр Петрович', managerId: manager.id
    });
    const coexecutor = createPerson(database, workspace.id, { displayName: 'Сидоров Семён Семёнович' });
    const controller = createPerson(database, workspace.id, { displayName: 'Орлов Олег Олегович' });
    const observer = createPerson(database, workspace.id, { displayName: 'Кузнецов Кирилл Кириллович' });
    const now = '2026-08-08T12:00:00.000Z';
    addDirectiveSource(database, workspace.id, now);

    const directive = persistDirective(database, {
      workspaceId: workspace.id,
      documentVersionId: 'responsibility-v',
      documentTitle: 'Распоряжение',
      now,
      result: {
        kind: 'directive', documentNumber: '71-р', issuedAt: '2026-08-08',
        issuerRaw: 'Директор А.А. Смирнов', title: 'О контрольном отчёте',
        summary: 'О контрольном отчёте', direction: 'organizational', confidence: 1,
        evidence: { kind: { raw: 'РАСПОРЯЖЕНИЕ', locator: { startLine: 1, endLine: 1 } } },
        assignments: [{
          itemNo: '1', title: 'Подготовить отчёт', instructionText: 'Подготовить отчёт.',
          dueDate: '2026-08-20', executorRaw: executor.display_name,
          coexecutorRaws: [], controllerRaw: null, direction: 'organizational',
          priority: 'normal', expectedResult: 'Отчёт', reportRequired: true, confidence: 1,
          evidence: { locator: { startLine: 5, endLine: 5 }, raw: 'Подготовить отчёт.' }
        }]
      }
    });
    const assignmentId = directive.assignments[0].id;

    const changed = updateAssignmentResponsibility(database, workspace.id, assignmentId, {
      executorPersonId: replacement.id,
      coexecutorPersonIds: [coexecutor.id],
      controllerPersonId: controller.id,
      observerPersonIds: [observer.id],
      reason: 'Перераспределение нагрузки'
    }, { actorPersonId: manager.id, now: '2026-08-08T12:10:00.000Z' });

    assert.equal(changed.delegatorRaw, 'Директор А.А. Смирнов');
    assert.equal(changed.executor.person_id, replacement.id);
    assert.deepEqual(changed.coexecutors.map((item) => item.person_id), [coexecutor.id]);
    assert.equal(changed.controller.person_id, controller.id);
    assert.deepEqual(changed.observers.map((item) => item.person_id), [observer.id]);
    assert.equal(changed.history.length, 1);
    assert.equal(changed.history[0].reason, 'Перераспределение нагрузки');
    assert.equal(changed.history[0].before.executor.person_id, executor.id);
    assert.equal(changed.history[0].after.executor.person_id, replacement.id);

    assert.equal(assignmentAccess(database, workspace.id, auth(observer.id), assignmentId, 'read').allowed, true);
    assert.equal(assignmentAccess(database, workspace.id, auth(observer.id), assignmentId, 'edit').allowed, false);
    assert.equal(assignmentAccess(database, workspace.id, auth(replacement.id), assignmentId, 'edit').allowed, true);
    assert.equal(assignmentAccess(database, workspace.id, auth(replacement.id), assignmentId, 'control').allowed, false);
    assert.equal(assignmentAccess(database, workspace.id, auth(controller.id), assignmentId, 'control').allowed, true);
    assert.equal(assignmentAccess(database, workspace.id, auth(manager.id, 'manager'), assignmentId, 'control').allowed, true);

    const withoutExecutor = updateAssignmentResponsibility(database, workspace.id, assignmentId, {
      executorPersonId: null,
      coexecutorPersonIds: [coexecutor.id],
      controllerPersonId: controller.id,
      observerPersonIds: [observer.id],
      reason: 'Временное снятие исполнителя'
    }, { actorPersonId: controller.id, now: '2026-08-08T12:20:00.000Z' });
    assert.equal(withoutExecutor.executor, null);
    assert.equal(withoutExecutor.history.length, 2);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM review_items
      WHERE source_kind='assignment' AND source_id=? AND issue_code='executor_missing' AND status='open'
    `, assignmentId).n, 1);

    const restored = updateAssignmentResponsibility(database, workspace.id, assignmentId, {
      executorPersonId: executor.id,
      coexecutorPersonIds: [],
      controllerPersonId: controller.id,
      observerPersonIds: [observer.id],
      reason: 'Исполнитель подтверждён'
    }, { actorPersonId: controller.id, now: '2026-08-08T12:30:00.000Z' });
    assert.equal(restored.executor.person_id, executor.id);
    assert.equal(restored.history.length, 3);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM review_items
      WHERE source_kind='assignment' AND source_id=? AND issue_code='executor_missing' AND status='open'
    `, assignmentId).n, 0);
    assert.equal(database.get(`
      SELECT COUNT(*) AS n FROM audit_log
      WHERE subject_kind='assignment' AND subject_id=? AND action='assignment.responsibility_changed'
    `, assignmentId).n, 3);
    assert.equal(getAssignmentResponsibility(database, workspace.id, assignmentId).history.length, 3);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
