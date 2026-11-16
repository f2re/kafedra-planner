import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { resolveReviewItem } from '../packages/storage/src/reviews.mjs';

const migrationsDir = resolve('migrations');

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-review-bulk-safety-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    await run(database, ensureDefaultWorkspace(database));
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function insertMeetingAndReview(database, workspaceId, { meetingDate = null, protocolNumber = null, issueCode = 'meeting_date_missing' } = {}) {
  const now = new Date().toISOString();
  const meetingId = `meeting_${Math.random().toString(16).slice(2)}`;
  const reviewId = `review_${Math.random().toString(16).slice(2)}`;
  database.run(`
    INSERT INTO meetings(id, workspace_id, title, meeting_date, protocol_number, status, confidence, evidence_json, created_at, updated_at)
    VALUES (?, ?, 'Заседание кафедры', ?, ?, 'confirmed_auto', 1.0, '{}', ?, ?)
  `, meetingId, workspaceId, meetingDate, protocolNumber, now, now);
  database.run(`
    INSERT INTO review_items(id, workspace_id, source_kind, source_id, issue_code, title, explanation, proposed_action, severity, status, context_json, created_at)
    VALUES (?, ?, 'meeting', ?, ?, 'Проверить реквизит', 'Нужно уточнение', 'Уточнить значение', 'warning', 'open', '{}', ?)
  `, reviewId, workspaceId, meetingId, issueCode, now);
  return { meetingId, reviewId };
}

test('bulk AI не перезаписывает вручную заданную дату заседания', () => fixture(async (database, workspace) => {
  const { meetingId, reviewId } = insertMeetingAndReview(database, workspace.id, {
    meetingDate: '2026-11-01',
    issueCode: 'meeting_date_missing'
  });

  const applied = resolveReviewItem(database, workspace.id, reviewId, {
    appliedValue: '2026-10-31',
    resolvedVia: 'ai_assistant_bulk'
  });

  assert.equal(applied, false);
  assert.equal(database.get('SELECT meeting_date FROM meetings WHERE id = ?', meetingId).meeting_date, '2026-11-01');
  assert.equal(database.get('SELECT status FROM review_items WHERE id = ?', reviewId).status, 'open');
}));

test('bulk AI может заполнить пустой реквизит и повтор совпадающего значения безопасен', () => fixture(async (database, workspace) => {
  const first = insertMeetingAndReview(database, workspace.id, { issueCode: 'protocol_number_missing' });
  const applied = resolveReviewItem(database, workspace.id, first.reviewId, {
    appliedValue: '25',
    resolvedVia: 'ai_assistant_bulk'
  });
  assert.equal(applied, true);
  assert.equal(database.get('SELECT protocol_number FROM meetings WHERE id = ?', first.meetingId).protocol_number, '25');

  const second = insertMeetingAndReview(database, workspace.id, {
    protocolNumber: '25',
    issueCode: 'protocol_number_missing'
  });
  const same = resolveReviewItem(database, workspace.id, second.reviewId, {
    appliedValue: '25',
    resolvedVia: 'ai_assistant_bulk'
  });
  assert.equal(same, true);
  assert.equal(database.get('SELECT status FROM review_items WHERE id = ?', second.reviewId).status, 'resolved');
}));
