import {
  $ap,
  academicState,
  closeDetails,
  closeModal,
  ensureUi,
  exportUrl,
  selectedRun,
  showView
} from './academic-performance-state.js';
import { renderAcademicPerformance } from './academic-performance-view.js';
import {
  archiveSelectedAcademicRun,
  openAcademicDetails,
  refreshAcademicPerformance,
  restoreSelectedAcademicRun,
  selectAcademicRun,
  setAcademicTotalSelection
} from './academic-performance-actions.js';
import {
  backToAcademicUpload,
  beginAcademicImport,
  saveAcademicImport,
  saveAcademicUpload
} from './academic-performance-import.js';

function ensureAcademicUploadStyles() {
  if ($ap('#academic-upload-footer-styles')) return;
  const link = document.createElement('link');
  link.id = 'academic-upload-footer-styles';
  link.rel = 'stylesheet';
  link.href = '/academic-performance-upload.css';
  document.head.append(link);
}

function stabilizeAcademicUploadLayout() {
  ensureAcademicUploadStyles();
  const form = $ap('[data-academic-upload-form]');
  if (!form || form.dataset.academicUploadLayout === '1') return false;
  const actions = [...form.children].find((node) => node.classList?.contains('academic-modal-actions'));
  if (!actions) return false;

  const body = document.createElement('div');
  body.className = 'academic-modal-body academic-upload-body';
  for (const node of [...form.childNodes]) {
    if (node !== actions) body.append(node);
  }

  const feedback = document.createElement('div');
  feedback.className = 'academic-upload-feedback';
  const state = $ap('[data-academic-upload-state]', body);
  const error = $ap('[data-academic-error]', body);
  if (state) feedback.append(state);
  if (error) feedback.append(error);
  actions.prepend(feedback);

  const reselect = document.createElement('button');
  reselect.type = 'button';
  reselect.className = 'quiet-button academic-upload-reselect hidden';
  reselect.dataset.academicFileReselect = '1';
  reselect.textContent = 'Выбрать другой';
  const cancel = $ap('[data-academic-close]', actions);
  actions.insertBefore(reselect, cancel || actions.firstChild);

  form.classList.remove('academic-modal-body');
  form.classList.add('academic-upload-form');
  actions.classList.add('academic-upload-actions');
  form.insertBefore(body, actions);
  form.dataset.academicUploadLayout = '1';
  return true;
}

function openAcademicUpload() {
  beginAcademicImport();
  stabilizeAcademicUploadLayout();
}

function reopenAcademicUpload() {
  backToAcademicUpload();
  stabilizeAcademicUploadLayout();
}

function markSelectedAcademicFile(input) {
  const form = input?.closest?.('[data-academic-upload-form]');
  const file = input?.files?.[0];
  if (!form || !file) return;

  if (academicState.documentId) {
    academicState.documentId = null;
    academicState.analysis = null;
    academicState.uploadedName = '';
    academicState.mappingDraft = null;
  }

  const state = $ap('[data-academic-upload-state]', form);
  if (!state) return;
  state.textContent = `Выбран файл: ${file.name}`;
  state.classList.remove('hidden');
  $ap('[data-academic-file-reselect]', form)?.classList.remove('hidden');
  form.classList.add('academic-file-selected');
}

document.addEventListener('click', (event) => {
  const reselect = event.target.closest('[data-academic-file-reselect]');
  if (reselect) {
    event.preventDefault();
    const form = reselect.closest('[data-academic-upload-form]');
    $ap('input[name="file"]', form)?.click();
    return;
  }
  const navigation = event.target.closest('[data-view="academic-performance"]');
  if (navigation) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showView();
    refreshAcademicPerformance();
    return;
  }
  if (event.target.closest('[data-academic-import-open]')) {
    openAcademicUpload();
    return;
  }
  if (event.target.closest('[data-academic-close]')) return closeModal();
  if (event.target.closest('[data-academic-details-close]')) return closeDetails();
  if (event.target === $ap('[data-academic-backdrop]')) {
    closeModal();
    closeDetails();
    return;
  }
  if (event.target.closest('[data-academic-back]')) {
    reopenAcademicUpload();
    return;
  }
  if (event.target.closest('[data-academic-finish]')) {
    closeModal();
    refreshAcademicPerformance(academicState.selectedId);
    return;
  }
  const runButton = event.target.closest('[data-academic-run]');
  if (runButton) return selectAcademicRun(runButton.dataset.academicRun);
  const discipline = event.target.closest('[data-academic-discipline]');
  if (discipline) return openAcademicDetails(discipline.dataset.academicDiscipline);
  if (event.target.closest('[data-academic-history]')) {
    academicState.includeHistory = !academicState.includeHistory;
    refreshAcademicPerformance(academicState.selectedId);
    return;
  }
  if (event.target.closest('[data-academic-export-all]')) {
    window.location.href = exportUrl('csv');
    return;
  }
  const period = event.target.closest('[data-academic-export-period]');
  if (period) {
    window.location.href = exportUrl('csv', {
      academicYear: period.dataset.year,
      semester: period.dataset.semester
    });
    return;
  }
  if (event.target.closest('[data-academic-export-selected]')) {
    if (!academicState.selectedTotalIds.length) return;
    window.location.href = exportUrl('csv', {
      importIds: academicState.selectedTotalIds.join(',')
    });
    return;
  }
  const exportButton = event.target.closest('[data-academic-export]');
  if (exportButton && selectedRun()) {
    window.location.href = exportUrl(exportButton.dataset.academicExport, {
      importId: selectedRun().id
    });
    return;
  }
  if (event.target.closest('[data-academic-archive]')) return archiveSelectedAcademicRun();
  if (event.target.closest('[data-academic-restore]')) return restoreSelectedAcademicRun();
}, true);

document.addEventListener('change', (event) => {
  const fileInput = event.target.closest('[data-academic-upload-form] input[name="file"]');
  if (fileInput) {
    markSelectedAcademicFile(fileInput);
    return;
  }
  const group = event.target.closest('[data-academic-total-import]');
  if (!group) return;
  group.closest('.academic-group-selector')?.classList.toggle('selected', group.checked);
  setAcademicTotalSelection(group.value, group.checked);
}, true);

document.addEventListener('submit', (event) => {
  const upload = event.target.closest('[data-academic-upload-form]');
  if (upload) {
    event.preventDefault();
    saveAcademicUpload(upload);
    return;
  }
  const mapping = event.target.closest('[data-academic-mapping-form]');
  if (mapping) {
    event.preventDefault();
    saveAcademicImport(mapping);
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal();
    closeDetails();
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-academic-discipline]')) {
    event.preventDefault();
    openAcademicDetails(event.target.dataset.academicDiscipline);
  }
});

window.addEventListener('kafedra:view-changed', (event) => {
  if (event.detail?.view !== 'academic-performance') {
    $ap('#create-button')?.classList.remove('hidden');
  }
});

function reconcileAcademicUi() {
  ensureUi();
  stabilizeAcademicUploadLayout();
}

let ensureTimer = null;
new MutationObserver(() => {
  clearTimeout(ensureTimer);
  ensureTimer = setTimeout(reconcileAcademicUi, 40);
}).observe(document.body, { childList: true, subtree: true });

reconcileAcademicUi();
window.kafedraAcademicPerformance = {
  refresh: refreshAcademicPerformance,
  open: () => {
    showView();
    return refreshAcademicPerformance();
  },
  beginImport: () => {
    showView();
    openAcademicUpload();
  }
};
