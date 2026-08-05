import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  createCalendarItem,
  listNotifications,
  setNotificationState,
  updateCalendarItem
} from '../packages/calendar/src/service.mjs';

test('задача проходит понятный поток напоминания и завершения', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-calendar-'));
  const database = new Database(join(directory, 'calendar.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database, '2026-08-05T07:00:00.000Z');
    const task = createCalendarItem(database, workspace.id, {
      title: 'Сдать отчёт', kind: 'task', startsAt: '2026-08-05',
      reminderMinutes: 60, category: 'science', importance: 'high'
    }, '2026-08-05T07:00:00.000Z');
    createCalendarItem(database, workspace.id, {
      title: 'Просроченная задача', kind: 'task', startsAt: '2026-08-04',
      category: 'organizational', importance: 'normal'
    }, '2026-08-04T07:00:00.000Z');

    const notifications = listNotifications(database, workspace.id, { now: new Date('2026-08-05T08:00:00.000Z') });
    assert.equal(notifications.length, 2);
    assert.ok(notifications.some((item) => item.kind === 'reminder' && item.calendarItemId === task.id));
    assert.ok(notifications.some((item) => item.kind === 'overdue'));

    const reminder = notifications.find((item) => item.kind === 'reminder');
    setNotificationState(database, workspace.id, reminder.key, 'read', '2026-08-05T08:01:00.000Z');
    assert.equal(listNotifications(database, workspace.id, { now: new Date('2026-08-05T08:02:00.000Z') }).find((item) => item.key === reminder.key).read, true);

    updateCalendarItem(database, workspace.id, task.id, { status: 'completed' }, '2026-08-05T08:03:00.000Z');
    assert.equal(listNotifications(database, workspace.id, { now: new Date('2026-08-05T08:04:00.000Z') }).some((item) => item.calendarItemId === task.id), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
