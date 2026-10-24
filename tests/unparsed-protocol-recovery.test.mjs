import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { correctProtocolMetadata, protocolCorrectionView } from '../packages/protocols/src/import-corrections.mjs';
import { listReviewItems, resolveReviewItem } from '../packages/storage/src/reviews.mjs';

const migrationsDir = resolve('migrations');

async function fixture(prefix, run) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try { await run(database, ensureDefaultWorkspace(database), dir); }
  finally { database.close(); await rm(dir, { recursive: true, force: true }); }
}

async function createFailedDocument(database, workspaceId, dir, suffix) {
  const now = new Date().toISOString();
  const documentId = `doc_fail_${suffix}`;
  const versionId = `docv_fail_${suffix}`;
  const path = join(dir, `${suffix}.pdf`);
  const text = 'Скан протокола заседания кафедры от 12 сентября 2026 года\nПредседатель: Петров П.П.';
  const sha = createHash('sha256').update(suffix).digest('hex');
  await writeFile(path, text);
  database.run(`INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at)
    VALUES (?,?,'application/pdf',?,?)`, sha, Buffer.byteLength(text), path, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES (?,?,?,'department_protocol','failed',?,?,?)`, documentId, workspaceId, `Протокол ${suffix}`, versionId, now, now);
  database.run(`INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,preview_status,extracted_text,extraction_error,upload_key,uploaded_at
    ) VALUES (?,?,1,?,?,'application/pdf','pdf','failed','failed',?,'Ошибка распознавания скана',?,?)`,
    versionId, documentId, sha, `${suffix}.pdf`, text, `protocol:failed:${suffix}`, now);
  const reviewId = `rev_${suffix}`;
  database.run(`INSERT INTO review_items(id,workspace_id,source_kind,source_id,issue_code,title,explanation,proposed_action,severity,status,context_json,created_at)
    VALUES (?,?,'document_version',?,'protocol_ocr_failed','Не удалось распознать скан','Ошибка распознавания скана','Исправьте вручную','warning','open','{}',?)`,
    reviewId, workspaceId, versionId, now);
  return { documentId, versionId, reviewId };
}

test('оператор может исправить нераспознанный протокол и создать заседание через correctProtocolMetadata', () => fixture(
  'kafedra-unparsed-recovery-', async (database, workspace, dir) => {
    const { documentId, versionId, reviewId } = await createFailedDocument(database, workspace.id, dir, 'scan-1');

    // Проверяем view до исправления
    const viewBefore = protocolCorrectionView(database, workspace.id, documentId);
    assert.equal(viewBefore.meetingId, null);
    assert.equal(viewBefore.processingStatus, 'failed');
    assert.ok(viewBefore.sourceExcerpt.includes('Скан протокола'));

    // Применяем ручную правку реквизитов
    const result = correctProtocolMetadata(database, workspace.id, documentId, {
      documentVersionId: versionId,
      fields: {
        protocolNumber: '4',
        meetingDate: '2026-09-12',
        chairperson: 'Петров П.П.',
        secretary: 'Сидорова С.С.',
        attendees: 'Иванов, Петров, Сидорова'
      }
    });

    assert.ok(result.meetingId);
    const meeting = database.get('SELECT * FROM meetings WHERE id = ?', result.meetingId);
    assert.ok(meeting);
    assert.equal(meeting.protocol_number, '4');
    assert.equal(meeting.meeting_date, '2026-09-12');
    assert.equal(meeting.chairperson_raw, 'Петров П.П.');
    assert.equal(meeting.secretary_raw, 'Сидорова С.С.');

    // Проверяем, что документ и версия перешли в processed
    const doc = database.get('SELECT status FROM documents WHERE id = ?', documentId);
    assert.equal(doc.status, 'processed');
    const docv = database.get('SELECT processing_status, extraction_error FROM document_versions WHERE id = ?', versionId);
    assert.equal(docv.processing_status, 'processed');
    assert.equal(docv.extraction_error, null);

    // Проверяем, что связанный review_item был закрыт
    const review = database.get('SELECT status FROM review_items WHERE id = ?', reviewId);
    assert.equal(review.status, 'resolved');
  }
));

test('resolveReviewItem для нераспознанного протокола создаёт заседание и обогащает список source_excerpt', () => fixture(
  'kafedra-review-resolve-recovery-', async (database, workspace, dir) => {
    const { documentId, versionId, reviewId } = await createFailedDocument(database, workspace.id, dir, 'scan-2');

    // Проверяем, что listReviewItems возвращает поля source_excerpt, document_id, preview_status
    const items = listReviewItems(database, workspace.id, { status: 'open' });
    const item = items.find((it) => it.id === reviewId);
    assert.ok(item);
    assert.equal(item.document_id, documentId);
    assert.equal(item.preview_status, 'failed');
    assert.ok(item.source_excerpt.includes('Скан протокола'));

    // Разрешаем review_item напрямую
    const ok = resolveReviewItem(database, workspace.id, reviewId, { comment: 'Подтверждено оператором' });
    assert.equal(ok, true);
    const review = database.get('SELECT status FROM review_items WHERE id = ?', reviewId);
    assert.equal(review.status, 'resolved');

    // Проверяем, что заседание создалось
    const meeting = database.get('SELECT * FROM meetings WHERE source_document_version_id = ?', versionId);
    assert.ok(meeting);
    assert.equal(meeting.status, 'confirmed_auto');

    // Проверяем статус документа
    const doc = database.get('SELECT status FROM documents WHERE id = ?', documentId);
    assert.equal(doc.status, 'processed');
  }
));
