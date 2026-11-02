import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { persistProtocol } from '../packages/protocols/src/persist.mjs';
import { updateMeeting, syncMeetingSearch, getMeeting } from '../packages/protocols/src/meeting-core.mjs';
import { search } from '../packages/storage/src/search.mjs';
import { ensureObjectPolicy } from '../packages/access-control/src/service.mjs';

test('persistProtocol сохраняет quorum_required и полностью индексирует присутствующих и повестку', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-search-consistency-'));
  try {
    const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
    const workspace = ensureDefaultWorkspace(database);

  const protocolResult = {
    protocolNumber: '7',
    meetingDate: '2026-11-02',
    title: 'Заседание кафедры №7',
    chairperson: 'проф. Сидоров А.В.',
    secretary: 'доц. Кузнецова Т.И.',
    attendees: 'Иванов И.И., Петров П.П., Сидоров А.В., Кузнецова Т.И.',
    quorumRequired: 8,
    quorum: { total: 12, present: 10, required: 8, text: '10 из 12 членов кафедры (кворум имеется)' },
    confidence: 0.95,
    evidence: { scope: 'full_document' },
    agendaItems: [
      {
        itemNo: 1,
        title: 'Об утверждении планов научной работы',
        heardText: 'Заслушали доклад проф. Сидорова о планах НИР.',
        discussedText: 'В обсуждении участвовал доц. Петров.',
        decisionText: 'Утвердить план НИР кафедры на 2027 год.',
        responsibleRaw: 'Сидоров А.В.',
        dueDate: '2026-12-31',
        evidence: { itemNo: 1 }
      }
    ]
  };

  const meetingId = persistProtocol(database, {
    workspaceId: workspace.id,
    documentVersionId: null,
    documentTitle: 'Протокол 7.docx',
    result: protocolResult
  });

  const row = database.get('SELECT * FROM meetings WHERE id = ?', meetingId);
  assert.equal(row.quorum_required, 8, 'quorum_required должен сохраниться в таблице meetings');
  assert.equal(row.attendees_raw, 'Иванов И.И., Петров П.П., Сидоров А.В., Кузнецова Т.И.');

  // Проверяем, что поиск находит заседание по присутствующим
  const hitsAttendees = search(database, workspace.id, 'Петров');
  assert.ok(hitsAttendees.some((h) => h.source_kind === 'meeting' && h.source_id === meetingId), 'Поиск должен находить заседание по фамилии присутствующего');

  // Проверяем, что поиск находит заседание по кворуму
  const hitsQuorum = search(database, workspace.id, 'кворум имеется');
  assert.ok(hitsQuorum.some((h) => h.source_kind === 'meeting' && h.source_id === meetingId), 'Поиск должен находить заседание по тексту кворума');

  // Проверяем, что после updateMeeting присутствующие остаются в поисковом индексе
  updateMeeting(database, workspace.id, meetingId, {
    title: 'Заседание кафедры №7 (уточненное)'
  });

  const hitsAfterUpdate = search(database, workspace.id, 'Петров');
  assert.ok(hitsAfterUpdate.some((h) => h.source_kind === 'meeting' && h.source_id === meetingId), 'После updateMeeting присутствующие должны оставаться в поисковом индексе');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
