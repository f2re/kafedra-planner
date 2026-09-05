import { newId } from '../../core/src/ids.mjs';
import { clean, dateValue, fail, required, writeAudit } from './meeting-common.mjs';
import {
  createMeeting as createConfiguredMeeting,
  getMeeting,
  syncMeetingSearch
} from './meeting-core.mjs';
import { getMeetingSettings } from './meeting-settings.mjs';

function isIncompleteSettings(error) {
  return String(error?.code || error?.message || error) === 'meeting_settings_incomplete';
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

function calendarTitle(meeting) {
  return meeting.protocol_number
    ? `Заседание кафедры · протокол №${meeting.protocol_number}`
    : 'Заседание кафедры';
}

function ensureMeetingCalendar(database, meeting, now) {
  if (!meeting.meeting_date) return null;
  const title = calendarTitle(meeting);
  const description = [
    meeting.title,
    meeting.chairperson_raw ? `Председатель: ${meeting.chairperson_raw}` : null,
    meeting.secretary_raw ? `Секретарь: ${meeting.secretary_raw}` : null,
    meeting.quorum_required ? `Кворум: ${meeting.quorum_required}` : null
  ].filter(Boolean).join('\n');
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

function optionalPositive(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function createMeeting(database, workspaceId, input, actorPersonId = null, now = new Date().toISOString()) {
  try {
    return createConfiguredMeeting(database, workspaceId, input, actorPersonId, now);
  } catch (error) {
    if (!isIncompleteSettings(error)) throw error;
  }

  const settings = getMeetingSettings(database, workspaceId);
  const meetingDate = dateValue(input?.meetingDate);
  const protocolNumber = required(input?.protocolNumber, 'meeting_protocol_number_required');
  const title = clean(input?.title) || 'Заседание кафедры';
  const duplicate = database.get(`
    SELECT id FROM meetings
    WHERE workspace_id = ? AND meeting_date = ? AND protocol_number = ?
    LIMIT 1
  `, workspaceId, meetingDate, protocolNumber);
  if (duplicate) fail('meeting_duplicate');

  const protocolProfile = settings?.protocol_profile || null;
  const extractProfile = settings?.extract_profile || null;
  const id = newId('meeting');
  const evidence = JSON.stringify({
    kind: 'operator',
    source: 'meeting_editor',
    templateProfiles: {
      protocol: snapshotProfile(protocolProfile),
      extract: snapshotProfile(extractProfile)
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
    `,
    id, workspaceId, protocolNumber, meetingDate, title,
    settings?.chairperson_name || null, settings?.secretary_name || null,
    settings?.chairperson_person_id || null, settings?.secretary_person_id || null,
    optionalPositive(settings?.quorum),
    settings?.protocol_template_version_id || null,
    settings?.extract_template_version_id || null,
    actorPersonId, evidence, now, now);

    const meeting = database.get('SELECT * FROM meetings WHERE id = ?', id);
    ensureMeetingCalendar(database, meeting, now);
    syncMeetingSearch(database, workspaceId, id);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.created', 'meeting', id, {
      meetingDate,
      protocolNumber,
      title,
      creationMode: 'minimal',
      protocolTemplateProfileVersionId: protocolProfile?.profile_version_id || null,
      extractTemplateProfileVersionId: extractProfile?.profile_version_id || null
    }, now);
  });

  return getMeeting(database, workspaceId, id);
}
