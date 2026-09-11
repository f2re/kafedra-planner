import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createMeeting, addAgendaItem, transferAgendaItem, updateMeeting, getMeeting, listMeetings } from '../packages/protocols/src/meetings.mjs';

const migrationsDir = resolve('migrations');

test('перенос и новая дата переживают перезапуск; дубликат источника не уничтожает ни один вопрос', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meeting-restart-'));
  const path = join(dir, 'db.sqlite3');
  let db = new Database(path, { migrationsDir });
  try {
    const ws = ensureDefaultWorkspace(db);
    const plan = createManualPlan(db, ws.id, { title: 'План', planKind: 'department', periodKind: 'calendar', yearStart: 2036 });
    const source = createManualPlanItem(db, ws.id, plan.id, { title: 'Общий пункт', executionMode: 'track' });
    let a = createMeeting(db, ws.id, { meetingDate: '2036-09-15', protocolNumber: 'before' });
    let b = createMeeting(db, ws.id, { meetingDate: '2039-01-10', protocolNumber: 'after' });
    a = addAgendaItem(db, ws.id, a.id, { sourceKind: 'plan_item', sourceId: source.id });
    b = addAgendaItem(db, ws.id, b.id, { sourceKind: 'plan_item', sourceId: source.id });
    const request = { targetMeetingId: b.id, requestId: 'duplicate-attempt' };
    assert.throws(() => transferAgendaItem(db, ws.id, a.id, a.agenda[0].id, request), /agenda_source_duplicate/u);
    assert.equal(getMeeting(db, ws.id, a.id).agenda[0].id, a.agenda[0].id);
    assert.equal(getMeeting(db, ws.id, b.id).agenda[0].id, b.agenda[0].id);
    a = addAgendaItem(db, ws.id, a.id, { title: 'Устойчивый вопрос', decisionText: 'Сохранить', dueDate: '2039-02-01' });
    const item = a.agenda[1];
    request.requestId = 'durable-transfer';
    transferAgendaItem(db, ws.id, a.id, item.id, request);
    updateMeeting(db, ws.id, b.id, { meetingDate: '2040-02-20' });
    db.close();
    db = new Database(path, { migrationsDir });
    db.migrate(migrationsDir);
    const saved = getMeeting(db, ws.id, b.id);
    assert.equal(saved.meeting_date, '2040-02-20');
    assert.equal(saved.agenda[1].id, item.id);
    assert.equal(saved.agenda[1].decision.id, item.decision.id);
    assert.equal(listMeetings(db, ws.id, { year: 2040 })[0].id, b.id);
    assert.equal(listMeetings(db, ws.id, { year: 2039 }).length, 0);
    assert.equal(listMeetings(db, ws.id, { query: 'after', limit: 1 })[0].id, b.id);
    assert.equal(transferAgendaItem(db, ws.id, a.id, item.id, request).duplicateRequest, true);
    assert.equal(db.get('PRAGMA quick_check').quick_check, 'ok');
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
