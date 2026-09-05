import { meetingsState, escMeeting, openMeetingModal } from './meetings-state.js';
import {
  openAgendaModal,
  openEditMeetingModal,
  openSettingsModal,
  openSourceModal,
  renderSources,
  templateOptions
} from './meetings-modals.js';

export {
  openAgendaModal,
  openEditMeetingModal,
  openSettingsModal,
  openSourceModal,
  renderSources,
  templateOptions
};

function selectedDate() {
  const today = new Date();
  const year = Number(meetingsState.selectedYear) || today.getFullYear();
  const month = today.getMonth();
  const day = Math.min(today.getDate(), new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function openCreateMeetingModal() {
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Новое заседание</span><h3>Дата и номер протокола</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-create-form" class="meeting-modal-body">
      <div class="meeting-form-two">
        <label class="field"><span>Дата</span><input name="meetingDate" type="date" value="${selectedDate()}" required></label>
        <label class="field"><span>Номер протокола</span><input name="protocolNumber" autocomplete="off" required placeholder="Например, 7"></label>
      </div>
      <p class="meeting-helper">Этого достаточно, чтобы создать заседание и составить повестку. Шаблон и реквизиты выпуска понадобятся только при формировании протокола или выписки.</p>
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button><button type="submit" class="primary-button">Создать</button></div>
    </form>
  `);
}

function templateReady(template) {
  return ['ready', 'legacy_compatible'].includes(template.readiness) || Boolean(template.legacy_ready);
}

function templatesFor(kind) {
  return (meetingsState.resources.templates || []).filter((template) =>
    (!template.document_kind || template.document_kind === kind) && templateReady(template)
  );
}

function generationTemplateOptions(kind) {
  return templatesFor(kind).map((template) => {
    const label = [
      template.display_name || template.title || template.original_name || 'DOCX-шаблон',
      template.version_no ? `версия ${Number(template.version_no)}` : null
    ].filter(Boolean).join(' · ');
    return `<option value="${escMeeting(template.version_id || template.document_version_id)}">${escMeeting(label)}</option>`;
  }).join('');
}

export function openGenerateMeetingModal(kind) {
  const protocol = kind === 'protocol';
  const label = protocol ? 'протокола' : 'выписки';
  const options = generationTemplateOptions(kind);
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>${protocol ? 'Протокол' : 'Выписка'}</span><h3>Выберите шаблон ${label}</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-generate-form" data-document-kind="${escMeeting(kind)}" class="meeting-modal-body">
      ${options ? `
        <label class="field"><span>Шаблон ${label}</span><select name="templateVersionId" required>${options}</select></label>
        <p class="meeting-helper">Выбор относится только к этому виду документа. Точная версия шаблона сохранится в истории сформированного файла.</p>
      ` : `
        <div class="meeting-callout"><strong>Нет готового шаблона ${label}</strong><span>Подготовьте только нужный DOCX. Настройка другого вида документа не требуется.</span></div>
      `}
      <div class="meeting-modal-actions">
        ${!options ? '<button type="button" class="secondary-button" data-open-meeting-settings>Открыть настройки</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="secondary-button" data-close-meeting-modal>Отмена</button>
        ${options ? `<button type="submit" class="primary-button">Сформировать ${protocol ? 'протокол' : 'выписку'}</button>` : ''}
      </div>
    </form>
  `);
}
