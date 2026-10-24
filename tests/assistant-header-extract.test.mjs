import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';
import { newId } from '../packages/core/src/ids.mjs';

const migrationsDir = resolve('migrations');

test('POST /api/assistant/extract-header извлекает реквизиты протокола (номер, дата, председатель, секретарь)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-hdr-'));
  const config = loadConfig({
    KAFEDRA_DATA_DIR: dir,
    KAFEDRA_AUTH_ENABLED: 'false',
    KAFEDRA_PREVIEW_ENABLED: 'false',
    KAFEDRA_OCR_ENABLED: 'false',
    KAFEDRA_LLM_ENABLED: 'false'
  });
  await Promise.all([mkdir(config.blobDir, { recursive: true }), mkdir(config.tempDir, { recursive: true })]);

  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const logger = { info() {}, error() {}, warn() {}, debug() {} };
  const server = createApp({ database, config, logger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const docId = newId('doc');
    const versionId = newId('docv');
    const blobSha = 'b'.repeat(64);
    const now = new Date().toISOString();

    const sampleText = `МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РФ
ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ № 14
от 25 ноября 2026 г.
Председатель: проф. Иванов И.И.
Секретарь: доц. Смирнова Е.П.
Присутствовали: 18 членов кафедры.
Повестка дня: 1. Утверждение рабочих планов.`;

    database.run(`
      INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
      VALUES (?, 100, 'text/plain', ?, ?)
    `, blobSha, join(dir, 'sample.txt'), now);

    database.run(`
      INSERT INTO documents(id, workspace_id, current_version_id, title, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Протокол 14', 'ready', ?, ?)
    `, docId, workspace.id, versionId, now, now);

    database.run(`
      INSERT INTO document_versions(
        id, document_id, version_no, blob_sha256, original_name, media_type,
        detected_format, processing_status, extracted_text, uploaded_at
      ) VALUES (?, ?, 1, ?, 'protocol_14.txt', 'text/plain', 'text', 'ready', ?, ?)
    `, versionId, docId, blobSha, sampleText, now);

    // Call /api/assistant/extract-header
    const res = await fetch(`${base}/api/assistant/extract-header`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: docId })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.fields.protocolNumber, '14');
    assert.equal(body.fields.meetingDate, '2026-11-25');
    assert.match(body.fields.chairperson, /Иванов/);
    assert.match(body.fields.secretary, /Смирнова/);
    assert.match(body.fields.attendees, /18 членов/);

    // Test POST /api/assistant/review-repair-apply-all
    const reviewId = newId('rev');
    database.run(`
      INSERT INTO review_items(
        id, workspace_id, source_kind, source_id, issue_code, title,
        explanation, proposed_action, severity, status, context_json, created_at
      ) VALUES (?, ?, 'document_version', ?, 'missing_meeting_date', 'Отсутствует дата заседания', 'Пояснение', 'action', 'warning', 'open', '{}', ?)
    `, reviewId, workspace.id, versionId, now);

    const applyRes = await fetch(`${base}/api/assistant/review-repair-apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { reviewId, appliedValue: '2026-11-25', issueCode: 'missing_meeting_date' }
        ]
      })
    });

    assert.equal(applyRes.status, 200);
    const applyBody = await applyRes.json();
    assert.equal(applyBody.ok, true);
    assert.equal(applyBody.resolvedCount, 1);

    const updatedReview = database.get('SELECT status FROM review_items WHERE id = ?', reviewId);
    assert.equal(updatedReview.status, 'resolved');
  } finally {
    server.close();
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
