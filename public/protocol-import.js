import {
  meetingsState,
  $m,
  escMeeting,
  meetingApi,
  meetingDate,
  showMeetingNotice
} from './meetings-state.js';
import { loadMeeting, loadMeetings } from './meetings-data.js';
import { protocolUploadCounts, uploadCountsText, uploadStateDescription } from './upload-feedback.js';
import { enhanceProtocolBatch } from './protocol-batch.js';
import { protocolUploadIdentity } from './protocol-upload-identity.js';
import {
  archivedUploadNotice, protocolImportIsArchived, protocolImportView,
  renderProtocolImportLifecycle, resetProtocolImportView, selectProtocolImportItems
} from './protocol-import-lifecycle.js';

let pollTimer = null;
let loadToken = 0;

const stateLabels = {
  ready: 'Готово',
  needs_review: 'Нужно проверить',
  failed: 'Ошибка',
  processing: 'Обрабатывается',
  uploading: 'Загружается'
};

function mergeItems() {
  const server = meetingsState.protocolImports.items || [];
  const serverDocuments = new Set(server.map((item) => item.document_id).filter(Boolean));
  const local = meetingsState.localProtocolUploads.filter((item) => (!item.year || item.year === meetingsState.selectedYear)
    && (!item.document_id || !serverDocuments.has(item.document_id)));
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
  const stateDescription = uploadStateDescription(item);
  if (stateDescription) return stateDescription;
  return 'Откройте заседание и исправьте только сомнительные поля.';
}

function itemActions(item) {
  const actions = [];
  if (item.meeting_id) {
    actions.push(`<button class="link-button" type="button" data-open-import-meeting="${escMeeting(item.meeting_id)}">${item.state === 'needs_review' ? 'Исправить' : 'Открыть'}</button>`);
  }
  if (item.document_id && !protocolImportIsArchived(item) && ['failed', 'needs_review'].includes(item.state)) {
    actions.push(`<button class="link-button" type="button" data-reprocess-document="${escMeeting(item.document_id)}">Повторить распознавание</button>`);
  }
  if (!item.document_id && item.state === 'failed' && item.file) {
    actions.push(`<button class="link-button" type="button" data-retry-protocol-upload="${escMeeting(item.id)}">Повторить загрузку</button>`);
  }
  if (item.original_url) {
    actions.push(`<a class="link-button" href="${escMeeting(item.original_url)}" target="_blank" rel="noopener">Исходник</a>`);
  }
  return actions.join('');
}

export function renderProtocolImports() {
  const root = $m('#protocol-import-summary');
  if (!root) return;
  const allItems = mergeItems();
  const items = selectProtocolImportItems(allItems, meetingsState.selectedYear);
  const archiveView = protocolImportView() === 'archived';
  const callbacks = {
    render: renderProtocolImports,
    refresh: async () => { await Promise.all([loadProtocolImports(), loadMeetings()]); },
    dismissLocal: (id) => { meetingsState.localProtocolUploads = meetingsState.localProtocolUploads.filter((item) => item.id !== id); }
  };
  const summary = summaryFor(items);
  if (!items.length) {
    root.innerHTML = `
      <div class="protocol-import-empty">
        <strong>${archiveView ? `Архив за ${escMeeting(meetingsState.selectedYear)} год пуст` : `Протоколы за ${escMeeting(meetingsState.selectedYear)} год: нет активных загрузок`}</strong>
        <span>${archiveView ? 'Убранные файлы сохраняются здесь и могут быть восстановлены.' : 'Можно выбрать сразу все DOCX, ODT, PDF и TXT. Ошибка одного файла не остановит остальные.'}</span>
      </div>`;
    renderProtocolImportLifecycle(root, allItems, items, callbacks);
    return;
  }
  const processing = summary.processing + summary.uploading;
  const batchState = uploadCountsText(protocolUploadCounts(summary));
  root.innerHTML = `
    <div class="protocol-import-head">
      <div><strong>${archiveView ? 'Архив протоколов' : 'Импорт'} за ${escMeeting(meetingsState.selectedYear)} год</strong><span>${summary.total} файлов${archiveView ? '' : ` · ${escMeeting(batchState)}`}</span></div>
      ${archiveView ? '' : `<div class="protocol-import-counters" aria-label="Состояние импорта">
        <span class="protocol-counter ready">${summary.ready} готово</span>
        <span class="protocol-counter review">${summary.needs_review} проверить</span>
        ${summary.failed ? `<span class="protocol-counter failed">${summary.failed} ошибок</span>` : ''}
        ${processing ? `<span class="protocol-counter processing">${processing} в работе</span>` : ''}
      </div>`}
    </div>
    <div class="protocol-import-list">
      ${items.map((item) => `
        <article class="protocol-import-item state-${escMeeting(item.state)}" data-protocol-import-item>
          <span class="protocol-import-state">${escMeeting(stateLabels[item.state] || stateLabels.processing)}</span>
          <div class="protocol-import-main">
            <strong>${escMeeting(item.original_name || item.title || 'Протокол')}</strong>
            <span>${escMeeting(item.protocol_number ? `Протокол №${item.protocol_number}` : 'Номер не определён')} · ${escMeeting(item.meeting_date ? meetingDate(item.meeting_date) : item.meeting_date_raw || 'Дата не указана')}</span>
            <small>${escMeeting(reviewText(item))}</small>
          </div>
          <div class="protocol-import-actions">${itemActions(item)}</div>
        </article>`).join('')}
    </div>`;
  if (!archiveView) enhanceProtocolBatch(items, callbacks);
  renderProtocolImportLifecycle(root, allItems, items, callbacks);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const active = (meetingsState.protocolImports.items || []).some((item) => item.state === 'processing')
    || meetingsState.localProtocolUploads.some((item) => item.year === meetingsState.selectedYear && ['uploading', 'processing'].includes(item.state));
  if (!active || !meetingsState.active) return;
  pollTimer = setTimeout(() => {
    loadProtocolImports().catch((error) => {showMeetingNotice(error.message);schedulePoll();});
  }, 1200);
}

export async function loadProtocolImports() {
  const token = ++loadToken;
  const year = meetingsState.selectedYear;
  const items = new Map();let offset=0;let data;
  do {
    data = await meetingApi(`/api/protocol-imports?year=${encodeURIComponent(year)}&limit=1000&offset=${offset}`);
    if (token !== loadToken || year !== meetingsState.selectedYear) return;
    for (const item of data.items || []) items.set(item.version_id || item.document_id,item);
    offset += (data.items || []).length;
  } while (data.hasMore && data.items?.length);
  data={...data,items:[...items.values()]};data.summary=summaryFor(data.items);
  meetingsState.protocolImports = data;
  const serverDocuments = new Set((data.items || []).map((item) => item.document_id));
  meetingsState.localProtocolUploads = meetingsState.localProtocolUploads
    .filter((item) => item.year !== year || item.state === 'failed' || !item.document_id || !serverDocuments.has(item.document_id));
  renderProtocolImports();
  schedulePoll();
}

async function uploadProtocol(local, workspaceId) {
  local.state='uploading';local.extraction_error='';renderProtocolImports();
  try {
    const idempotencyKey = await protocolUploadIdentity(local.file,local.year,workspaceId,meetingsState.protocolImports.items || []);
    const response = await window.fetch('/api/documents', {
      method: 'POST',
      headers: {
        'content-type': local.file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(local.file.name),
        'x-document-type': 'protocol',
        'x-workspace-id': workspaceId,
        'idempotency-key': idempotencyKey
      },
      body: local.file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
    local.document_id = data.documentId;
    local.version_id = data.versionId;
    local.state = ['processed', 'needs_review', 'failed'].includes(data.status)
      ? (data.status === 'processed' ? 'ready' : data.status) : 'processing';
    if ((meetingsState.protocolImports.items || []).some((item) => item.document_id === data.documentId && protocolImportIsArchived(item))) archivedUploadNotice();
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
  resetProtocolImportView();
  const year = Number(meetingsState.selectedYear);
  const rows=files.map((file,index)=>({id:`upload-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,file,year,original_name:file.name,state:'uploading',agenda_count:0,review_count:0}));
  meetingsState.localProtocolUploads.push(...rows);renderProtocolImports();
  let workspaceId;
  try {workspaceId=(await meetingApi('/api/protocol-imports/tools')).workspaceId;}
  catch(error) {for(const row of rows){row.state='failed';row.extraction_error=error.message;}renderProtocolImports();return;}
  if (meetingsState.selectedYear === year) await loadProtocolImports();
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,rows.length)},async()=>{while(next<rows.length)await uploadProtocol(rows[next++],workspaceId);}));
  await Promise.all([loadProtocolImports(), loadMeetings()]);
}

async function reprocessDocument(button) {
  const documentId = button.dataset.reprocessDocument;
  if (!documentId || button.disabled) return;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Запускается…';
  try {
    await meetingApi(`/api/documents/${encodeURIComponent(documentId)}/reprocess`, { method: 'POST' });
    const local = meetingsState.localProtocolUploads.find((item) => item.document_id === documentId);
    if (local) {
      local.state = 'processing';
      local.extraction_error = '';
    }
    renderProtocolImports();
    await Promise.all([loadProtocolImports(), loadMeetings()]);
  } catch (error) {
    button.disabled = false;
    button.textContent = previous;
    throw error;
  }
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
  const retryUpload=event.target.closest('[data-retry-protocol-upload]');
  if (retryUpload) {
    retryUpload.disabled=true;
    const row=meetingsState.localProtocolUploads.find((item)=>item.id===retryUpload.dataset.retryProtocolUpload);
    if (row?.file) meetingApi('/api/protocol-imports/tools').then(async({workspaceId})=>{await uploadProtocol(row,workspaceId);await loadProtocolImports();})
      .catch((error)=>{retryUpload.disabled=false;showMeetingNotice(error.message);});
    return;
  }
  const retry = event.target.closest('[data-reprocess-document]');
  if (retry) {
    reprocessDocument(retry).catch((error) => showMeetingNotice(error.message));
    return;
  }
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
