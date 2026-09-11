import { isDeepStrictEqual } from 'node:util';

// Immutable source locations continue to identify questions after a manual move.
export function hasRelocatedAgendaSource(database, workspaceId, meetingId, versionId, item) {
  const rows = database.all(`
    SELECT ai.* FROM agenda_items ai JOIN meetings m ON m.id = ai.meeting_id
    WHERE m.workspace_id = ? AND ai.meeting_id <> ?
      AND EXISTS (SELECT 1 FROM audit_log a WHERE a.workspace_id = m.workspace_id
        AND a.action = 'meeting.agenda.transferred' AND a.subject_id = ai.id
        AND json_extract(a.details_json, '$.fromMeetingId') = ?)
  `, workspaceId, meetingId, meetingId);
  return rows.some((row) => {
    if (row.source_kind === 'document_agenda' && row.source_id === `${versionId}:${item.itemNo}`) return true;
    if (!item.evidence || !Object.keys(item.evidence).length) return false;
    let evidence;
    try { evidence = JSON.parse(row.evidence_json || '{}'); } catch { return false; }
    return Array.isArray(evidence.sources) && evidence.sources.some((source) =>
      source.documentVersionId === versionId && isDeepStrictEqual(source.locator, item.evidence)
    );
  });
}
