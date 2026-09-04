import {
  meetingsState,
  $m,
  escMeeting,
  meetingApi,
  meetingDate,
  showMeetingNotice
} from './meetings-state.js';
import { loadMeeting, loadMeetings } from './meetings-data.js';

let pollTimer = null;
let loadToken = 0;

const stateLabels = {
  ready: 'Готово',
  needs_review: 'Нужно проверить',
  failed: 'Ошибка',
  processing: 'Обрабатывается',
  uploading: 'Сохраняется'
};

async function uploadIdentity(file, year) {
  if (window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `protocol-year:${year}:${hex}`;
  }
  const source = `${year}\u0000${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `protocol-year:${year}:${hash.toString(16).padStart(8, '0')}`;
}

function mergeItems() {
  const server = meetingsState.protocolImports.items || [];
  const serverDocuments = new Set(server.map((item) => item.document_id).filter(Boolean));
  const local = meetingsState.localProtocolUploads.filter((item) => !item.document_id || !serverDocuments.has(item.document_id));
  return [...local, ...server];
}

function summaryFor(items) {
  const summary = { total: items.length, ready: 0, needs_review: 0, failed: 0, processing: 0, uploading: 0 };
  for (const item of items) {
    const state = item.state in summary ? item.state : 'processing';
    summary[state] += 1;
  }
  return summary;
}

function reviewText(item) {
  const reviews = Array.isArray(item.reviews) ? item.reviews : [];
  if (reviews.length) return reviews.slice(0, 2).map((review) => review.title).join(' · ');
  if (item.extraction_error) return item.extraction_error;
  if (item.state === 'processing' || item.state === 'uploading') return 'Исходный файл сохранён; идёт локальный разбор.';
  if (item.state === 'ready') return `${item.agenda_count || 0} вопросов распознано`;
  return 'Откройте заседание и исправьте только сомнительные поля.';
}

function itemActions(item) {
  const actions = [];
  if (item.meeting_id) {
    actions.push(`<button class="link-button" type="button" data-open-import-meeting="${escMeeting(item.meeting_id)}">${item.state === 'needs_review' ? 'Исправить' : 'Открыть'}</button>`);
  }
  if (item.original_url) {
    actions.push(`<a class="link-button" href="${escMeeting(item.original_url)}" target="_blank" rel="noopener">Исходник</a>`);
  }
  return actions.join('');
}

export function renderProtocolImports() {
  const root = $m('#protocol-import-summary');
  if (!root) return;
  const items = mergeItems();
  const summary = summaryFor(items);
  if (!items.length) {
    root.innerHTML = `
      <div class="protocol-import-empty">
        <strong>Протоколы за ${escMeeting(meetingsState.selectedYear)} год ещё не загружены</strong>
        <span>Можно выбрать сразу все DOCX, ODT, PDF и TXT. Ошибка одного файла не остановит остальные.</span>
      </div>`;
    return;
  }
  const processing = summary.processing + summary.uploading;
  root.innerHTML = `
    <div class="protocol-import-head">
      <div><strong>Импорт за ${escMeeting(meetingsState.selectedYear)} год</strong><span>${summary.total} файлов</span></div>
      <div class="protocol-import-counters" aria-label="Состояние импорта">
        <span class="protocol-counter ready">${summary.ready} готово</span>
        <span class="protocol-counter review">${summary.needs_review} проверить</span>
        ${summary.failed ? `<span class="protocol-counter failed">${summary.failed} ошибок</span>` : ''}
        ${processing ? `<span class="protocol-counter processing">${processing} в работе</span>` : ''}
      </div>
    </div>
    <div class="protocol-import-list">
      ${items.map((item) => `
        <article class="protocol-import-item state-${escMeeting(item.state)}" data-protocol-import-item>
          <span class="protocol-import-state">${escMeeting(stateLabels[item.state] || stateLabels.processing)}</span>
          <div class="protocol-import-main">
            <strong>${escMeeting(item.original_name || item.title || 'Протокол')}</strong>
            <span>${escMeeting(item.protocol_number ? `Протокол №${item.protocol_number}` : 'Номер не определён')} · ${escMeeting(meetingDate(item.meeting_date))}</span>
            <small>${escMeeting(reviewText(item))}</small>
          </div>
          <div class="protocol-import-actions">${itemActions(item)}</div>
        </article>`).join('')}
    </div>`;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const active = (meetingsState.protocolImports.items || []).some((item) => item.state === 'processing')
    || meetingsState.localProtocolUploads.some((item) => ['uploading', 'processing'].includes(item.state));
  if (!active || !meetingsState.active) return;
  pollTimer = setTimeout(() => {
    loadProtocolImports().catch((error) => showMeetingNotice(error.message));
  }, 1200);
}

export async function loadProtocolImports() {
  const token = ++loadToken;
  const year = meetingsState.selectedYear;
  const data = await meetingApi(`/api/protocol-imports?year=${encodeURIComponent(year)}&limit=1000`);
  if (token !== loadToken || year !== meetingsState.selectedYear) return;
  meetingsState.protocolImports = data;
  const serverDocuments = new Set((data.items || []).map((item) => item.document_id));
  meetingsState.localProtocolUploads = meetingsState.localProtocolUploads
    .filter((item) => item.state === 'failed' || !item.document_id || !serverDocuments.has(item.document_id));
  renderProtocolImports();
  schedulePoll();
}

async function uploadProtocol(file, year) {
  const idempotencyKey = await uploadIdentity(file, year);
  const local = {
    id: idempotencyKey,
    original_name: file.name,
    state: 'uploading',
    agenda_count: 0,
    review_count: 0
  };
  meetingsState.localProtocolUploads.push(local);
  renderProtocolImports();
  try {
    const response = await window.fetch('/api/documents', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        'x-document-type': 'protocol',
        'idempotency-key': idempotencyKey
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    local.document_id = data.documentId;
    local.version_id = data.versionId;
    local.state = ['processed', 'needs_review', 'failed'].includes(data.status)
      ? (data.status === 'processed' ? 'ready' : data.status) : 'processing';
  } catch (error) {
    local.state = 'failed';
    local.extraction_error = error.message;
  }
  renderProtocolImports();
}

async function uploadSelectedProtocols(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const year = Number(meetingsState.selectedYear);
  for (const file of files) await uploadProtocol(file, year);
  await Promise.all([loadProtocolImports(), loadMeetings()]);
}

async function changeYear(input) {
  const year = Number(input.value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    input.value = meetingsState.selectedYear;
    showMeetingNotice('Укажите календарный год от 2000 до 2100.');
    return;
  }
  meetingsState.selectedYear = year;
  meetingsState.selectedMeetingId = null;
  meetingsState.meeting = null;
  meetingsState.localProtocolUploads = [];
  try { window.localStorage.setItem('kafedra-meetings-year', String(year)); } catch {}
  renderProtocolImports();
  await Promise.all([loadProtocolImports(), loadMeetings()]);
}

document.addEventListener('change', (event) => {
  const year = event.target.closest('#meeting-year-filter');
  if (year) {
    changeYear(year).catch((error) => showMeetingNotice(error.message));
    return;
  }
  const input = event.target.closest('#protocol-import-input');
  if (input) uploadSelectedProtocols(input).catch((error) => showMeetingNotice(error.message));
}, true);

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-import-meeting]');
  if (!button) return;
  loadMeeting(button.dataset.openImportMeeting).catch((error) => showMeetingNotice(error.message));
}, true);

window.addEventListener('kafedra:view-changed', (event) => {
  if (event.detail?.view !== 'meetings') {
    clearTimeout(pollTimer);
    return;
  }
  const input = $m('#meeting-year-filter');
  if (input) input.value = String(meetingsState.selectedYear);
  renderProtocolImports();
  loadProtocolImports().catch((error) => showMeetingNotice(error.message));
});

window.addEventListener('kafedra:meeting-updated', () => {
  if (!meetingsState.active) return;
  loadProtocolImports().catch((error) => showMeetingNotice(error.message));
});
