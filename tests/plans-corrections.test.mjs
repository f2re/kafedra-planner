import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { persistPlan } from '../packages/plans/src/service.mjs';
import { updatePlanItem, undoPlanItemCorrection } from '../packages/plans/src/corrections.mjs';
import { search } from '../packages/storage/src/search.mjs';

test('исправление пункта плана перестраивает календарь и поиск, но сохраняет исходное доказательство и отменяется', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-correction-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const now = '2026-08-07T07:00:00.000Z';
    database.run(
      "INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES ('corrblob',1,'text/plain','/tmp/corr',?)",
      now
    );
    database.run(
      "INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES ('doc_corr',?,'План кафедры','plan','processing','ver_corr',?,?)",
      workspace.id, now, now
    );
    database.run(
      "INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at) VALUES ('ver_corr','doc_corr',1,'corrblob','plan.txt','text/plain','text','extracting',?)",
      now
    );
    const plan = persistPlan(database, {
      workspaceId: workspace.id,
      documentVersionId: 'ver_corr',
      documentTitle: 'План кафедры',
      now,
      result: {
        kind: 'department',
        periodKind: 'academic',
        periodKey: '2026/27',
        yearStart: 2026,
        yearEnd: 2027,
        title: 'План кафедры',
        confidence: 0.9,
        evidence: { period: { kind: 'text_line', line: 2 } },
        items: [{
          sourceItemKey: 'text:line:5',
          itemNo: '1',
          title: 'Подготовить предложения по практике',
          startsAt: null,
          endsAt: null,
          dueDate: null,
          responsibleRaw: 'Иванов Иван Иванович',
          direction: 'education',
          expectedResult: 'Предложения',
          confidence: 0.7,
          evidence: { locator: { kind: 'text_line', line: 5 }, fields: { title: { raw: 'Подготовить предложения по практике' } } }
        }]
      }
    });
    const item = plan.items[0];
    const evidenceBefore = database.get('SELECT evidence_json FROM plan_items WHERE id = ?', item.id).evidence_json;
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='plan_item' AND source_id=?", item.id).n, 0);
    assert.equal(database.get("SELECT status FROM review_items WHERE issue_code='plan_items_without_date'").status, 'open');

    const updated = updatePlanItem(database, workspace.id, plan.id, item.id, {
      dueDate: '2026-10-20',
      responsibleRaw: 'Петров Пётр Петрович',
      reason: 'Срок уточнён по исходной строке'
    }, null, '2026-08-07T07:05:00.000Z');
    assert.equal(updated.due_date, '2026-10-20');
    assert.equal(updated.correction.canUndo, true);
    assert.equal(database.get('SELECT evidence_json FROM plan_items WHERE id = ?', item.id).evidence_json, evidenceBefore);
    const calendar = database.get("SELECT * FROM calendar_items WHERE source_kind='plan_item' AND source_id=?", item.id);
    assert.equal(calendar.item_kind, 'task');
    assert.equal(calendar.starts_at, '2026-10-20');
    assert.equal(calendar.origin_document_id, 'doc_corr');
    assert.equal(database.get("SELECT status FROM review_items WHERE issue_code='plan_items_without_date'").status, 'resolved');
    assert.ok(search(database, workspace.id, 'Петров', 20).some((row) => row.source_id === item.id));
    const correctionAudit = database.get(
      "SELECT * FROM audit_log WHERE action='plan.item.corrected' AND subject_id=?",
      item.id
    );
    assert.ok(correctionAudit);
    assert.equal(JSON.parse(correctionAudit.details_json).evidencePreserved, true);

    const restored = undoPlanItemCorrection(
      database, workspace.id, plan.id, item.id, null, '2026-08-07T07:06:00.000Z'
    );
    assert.equal(restored.due_date, null);
    assert.equal(database.get('SELECT evidence_json FROM plan_items WHERE id = ?', item.id).evidence_json, evidenceBefore);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind='plan_item' AND source_id=?", item.id).n, 0);
    assert.equal(database.get("SELECT status FROM review_items WHERE issue_code='plan_items_without_date'").status, 'open');
    assert.equal(search(database, workspace.id, 'Петров', 20).some((row) => row.source_id === item.id), false);
    assert.ok(database.get(
      "SELECT 1 AS ok FROM audit_log WHERE action='plan.item.correction_undone' AND subject_id=?",
      item.id
    ));
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
