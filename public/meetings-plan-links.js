import { $$m, escMeeting, meetingApi } from './meetings-state.js';
import { planMeetingLinkLabel } from './meeting-labels.js';

export function invalidatePlanMeetingLink(sourceId) {
  if (!sourceId) return;
  const row = $$m('[data-plan-item-row]').find((candidate) => candidate.dataset.planItemRow === String(sourceId));
  if (!row) return;
  row.removeAttribute('data-meeting-links-loaded');
  row.querySelector('.plan-meeting-links')?.remove();
}

let planMeetingLinkTimer = null;
export async function decoratePlanMeetingLinks() {
  const rows = $$m('[data-plan-item-row]').filter((row) => !row.hasAttribute('data-meeting-links-loaded'));
  if (!rows.length) return;
  rows.forEach((row) => row.setAttribute('data-meeting-links-loaded', '1'));
  const ids = rows.map((row) => row.dataset.planItemRow).filter(Boolean);
  if (!ids.length) return;
  try {
    const data = await meetingApi(`/api/meeting-links?sourceKind=plan_item&sourceIds=${encodeURIComponent(ids.join(','))}`);
    const bySource = new Map();
    for (const link of data.items || []) {
      if (!bySource.has(link.source_id)) bySource.set(link.source_id, []);
      bySource.get(link.source_id).push(link);
    }
    for (const row of rows) {
      if (!row.isConnected) continue;
      const links = bySource.get(row.dataset.planItemRow) || [];
      if (!links.length) continue;
      const cell = row.querySelector('td:nth-child(2)');
      if (!cell || cell.querySelector('.plan-meeting-links')) continue;
      cell.insertAdjacentHTML('beforeend', `<div class="plan-meeting-links"><span>Рассмотрено на заседании кафедры:</span>${links.map((link) =>
        `<button type="button" data-open-linked-meeting="${escMeeting(link.meeting_id)}">${escMeeting(planMeetingLinkLabel(link))}</button>`
      ).join('')}</div>`);
    }
  } catch {
    rows.forEach((row) => row.removeAttribute('data-meeting-links-loaded'));
  }
}

export function schedulePlanMeetingLinks() {
  clearTimeout(planMeetingLinkTimer);
  planMeetingLinkTimer = setTimeout(() => decoratePlanMeetingLinks(), 60);
}
