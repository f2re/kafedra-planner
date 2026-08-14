import { meetingsState, $m, $$m, ensureMeetingsUi, showMeetingNotice } from './meetings-state.js';
import { loadMeetingsView } from './meetings-data.js';

export function activateMeetingsView(meetingId = null) {
  ensureMeetingsUi();
  meetingsState.active = true;
  if (meetingId) meetingsState.selectedMeetingId = meetingId;
  $$m('.nav-item, .mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'meetings'));
  $$m('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'meetings'));
  if ($m('#page-title')) $m('#page-title').textContent = 'Заседания';
  if ($m('#page-subtitle')) $m('#page-subtitle').textContent = 'Повестка, протоколы и выписки по вопросам';
  $m('#calendar-mode-switch')?.classList.add('hidden');
  document.body.classList.remove('mobile-sidebar-open');
  window.dispatchEvent(new CustomEvent('kafedra:view-changed', { detail: { view: 'meetings' } }));
  loadMeetingsView().catch((error) => showMeetingNotice(error.message));
}
