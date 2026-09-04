import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { clean, dateValue, fail, required, writeAudit } from './meeting-common.mjs';
import { requireCompleteSettings } from './meeting-settings.mjs';
import { listMeetingReviews, resolveMeetingReviews } from './meeting-reviews.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function appendManualCorrection(raw, correction) {
  const evidence = parseJson(raw, {});
  const history = Array.isArray(evidence.manualCorrections) ? [...evidence.manualCorrections] : [];
  history.push(correction);
  return { ...evidence, manualCorrections: history.slice(-100) };
}

function calendarTitle(meeting) {
  return meeting.protocol_number
    ? `Заседание кафедры · протокол №${meeting.protocol_number}`
    : 'Заседание кафедры';
}

function ensureMeetingCalendar(database, meeting, now) {
  const existing = database.get(`
    SELECT id FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'meeting' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, meeting.workspace_id, meeting.id);
  if (!meeting.meeting_date) {
    if (existing) database.run('DELETE FROM calendar_items WHERE id = ?', existing.id);
    return null;
  }
  const title = calendarTitle(meeting);
  const description = [
    meeting.title,
    meeting.chairperson_raw ? `Председатель: ${meeting.chairperson_raw}` : null,
    meeting.secretary_raw ? `Секретарь: ${meeting.secretary_raw}` : null,
    meeting.quorum_required ? `Кворум: ${meeting.quorum_required}` : null
  ].filter(Boolean).join('\n');
  if (existing) {
    database.run(`
      UPDATE calendar_items SET title = ?, starts_at = ?, description = ?, status = 'confirmed', updated_at = ?
      WHERE id = ?
    `, title, meeting.meeting_date, description, now, existing.id);
    return existing.id;
  }
  const id = newId('cal');
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, created_at, updated_at,
      item_kind, reminder_minutes
    ) VALUES (?, ?, 'meeting', ?, ?, ?, NULL, 1, 'organizational', 'normal', 'confirmed', ?, ?, ?, 'event', 1440)
  `, id, meeting.workspace_id, meeting.id, title, meeting.meeting_date, description, now, now);
  return id;
}

function deleteMeetingSearch(database, workspaceId, meetingId) {
  database.run(`
    DELETE FROM search_fts
    WHERE fragment_id IN (
      SELECT id FROM search_fragments
      WHERE workspace_id = ? AND (
        (source_kind = 'meeting' AND source_id = ?)
        OR (source_kind = 'agenda_item' AND source_id IN (
          SELECT id FROM agenda_items WHERE meeting_id = ?
        ))
      )
    )
  `, workspaceId, meetingId, meetingId);
  database.run(`
    DELETE FROM search_fragments
    WHERE workspace_id = ? AND (
      (source_kind = 'meeting' AND source_id = ?)
      OR (source_kind = 'agenda_item' AND source_id IN (
        SELECT id FROM agenda_items WHERE meeting_id = ?
      ))
    )
  `, workspaceId, meetingId, meetingId);
}

export function syncMeetingSearch(database, workspaceId, meetingId) {
  const meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, meetingId);
  if (!meeting) return;
  const agenda = database.all('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at, id', meetingId);
  const decisions = new Map(agenda.map((item) => [item.id, database.all(`
    SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at, id
  `, item.id)]));
  deleteMeetingSearch(database, workspaceId, meetingId);
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'meeting',
    sourceId: meetingId,
    documentVersionId: meeting.source_document_version_id || null,
    title: `Протокол №${meeting.protocol_number || '—'} · ${meeting.meeting_date || 'дата не указана'}`,
    content: [
      meeting.title, meeting.chairperson_raw, meeting.secretary_raw,
      ...agenda.flatMap((item) => [
        `Вопрос ${item.item_no}: ${item.title}`, item.source_label, item.heard_text, item.discussed_text, item.decision_text,
        ...(decisions.get(item.id) || []).flatMap((decision) => [
          decision.text,
          decision.responsible_raw ? `Ответственный: ${decision.responsible_raw}` : null,
          decision.due_date ? `Срок: ${decision.due_date}` : null
        ])
      ])
    ].filter(Boolean).join('\n'),
    locator: { kind: 'meeting', meetingId }
  });
  for (const item of agenda) {
    const itemEvidence = parseJson(item.evidence_json, {});
    const source = Array.isArray(itemEvidence.sources) ? itemEvidence.sources.at(-1) : null;
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'agenda_item',
      sourceId: item.id,
      documentVersionId: source?.documentVersionId || meeting.source_document_version_id || null,
      title: `${item.item_no}. ${item.title}`,
      content: [
        item.heard_text,
        item.discussed_text,
        item.decision_text,
        ...(decisions.get(item.id) || []).flatMap((decision) => [
          decision.text,
          decision.responsible_raw ? `Ответственный: ${decision.responsible_raw}` : null,
          decision.due_date ? `Срок: ${decision.due_date}` : null
        ])
      ].filter(Boolean).join('\n'),
      locator: itemEvidence.locator || { kind: 'agenda_item', meetingId, agendaItemId: item.id }
    });
  }
}

export function listMeetingLinks(database, workspaceId, sourceKind, sourceIds = []) {
  if (!['plan_item', 'calendar_item'].includes(sourceKind)) return [];
  const ids = [...new Set((Array.isArray(sourceIds) ? sourceIds : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 300);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return database.all(`
    SELECT ai.source_kind, ai.source_id, ai.id AS agenda_item_id, ai.item_no, ai.title AS question_title,
      m.id AS meeting_id, m.protocol_number, m.meeting_date, m.title AS meeting_title, m.status
    FROM agenda_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE m.workspace_id = ? AND ai.source_kind = ? AND ai.source_id IN (${placeholders})
    ORDER BY m.meeting_date DESC, CAST(ai.item_no AS INTEGER), ai.id
  `, workspaceId, sourceKind, ...ids);
}

export function listMeetings(database, workspaceId, options = 200) {
  const input = typeof options === 'object' && options !== null ? options : { limit: options };
  const safeLimit = Math.min(1000, Math.max(1, Number(input.limit) || 200));
  const year = input.year == null || input.year === '' ? null : Number(input.year);
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) fail('protocol_import_year_invalid');
  const params = [workspaceId];
  let periodWhere = '';
  if (year !== null) {
    const from = `${year}-01-01`;
    const to = `${year + 1}-01-01`;
    periodWhere = `
      AND (
        (m.meeting_date >= ? AND m.meeting_date < ?)
        OR (
          m.meeting_date IS NULL
          AND EXISTS (
            SELECT 1 FROM document_versions import_version
            WHERE import_version.id = m.source_document_version_id
              AND import_version.upload_key LIKE ?
          )
        )
      )`;
    params.push(from, to, `protocol-year:${year}:%`);
  }
  params.push(safeLimit);
  return database.all(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agenda_items ai WHERE ai.meeting_id = m.id) AS agenda_count,
      (SELECT COUNT(*) FROM meeting_documents md WHERE md.meeting_id = m.id) AS document_count,
      (SELECT COUNT(*) FROM review_items ri
        WHERE ri.workspace_id = m.workspace_id AND ri.status = 'open'
          AND ri.source_kind = 'document_version'
          AND ri.source_id = m.source_document_version_id) AS open_review_count
    FROM meetings m
    WHERE m.workspace_id = ?${periodWhere}
    ORDER BY COALESCE(m.meeting_date, '') DESC, m.created_at DESC
    LIMIT ?
  `, ...params);
}

function meetingDocuments(database, meetingId) {
  return database.all(`
    SELECT md.*, d.title, d.status, dv.original_name, dv.blob_sha256
    FROM meeting_documents md
    JOIN documents d ON d.id = md.document_id
    JOIN document_versions dv ON dv.id = md.document_version_id
    WHERE md.meeting_id = ?
    ORDER BY md.created_at DESC
  `, meetingId);
}

function meetingAgenda(database, meetingId) {
  return database.all(`
    SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at, id
  `, meetingId).map((item) => {
    const decisions = database.all(`
      SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at, id
    `, item.id);
    return { ...item, decisions, decision: decisions[0] || null };
  });
}

export function getMeeting(database, workspaceId, meetingId) {
  const meeting = database.get(`
    SELECT m.*,
      chair.display_name AS chairperson_name,
      secretary.display_name AS secretary_name,
      source_version.document_id AS source_document_id,
      source_version.original_name AS source_original_name,
      source_document.title AS source_document_title
    FROM meetings m
    LEFT JOIN people chair ON chair.id = m.chairperson_person_id
    LEFT JOIN people secretary ON secretary.id = m.secretary_person_id
    LEFT JOIN document_versions source_version ON source_version.id = m.source_document_version_id
    LEFT JOIN documents source_document ON source_document.id = source_version.document_id
    WHERE m.workspace_id = ? AND m.id = ?
  `, workspaceId, meetingId);
  if (!meeting) return null;
  const agenda = meetingAgenda(database, meetingId);
  const reviews = listMeetingReviews(database, workspaceId, meetingId);
  return {
    ...meeting,
    agenda,
    reviews,
    open_review_count: reviews.length,
    documents: meetingDocuments(database, meetingId)
  };
}

function snapshotProfile(profile) {
  if (!profile) return null;
  return {
    schema: profile.schema,
    templateVersionId: profile.templateVersionId,
    documentKind: profile.documentKind,
    sourceSha256: profile.sourceSha256,
    structureSha256: profile.structureSha256,
    profileSha256: profile.profileSha256,
    revision: profile.revision,
    status: profile.status,
    bindings: profile.bindings,
    repeat: profile.repeat,
    profileVersionId: profile.profile_version_id || null
  };
}

export function createMeeting(database, workspaceId, input, actorPersonId = null, now = new Date().toISOString()) {
  const settings = requireCompleteSettings(database, workspaceId);
  const meetingDate = dateValue(input?.meetingDate);
  const protocolNumber = required(input?.protocolNumber, 'meeting_protocol_number_required');
  const title = clean(input?.title) || 'Заседание кафедры';
  const duplicate = database.get(`
    SELECT id FROM meetings
    WHERE workspace_id = ? AND meeting_date = ? AND protocol_number = ?
    LIMIT 1
  `, workspaceId, meetingDate, protocolNumber);
  if (duplicate) fail('meeting_duplicate');
  const id = newId('meeting');
  const evidence = JSON.stringify({
    kind: 'operator',
    source: 'meeting_editor',
    templateProfiles: {
      protocol: snapshotProfile(settings.protocolProfile),
      extract: snapshotProfile(settings.extractProfile)
    }
  });
  database.transaction(() => {
    database.run(`
      INSERT INTO meetings(
        id, workspace_id, source_document_version_id, protocol_number, meeting_date, title,
        chairperson_raw, secretary_raw, attendees_raw,
        chairperson_person_id, secretary_person_id, quorum_required,
        protocol_template_version_id, extract_template_version_id, created_by_person_id,
        confidence, status, evidence_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?)
    `, id, workspaceId, protocolNumber, meetingDate, title,
    settings.chair.display_name, settings.secretary.display_name,
    settings.chair.id, settings.secretary.id, settings.quorum,
    settings.protocol_template_version_id, settings.extract_template_version_id,
    actorPersonId, evidence, now, now);
    const meeting = database.get('SELECT * FROM meetings WHERE id = ?', id);
    ensureMeetingCalendar(database, meeting, now);
    syncMeetingSearch(database, workspaceId, id);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.created', 'meeting', id, {
      meetingDate,
      protocolNumber,
      title,
      protocolTemplateProfileVersionId: settings.protocolProfile?.profile_version_id || null,
      extractTemplateProfileVersionId: settings.extractProfile?.profile_version_id || null
    }, now);
  });
  return getMeeting(database, workspaceId, id);
}

export function updateMeeting(database, workspaceId, meetingId, input, actorPersonId = null, now = new Date().toISOString()) {
  const current = getMeeting(database, workspaceId, meetingId);
  if (!current) fail('meeting_not_found');
  const touchedFields = ['meetingDate', 'protocolNumber', 'title']
    .filter((field) => Object.prototype.hasOwnProperty.call(input || {}, field));
  const meetingDate = Object.prototype.hasOwnProperty.call(input || {}, 'meetingDate')
    ? dateValue(input.meetingDate) : current.meeting_date;
  const protocolNumber = Object.prototype.hasOwnProperty.call(input || {}, 'protocolNumber')
    ? required(input.protocolNumber, 'meeting_protocol_number_required') : current.protocol_number;
  const title = Object.prototype.hasOwnProperty.call(input || {}, 'title')
    ? required(input.title, 'meeting_title_required') : current.title;
  const duplicate = database.get(`
    SELECT id FROM meetings
    WHERE workspace_id = ? AND meeting_date = ? AND protocol_number = ? AND id <> ?
    LIMIT 1
  `, workspaceId, meetingDate, protocolNumber, meetingId);
  if (duplicate) fail('meeting_duplicate');
  database.transaction(() => {
    const evidence = appendManualCorrection(current.evidence_json, {
      at: now,
      actorPersonId,
      fields: touchedFields,
      before: { meetingDate: current.meeting_date, protocolNumber: current.protocol_number, title: current.title },
      after: { meetingDate, protocolNumber, title }
    });
    database.run(`
      UPDATE meetings SET meeting_date = ?, protocol_number = ?, title = ?, evidence_json = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, meetingDate, protocolNumber, title, JSON.stringify(evidence), now, workspaceId, meetingId);
    const meeting = database.get('SELECT * FROM meetings WHERE id = ?', meetingId);
    ensureMeetingCalendar(database, meeting, now);
    syncMeetingSearch(database, workspaceId, meetingId);
    resolveMeetingReviews(database, workspaceId, meetingId, {
      scope: 'meeting', touchedFields
    }, actorPersonId, now);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.updated', 'meeting', meetingId, {
      touchedFields,
      before: { meetingDate: current.meeting_date, protocolNumber: current.protocol_number, title: current.title },
      after: { meetingDate, protocolNumber, title }
    }, now);
  });
  return getMeeting(database, workspaceId, meetingId);
}
