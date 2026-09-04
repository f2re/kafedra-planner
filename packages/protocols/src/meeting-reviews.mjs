import { writeAudit } from './meeting-common.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function meetingReviewContext(database, workspaceId, meetingId) {
  const meeting = database.get(`
    SELECT * FROM meetings WHERE workspace_id = ? AND id = ?
  `, workspaceId, meetingId);
  if (!meeting) return null;
  const agenda = database.all(`
    SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at, id
  `, meetingId);
  const decisions = agenda.flatMap((item) => database.all(`
    SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at, id
  `, item.id));
  const sourceIds = new Set();
  if (meeting.source_document_version_id) sourceIds.add(meeting.source_document_version_id);
  const evidence = parseJson(meeting.evidence_json, {});
  for (const source of Array.isArray(evidence.sources) ? evidence.sources : []) {
    if (source?.documentVersionId) sourceIds.add(source.documentVersionId);
  }
  return {
    meeting,
    agenda,
    decisions,
    sourceIds,
    agendaIds: new Set(agenda.map((item) => item.id)),
    decisionIds: new Set(decisions.map((item) => item.id))
  };
}

function relatedToMeeting(row, context, meetingId) {
  const data = parseJson(row.context_json, {});
  if (context.sourceIds.has(row.source_id)) return true;
  if (data.meetingId === meetingId) return true;
  if (Array.isArray(data.candidates) && data.candidates.includes(meetingId)) return true;
  if (context.agendaIds.has(data.agendaId) || context.agendaIds.has(data.existingAgendaId)) return true;
  if (Array.isArray(data.candidates) && data.candidates.some((id) => context.agendaIds.has(id))) return true;
  if (context.decisionIds.has(data.decisionId)) return true;
  return [...context.agendaIds, ...context.decisionIds].some((id) => String(row.issue_code || '').includes(id));
}

function sourceMetadata(database, versionId) {
  return database.get(`
    SELECT dv.document_id, dv.original_name
    FROM document_versions dv WHERE dv.id = ?
  `, versionId) || {};
}

export function listMeetingReviews(database, workspaceId, meetingId) {
  const context = meetingReviewContext(database, workspaceId, meetingId);
  if (!context) return [];
  return database.all(`
    SELECT * FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version' AND status = 'open'
    ORDER BY created_at, id
  `, workspaceId).filter((row) => relatedToMeeting(row, context, meetingId)).map((row) => {
    const source = sourceMetadata(database, row.source_id);
    return {
      ...row,
      context: parseJson(row.context_json, {}),
      document_id: source.document_id || null,
      source_name: source.original_name || null
    };
  });
}

function touched(change, field) {
  return Array.isArray(change?.touchedFields) && change.touchedFields.includes(field);
}

function normalized(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

function yearOf(value) {
  const match = String(value || '').match(/^(20\d{2})-/u);
  return match ? Number(match[1]) : null;
}

function canResolve(row, data, context, change) {
  const code = String(row.issue_code || '');
  const meeting = context.meeting;
  if (code === 'protocol_number_missing') return Boolean(meeting.protocol_number);
  if (code === 'meeting_date_missing') return Boolean(meeting.meeting_date);
  if (code === 'agenda_missing') return context.agenda.length > 0;
  if (code === 'empty_text' || code.startsWith('ocr_')) {
    return change?.scope === 'agenda'
      && Boolean(meeting.protocol_number && meeting.meeting_date && context.agenda.length > 0);
  }
  if (code === 'protocol_year_mismatch') {
    return Boolean(data.importYear && yearOf(meeting.meeting_date) === Number(data.importYear));
  }
  if (change?.scope === 'meeting') {
    if (code === 'protocol_meeting_match_ambiguous') return (change.touchedFields || []).length > 0;
    if (code.startsWith('protocol_meeting_protocol_number_conflict_')) return touched(change, 'protocolNumber');
    if (code.startsWith('protocol_meeting_meeting_date_conflict_')) return touched(change, 'meetingDate');
    if (code.startsWith('protocol_meeting_') && code.includes('_conflict_')) {
      return touched(change, data.field) || touched(change, String(data.field || '').replace(/_([a-z])/gu, (_, char) => char.toUpperCase()));
    }
  }
  if (change?.scope !== 'agenda') return false;
  const agendaId = change.agendaItemId;
  const decisionId = change.decisionId;
  const sameAgenda = !data.agendaId && !data.existingAgendaId
    ? Boolean(agendaId && code.includes(String(agendaId)))
    : [data.agendaId, data.existingAgendaId].includes(agendaId);
  const sameDecision = data.decisionId
    ? data.decisionId === decisionId
    : Boolean(decisionId && code.includes(String(decisionId)));
  if (code.startsWith('responsible_person_unresolved_')) return sameDecision && touched(change, 'responsibleRaw');
  if (code.startsWith('protocol_decision_responsible_raw_conflict_')) return sameDecision && touched(change, 'responsibleRaw');
  if (code.startsWith('protocol_decision_due_date_conflict_')) return sameDecision && touched(change, 'dueDate');
  if (code.startsWith('protocol_decision_conflict_')) return sameAgenda && touched(change, 'decisionText');
  if (code.startsWith('protocol_agenda_heard_text_conflict_')) return sameAgenda && touched(change, 'heardText');
  if (code.startsWith('protocol_agenda_discussed_text_conflict_')) return sameAgenda && touched(change, 'discussedText');
  if (code.startsWith('protocol_agenda_decision_text_conflict_')) return sameAgenda && touched(change, 'decisionText');
  if (code.startsWith('protocol_agenda_number_conflict_')) {
    return (sameAgenda && touched(change, 'title'))
      || (touched(change, 'title') && normalized(change?.values?.title) === normalized(data?.incoming?.title));
  }
  if (code.startsWith('protocol_agenda_ambiguous_')) {
    return touched(change, 'title') && normalized(change?.values?.title) === normalized(data?.item?.title);
  }
  return false;
}

export function resolveMeetingReviews(
  database,
  workspaceId,
  meetingId,
  change,
  actorPersonId = null,
  now = new Date().toISOString()
) {
  const context = meetingReviewContext(database, workspaceId, meetingId);
  if (!context) return [];
  const resolved = [];
  const rows = database.all(`
    SELECT * FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version' AND status = 'open'
    ORDER BY created_at, id
  `, workspaceId);
  for (const row of rows) {
    if (!relatedToMeeting(row, context, meetingId)) continue;
    const data = parseJson(row.context_json, {});
    if (!canResolve(row, data, context, change)) continue;
    database.run(`
      UPDATE review_items
      SET status = 'resolved', resolved_at = ?, resolution_json = ?
      WHERE id = ? AND status = 'open'
    `, now, JSON.stringify({
      action: 'manual_correction',
      actorPersonId,
      meetingId,
      scope: change?.scope || null,
      touchedFields: change?.touchedFields || [],
      agendaItemId: change?.agendaItemId || null,
      decisionId: change?.decisionId || null
    }), row.id);
    resolved.push(row.id);
  }
  if (resolved.length) {
    const resolvedRows = rows.filter((row) => resolved.includes(row.id));
    for (const versionId of new Set(resolvedRows.map((row) => row.source_id))) {
      const remaining = Number(database.get(`
        SELECT COUNT(*) AS count FROM review_items
        WHERE workspace_id = ? AND source_kind = 'document_version'
          AND source_id = ? AND status = 'open'
      `, workspaceId, versionId)?.count || 0);
      if (remaining > 0) continue;
      const extraction = database.get(`
        SELECT id, result_json FROM extraction_runs
        WHERE document_version_id = ? ORDER BY started_at DESC, id DESC LIMIT 1
      `, versionId);
      if (!parseJson(extraction?.result_json, {})?.protocol) continue;
      const version = database.get('SELECT document_id FROM document_versions WHERE id = ?', versionId);
      database.run(`
        UPDATE document_versions SET processing_status = 'processed'
        WHERE id = ? AND processing_status = 'needs_review'
      `, versionId);
      if (version?.document_id) {
        database.run(`
          UPDATE documents SET status = 'processed', updated_at = ?
          WHERE id = ? AND current_version_id = ? AND status = 'needs_review'
        `, now, version.document_id, versionId);
      }
      if (extraction?.id) {
        database.run(`
          UPDATE extraction_runs SET status = 'completed'
          WHERE id = ? AND status = 'needs_review'
        `, extraction.id);
      }
    }
    writeAudit(database, workspaceId, actorPersonId, 'meeting.reviews.resolved', 'meeting', meetingId, {
      reviewIds: resolved,
      scope: change?.scope || null,
      touchedFields: change?.touchedFields || []
    }, now);
  }
  return resolved;
}
