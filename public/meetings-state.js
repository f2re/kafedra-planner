export const meetingsState = {
  active: false,
  settings: null,
  resources: { users: [], templates: [] },
  meetings: [],
  selectedMeetingId: null,
  meeting: null,
  sources: [],
  selectedForExtract: new Set(),
  upload: { inProgress: false, documentId: null }
};

export const $m = (selector, root = document) => root.querySelector(selector);
export const $$m = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escMeeting(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export async function meetingApi(path, options = {}) {
  const response = await window.fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    error.code = data?.error?.code || null;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function meetingDate(value) {
  if (!value) return 'Дата не указана';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function ensureMeetingStyles() {
  if ($m('#meetings-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'meetings-next-styles';
  link.rel = 'stylesheet';
  link.href = '/meetings-next.css';
  document.head.append(link);
}

let templateEditorLoading = null;
function ensureMeetingTemplateEditor() {
  if (templateEditorLoading) return templateEditorLoading;
  templateEditorLoading = import('/meeting-template-editor.js')
    .then((module) => module.installMeetingTemplateEditorEnhancer())
    .catch(() => null);
  return templateEditorLoading;
}

let templateLibraryLoading = null;
function ensureMeetingTemplateLibrary() {
  if (templateLibraryLoading) return templateLibraryLoading;
  templateLibraryLoading = import('/meeting-template-library.js')
    .then((module) => module.installMeetingTemplateLibraryEnhancer())
    .catch(() => null);
  return templateLibraryLoading;
}

export function ensureMeetingsUi() {
  ensureMeetingStyles();
  ensureMeetingTemplateEditor();
  ensureMeetingTemplateLibrary();
  const nav = $m('#navigation');
  if (nav && !$m('[data-view="meetings"]', nav)) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'meetings';
    button.innerHTML = '<span class="nav-icon" aria-hidden="true">◫</span><span>Заседания</span>';
    nav.querySelector('[data-view="documents"]')?.before(button);
  }
  const mobile = $m('.mobile-tabs');
  if (mobile && !$m('[data-view="meetings"]', mobile)) {
    const button = document.createElement('button');
    button.className = 'mobile-tab meeting-mobile-tab';
    button.dataset.view = 'meetings';
    button.innerHTML = '<span>◫</span>Заседания';
    mobile.querySelector('[data-view="documents"]')?.before(button);
  }
  const workspace = $m('.workspace');
  if (workspace && !$m('[data-view-panel="meetings"]')) {
    workspace.insertAdjacentHTML('beforeend', `
      <section class="view meetings-view" data-view-panel="meetings">
        <div class="meetings-heading">
          <div><h2>Заседания кафедры</h2><p>Загрузите готовый протокол — заседание и повестка появятся сразу. Либо создайте новое заседание вручную.</p></div>
          <div class="meetings-heading-actions">
            <input id="meeting-source-upload-input" class="hidden" type="file" accept=".docx,.odt,.pdf,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/pdf,text/plain,text/markdown">
            <button id="meeting-source-upload-button" class="secondary-button" type="button">Загрузить протокол</button>
            <button id="meeting-settings-button" class="secondary-button" type="button">Настройки</button>
            <button id="meeting-create-button" class="primary-button" type="button">Новое заседание</button>
          </div>
        </div>
        <div id="meeting-settings-summary" class="meeting-settings-summary"></div>
        <div class="meetings-layout">
          <section class="meetings-list-panel" aria-label="Заседания"><div id="meetings-list" class="meetings-list"><div class="empty-state">Загрузка…</div></div></section>
          <section id="meeting-detail" class="meeting-detail-panel"><div class="empty-state">Выберите заседание слева или загрузите протокол.</div></section>
        </div>
      </section>
    `);
  }
  if (!$m('#meeting-modal-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="meeting-modal-backdrop" class="meeting-modal-backdrop hidden"></div>
      <section id="meeting-modal" class="meeting-modal hidden" role="dialog" aria-modal="true"></section>
      <div id="meeting-notice" class="meeting-notice hidden" role="status" aria-live="polite"></div>
    `);
  }
}

export function showMeetingNotice(message) {
  const notice = $m('#meeting-notice');
  if (!notice) return;
  notice.textContent = message;
  notice.classList.remove('hidden');
  clearTimeout(showMeetingNotice.timer);
  showMeetingNotice.timer = setTimeout(() => notice.classList.add('hidden'), 6000);
}

export function openMeetingModal(html) {
  const previous = $m('#meeting-modal');
  if (!previous) return;
  const modal = previous.cloneNode(false);
  previous.replaceWith(modal);
  modal.innerHTML = html;
  modal.className = 'meeting-modal';
  modal.classList.remove('hidden');
  $m('#meeting-modal-backdrop')?.classList.remove('hidden');
  document.body.classList.add('meeting-modal-open');
  requestAnimationFrame(() => modal.querySelector('input,select,textarea,button')?.focus());
  modal.dispatchEvent(new CustomEvent('meeting-modal-opened', { bubbles: true }));
}

export function closeMeetingModal() {
  const modal = $m('#meeting-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('meeting-template-editor-modal');
  $m('#meeting-modal-backdrop')?.classList.add('hidden');
  document.body.classList.remove('meeting-modal-open');
  modal?.dispatchEvent(new CustomEvent('meeting-modal-closed', { bubbles: true }));
}

export function settingsReady() {
  const s = meetingsState.settings;
  return Boolean(s?.protocol_template_version_id && s?.extract_template_version_id
    && s?.chairperson_person_id && s?.secretary_person_id && Number(s?.quorum) > 0);
}
