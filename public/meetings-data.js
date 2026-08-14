import { meetingsState, meetingApi } from './meetings-state.js';
import { renderMeetingDetail, renderMeetingList, renderSettingsSummary } from './meetings-render.js';

export async function loadMeetingSettings() {
  const data = await meetingApi('/api/meeting-settings');
  meetingsState.settings = data.settings || null;
  meetingsState.resources = data.resources || { users: [], templates: [] };
  renderSettingsSummary();
}

export async function loadMeetings(preferredId = null) {
  const data = await meetingApi('/api/meetings?limit=500');
  meetingsState.meetings = data.items || [];
  if (preferredId) meetingsState.selectedMeetingId = preferredId;
  if (meetingsState.selectedMeetingId && !meetingsState.meetings.some((item) => item.id === meetingsState.selectedMeetingId)) {
    meetingsState.selectedMeetingId = null;
  }
  if (!meetingsState.selectedMeetingId && meetingsState.meetings.length) meetingsState.selectedMeetingId = meetingsState.meetings[0].id;
  renderMeetingList();
  if (meetingsState.selectedMeetingId) await loadMeeting(meetingsState.selectedMeetingId, false);
  else {
    meetingsState.meeting = null;
    meetingsState.selectedForExtract.clear();
    renderMeetingDetail();
  }
}

export async function loadMeeting(meetingId, resetSelection = true) {
  meetingsState.meeting = await meetingApi(`/api/meetings/${encodeURIComponent(meetingId)}`);
  meetingsState.selectedMeetingId = meetingId;
  if (resetSelection) meetingsState.selectedForExtract.clear();
  else {
    const valid = new Set((meetingsState.meeting.agenda || []).map((item) => item.id));
    meetingsState.selectedForExtract = new Set([...meetingsState.selectedForExtract].filter((id) => valid.has(id)));
  }
  renderMeetingList();
  renderMeetingDetail();
}

export async function loadMeetingsView() {
  await Promise.all([loadMeetingSettings(), loadMeetings()]);
}
