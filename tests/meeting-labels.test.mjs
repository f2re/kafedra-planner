import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingDateLabel, planMeetingLinkLabel } from '../public/meeting-labels.js';

test('обратная ссылка заседания содержит номер, дату протокола и номер вопроса', () => {
  assert.equal(meetingDateLabel('2026-09-15'), '15.09.2026');
  assert.equal(
    planMeetingLinkLabel({ protocol_number: '7', meeting_date: '2026-09-15', item_no: 4 }),
    'протокол №7 от 15.09.2026 · вопрос 4'
  );
});
