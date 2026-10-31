import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  listAgendaSources,
  addAgendaItem,
  STANDARD_AGENDA_TOPICS
} from '../packages/protocols/src/meeting-agenda.mjs';

const migrationsDir = resolve('migrations');

test('meeting-agenda: поиск по существующим заседаниям и типовым вопросам кафедры', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-agenda-sources-test-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const now = new Date().toISOString();

  // Create two meetings
  database.run(`
    INSERT INTO meetings(id, workspace_id, title, status, meeting_date, protocol_number, evidence_json, created_at, updated_at)
    VALUES('m-prev', ?, 'Заседание кафедры № 2', 'confirmed_auto', '2026-09-15', '2', '{}', ?, ?)
  `, workspace.id, now, now);

  database.run(`
    INSERT INTO meetings(id, workspace_id, title, status, meeting_date, protocol_number, evidence_json, created_at, updated_at)
    VALUES('m-new', ?, 'Заседание кафедры № 3', 'draft', '2026-10-20', '3', '{}', ?, ?)
  `, workspace.id, now, now);

  // Add agenda item in previous meeting
  database.run(`
    INSERT INTO agenda_items(
      id, meeting_id, item_no, title, heard_text, discussed_text, decision_text,
      evidence_json, created_at, source_kind, source_id, source_label, updated_at
    ) VALUES(
      'ai-prev-1', 'm-prev', 1, 'Об утверждении тем ВКР бакалавров',
      'Заслушаны темы выпускных работ.', 'Замечаний нет.', 'Темы ВКР утвердить в полном объёме.',
      '{}', ?, 'manual', NULL, 'Вручную', ?
    )
  `, now, now);

  // 1. Verify STANDARD_AGENDA_TOPICS are available
  assert.ok(STANDARD_AGENDA_TOPICS.length >= 8);
  assert.ok(STANDARD_AGENDA_TOPICS.some((t) => t.id === 'std_load_plans'));
  assert.ok(STANDARD_AGENDA_TOPICS.some((t) => t.id === 'std_vkr_topics'));

  // 2. Query all sources without filter
  const allSources = listAgendaSources(database, workspace.id, '', 500);
  assert.ok(allSources.length >= 9);

  // 3. Search questions across existing meetings
  const foundByMeeting = listAgendaSources(database, workspace.id, 'ВКР бакалавров', 50);
  assert.ok(foundByMeeting.length >= 1);
  const prevMeetingItem = foundByMeeting.find((s) => s.id === 'ai-prev-1');
  assert.ok(prevMeetingItem, 'Должен найти вопрос из предыдущего заседания');
  assert.equal(prevMeetingItem.kind, 'agenda_item');
  assert.ok(prevMeetingItem.label.includes('Протокол №2'));
  assert.equal(prevMeetingItem.heardText, 'Заслушаны темы выпускных работ.');
  assert.equal(prevMeetingItem.decisionText, 'Темы ВКР утвердить в полном объёме.');

  // 4. Copy question from previous meeting into new meeting agenda
  const updatedMeeting = addAgendaItem(database, workspace.id, 'm-new', {
    sourceKind: 'agenda_item',
    sourceId: 'ai-prev-1',
    responsibleRaw: 'Доц. Сидоров'
  });
  assert.ok(updatedMeeting.agenda);
  assert.equal(updatedMeeting.agenda.length, 1);
  const firstAgenda = updatedMeeting.agenda[0];
  assert.equal(firstAgenda.item_no, 1);
  assert.equal(firstAgenda.title, 'Об утверждении тем ВКР бакалавров');
  assert.equal(firstAgenda.heard_text, 'Заслушаны темы выпускных работ.');
  assert.equal(firstAgenda.decision_text, 'Темы ВКР утвердить в полном объёме.');
  assert.equal(firstAgenda.source_kind, 'agenda_item');

  // 5. Add standard topic preset into new meeting agenda
  const updatedMeeting2 = addAgendaItem(database, workspace.id, 'm-new', {
    sourceKind: 'standard_template',
    sourceId: 'std_load_plans'
  });
  assert.equal(updatedMeeting2.agenda.length, 2);
  const secondAgenda = updatedMeeting2.agenda[1];
  assert.equal(secondAgenda.item_no, 2);
  assert.ok(secondAgenda.title.includes('индивидуальных планов'));
  assert.ok(secondAgenda.heard_text.includes('распределении'));
  assert.ok(secondAgenda.decision_text.includes('Утвердить индивидуальные планы'));

  await rm(root, { recursive: true, force: true });
});
