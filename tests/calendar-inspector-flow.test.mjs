import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  createCalendarItem,
  getCalendarItem,
  listCalendarItems,
  updateCalendarItem,
  undoCalendarItem
} from '../packages/calendar/src/service.mjs';

test('перенос календарной записи версионируется и полностью отменяется', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-calendar-revision-'));
  const database = new Database(join(directory, 'calendar.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database, '2026-08-05T06:00:00.000Z');
    const item = createCalendarItem(database, workspace.id, {
      title: 'Заседание рабочей группы',
      startsAt: '2026-08-07T11:30:00',
      kind: 'event',
      category: 'science',
      importance: 'high'
    }, '2026-08-05T06:00:00.000Z');

    const moved = updateCalendarItem(database, workspace.id, item.id, {
      startsAt: '2026-08-12T11:30:00',
      action: 'reschedule'
    }, '2026-08-05T06:05:00.000Z');
    assert.equal(moved.starts_at, '2026-08-12T11:30:00');
    assert.equal(moved.revision, 2);
    assert.ok(moved.undo_revision_id);

    const history = database.all(
      'SELECT * FROM calendar_item_revisions WHERE calendar_item_id = ?',
      item.id
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].action, 'reschedule');

    const restored = undoCalendarItem(database, workspace.id, item.id, '2026-08-05T06:06:00.000Z');
    assert.equal(restored.starts_at, '2026-08-07T11:30:00');
    assert.equal(restored.revision, 3);
    assert.equal(getCalendarItem(database, workspace.id, item.id).starts_at, item.starts_at);
    assert.equal(database.get('SELECT undone_at FROM calendar_item_revisions WHERE id = ?', history[0].id).undone_at, '2026-08-05T06:06:00.000Z');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('категории фильтруются одинаково в календарном API-сервисе', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-calendar-filter-'));
  const database = new Database(join(directory, 'calendar.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    createCalendarItem(database, workspace.id, { title: 'Статья', startsAt: '2026-08-07', category: 'science' });
    createCalendarItem(database, workspace.id, { title: 'Учебный план', startsAt: '2026-08-08', category: 'education' });
    const science = listCalendarItems(database, workspace.id, {
      from: '2026-08-01', to: '2026-08-31', categories: ['science']
    });
    assert.deepEqual(science.map((item) => item.title), ['Статья']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
