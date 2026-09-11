import { clean, fail, required, writeAudit } from './meeting-common.mjs';
import { getMeeting, syncMeetingSearch } from './meeting-core.mjs';

function renumber(database, meetingId, now) {
  const rows = database.all('SELECT id, item_no FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at, id', meetingId);
  const offset = Math.max(0, ...rows.map((row) => Number(row.item_no))) + 1;
  database.run('UPDATE agenda_items SET item_no = item_no + ? WHERE meeting_id = ?', offset, meetingId);
  rows.forEach((row, index) => database.run(
    'UPDATE agenda_items SET item_no = ?, updated_at = ? WHERE id = ?', index + 1, now, row.id
  ));
}

// A transfer changes ownership, never the question ID, decisions or immutable evidence.
export function transferAgendaItem(database, workspaceId, meetingId, itemId, input, actorPersonId = null, now = new Date().toISOString()) {
  const targetMeetingId = required(input?.targetMeetingId, 'agenda_transfer_target_required');
  const requestId = clean(input?.requestId);
  if (!requestId || requestId.length > 128) fail('agenda_transfer_request_invalid');
  if (meetingId === targetMeetingId) fail('agenda_transfer_same_meeting');
  let duplicateRequest = false;
  let currentMeetingId;
  database.transaction(() => {
    for (const id of [meetingId, targetMeetingId]) {
      if (!database.get('SELECT id FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, id)) fail('meeting_not_found');
    }
    const item = database.get(`
      SELECT ai.* FROM agenda_items ai JOIN meetings m ON m.id = ai.meeting_id
      WHERE m.workspace_id = ? AND ai.id = ?
    `, workspaceId, itemId);
    if (!item) fail('agenda_item_not_found');
    const previous = database.get(`
      SELECT details_json FROM audit_log
      WHERE workspace_id = ? AND action = 'meeting.agenda.transferred'
        AND subject_kind = 'agenda_item' AND subject_id = ?
        AND json_extract(details_json, '$.requestId') = ?
    `, workspaceId, itemId, requestId);
    if (previous) {
      const details = JSON.parse(previous.details_json);
      if (details.fromMeetingId !== meetingId || details.toMeetingId !== targetMeetingId) fail('agenda_transfer_request_conflict');
      duplicateRequest = true;
      currentMeetingId = item.meeting_id;
      return;
    }
    if (item.meeting_id !== meetingId) fail('agenda_transfer_conflict');
    if (item.source_kind && item.source_id && database.get(`
      SELECT id FROM agenda_items WHERE meeting_id = ? AND source_kind = ? AND source_id = ?
    `, targetMeetingId, item.source_kind, item.source_id)) fail('agenda_source_duplicate');
    const targetNo = Number(database.get('SELECT COALESCE(MAX(item_no), 0) + 1 AS n FROM agenda_items WHERE meeting_id = ?', targetMeetingId).n);
    database.run('UPDATE agenda_items SET meeting_id = ?, item_no = ?, updated_at = ? WHERE id = ?', targetMeetingId, targetNo, now, itemId);
    renumber(database, meetingId, now);
    renumber(database, targetMeetingId, now);
    for (const id of [meetingId, targetMeetingId]) {
      database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, id);
      syncMeetingSearch(database, workspaceId, id);
    }
    writeAudit(database, workspaceId, actorPersonId, 'meeting.agenda.transferred', 'agenda_item', itemId, {
      requestId, fromMeetingId: meetingId, toMeetingId: targetMeetingId,
      fromItemNo: item.item_no,
      toItemNo: database.get('SELECT item_no FROM agenda_items WHERE id = ?', itemId).item_no,
      sourceKind: item.source_kind, sourceId: item.source_id
    }, now);
    currentMeetingId = targetMeetingId;
  });
  return {
    agendaItemId: itemId, currentMeetingId, duplicateRequest,
    sourceMeeting: getMeeting(database, workspaceId, meetingId),
    targetMeeting: getMeeting(database, workspaceId, targetMeetingId)
  };
}
