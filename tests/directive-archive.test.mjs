import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  attachDirectiveMaterial,
  createDirectiveArchiveEntry,
  detachDirectiveMaterial,
  getDirectiveArchiveEntry,
  listDirectiveArchive,
  updateDirectiveArchiveEntry
} from '../packages/directive-archive/src/service.mjs';

const migrationsDir = resolve('migrations');

function addDocument(database, workspaceId, {
  id,
  versionId,
  sha,
  title,
  originalName,
  mediaType = 'application/pdf',
  now = '2026-08-25T05:00:00.000Z'
}) {
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, 128, ?, ?, ?)
  `, sha, mediaType, `/tmp/${sha}`, now);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES (?, ?, ?, 'unknown', 'processed', ?, ?, ?)
  `, id, workspaceId, title, versionId, now, now);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type,
      detected_format, processing_status, extracted_text, uploaded_at
    ) VALUES (?, ?, 1, ?, ?, ?, 'pdf', 'processed', ?, ?)
  `, versionId, id, sha, originalName, mediaType, title, now);
}

test('архив распоряжений хранит реквизиты, материалы, поиск и синхронизирует календарь', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-directive-archive-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addDocument(database, workspace.id, {
      id: 'directive-doc', versionId: 'directive-v1', sha: 'directive-sha',
      title: 'Распоряжение о проведении конференции', originalName: '47-r.pdf'
    });

    const created = createDirectiveArchiveEntry(database, {
      workspaceId: workspace.id,
      documentVersionId: 'directive-v1',
      documentNumber: '47-р',
      issuedAt: '2026-08-20',
      title: 'О проведении кафедральной конференции',
      directiveKind: 'Распоряжение',
      direction: 'science',
      issuerRaw: 'Декан факультета',
      summary: 'Организовать конференцию и представить отчёт.',
      now: '2026-08-20T09:00:00.000Z'
    });

    assert.equal(created.document_number, '47-р');
    assert.equal(created.issued_at, '2026-08-20');
    assert.equal(created.material_count, 0);
    assert.equal(created.source_document_id, 'directive-doc');

    const calendar = database.get(`
      SELECT * FROM calendar_items
      WHERE workspace_id = ? AND source_kind = 'directive' AND source_id = ?
    `, workspace.id, created.id);
    assert.ok(calendar);
    assert.equal(calendar.starts_at, '2026-08-20');
    assert.match(calendar.title, /47-р/u);
    assert.equal(calendar.category, 'science');

    addDocument(database, workspace.id, {
      id: 'report-doc', versionId: 'report-v1', sha: 'report-sha',
      title: 'Отчёт о конференции', originalName: 'report.pdf',
      now: '2026-08-23T10:00:00.000Z'
    });
    database.run(`
      INSERT INTO search_fragments(
        id, workspace_id, source_kind, source_id, document_version_id,
        title, content, locator_json, created_at
      ) VALUES ('report-fragment', ?, 'document', 'report-doc', 'report-v1',
        'Отчёт о конференции', 'Фотоматериалы участников и итоговый протокол секции', '{}', ?)
    `, workspace.id, '2026-08-23T10:01:00.000Z');
    database.run(`
      INSERT INTO search_fts(fragment_id, title, content)
      VALUES ('report-fragment', 'Отчёт о конференции', 'Фотоматериалы участников и итоговый протокол секции')
    `);

    const attached = attachDirectiveMaterial(database, workspace.id, created.id, {
      documentId: 'report-doc',
      kind: 'report',
      title: 'Итоговый отчёт конференции',
      materialDate: '2026-08-23',
      note: 'Основной отчёт с подтверждающими материалами.'
    }, '2026-08-23T10:05:00.000Z');
    assert.equal(attached.material_count, 1);
    assert.equal(attached.materials[0].document_id, 'report-doc');
    assert.equal(attached.materials[0].origin, 'directive');

    const byNumber = listDirectiveArchive(database, workspace.id, { q: '47-р' });
    assert.equal(byNumber.items.length, 1);
    assert.equal(byNumber.items[0].id, created.id);

    const byMaterialTitle = listDirectiveArchive(database, workspace.id, { q: 'Итоговый отчёт' });
    assert.equal(byMaterialTitle.items.length, 1);

    const byExtractedMaterialText = listDirectiveArchive(database, workspace.id, { q: 'Фотоматериалы' });
    assert.equal(byExtractedMaterialText.items.length, 1);

    const withReports = listDirectiveArchive(database, workspace.id, { report: 'with' });
    assert.equal(withReports.items.length, 1);
    assert.equal(withReports.items[0].material_count, 1);

    const updated = updateDirectiveArchiveEntry(database, workspace.id, created.id, {
      issuedAt: '2026-08-21',
      documentNumber: '48-р',
      title: 'О проведении кафедральной конференции — уточнение',
      direction: 'organizational'
    }, '2026-08-24T11:00:00.000Z');
    assert.equal(updated.document_number, '48-р');

    const movedCalendar = database.get(`
      SELECT * FROM calendar_items
      WHERE workspace_id = ? AND source_kind = 'directive' AND source_id = ?
    `, workspace.id, created.id);
    assert.equal(movedCalendar.starts_at, '2026-08-21');
    assert.match(movedCalendar.title, /48-р/u);
    assert.equal(movedCalendar.category, 'organizational');
    assert.ok(movedCalendar.revision > calendar.revision);

    const directMaterial = database.get(`
      SELECT id FROM directive_report_materials WHERE directive_id = ?
    `, created.id);
    const detached = detachDirectiveMaterial(
      database, workspace.id, created.id, directMaterial.id, '2026-08-24T12:00:00.000Z'
    );
    assert.equal(detached.material_count, 0);
    assert.equal(listDirectiveArchive(database, workspace.id, { report: 'without' }).items.length, 1);

    assert.ok(database.get(`SELECT id FROM documents WHERE id = 'report-doc'`), 'отвязка не должна удалять исходный документ');
    assert.equal(database.get(`SELECT COUNT(*) AS n FROM audit_log WHERE subject_kind='directive' AND subject_id=?`, created.id).n, 4);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('материал можно отнести к конкретному поручению, не теряя связь со всем распоряжением', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-directive-assignment-material-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    addDocument(database, workspace.id, {
      id: 'directive-doc-2', versionId: 'directive-v2', sha: 'directive-sha-2',
      title: 'Приказ о подготовке отчёта', originalName: 'order.pdf'
    });
    const directive = createDirectiveArchiveEntry(database, {
      workspaceId: workspace.id,
      documentVersionId: 'directive-v2', documentNumber: '15', issuedAt: '2026-08-10',
      title: 'О подготовке отчёта', directiveKind: 'Приказ', direction: 'organizational'
    });
    database.run(`
      INSERT INTO assignments(
        id, workspace_id, directive_id, source_item_no, title, instruction_text,
        starts_at, due_date, direction, priority, status, expected_result,
        report_required, confidence, evidence_json, created_at, updated_at
      ) VALUES ('assignment-one', ?, ?, '1', 'Подготовить отчёт', 'Подготовить итоговый отчёт.',
        '2026-08-10', '2026-08-20', 'organizational', 'normal', 'open', 'Отчёт', 1, 1, '{}', ?, ?)
    `, workspace.id, directive.id, '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z');

    addDocument(database, workspace.id, {
      id: 'evidence-doc', versionId: 'evidence-v1', sha: 'evidence-sha',
      title: 'Скан акта', originalName: 'act.jpg', mediaType: 'image/jpeg'
    });
    const result = attachDirectiveMaterial(database, workspace.id, directive.id, {
      documentId: 'evidence-doc', assignmentId: 'assignment-one', kind: 'scan',
      title: 'Скан подписанного акта', materialDate: '2026-08-19'
    });
    assert.equal(result.material_count, 1);
    assert.equal(result.materials[0].assignment_id, 'assignment-one');
    assert.equal(result.materials[0].directive_id, directive.id);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
