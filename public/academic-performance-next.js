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
  restoreSelectedAcademicRun
} from './academic-performance-actions.js';
import {
  backToAcademicUpload,
  beginAcademicImport,
  saveAcademicImport,
  saveAcademicUpload
} from './academic-performance-import.js';

document.addEventListener('click', (event) => {
  const navigation = event.target.closest('[data-view="academic-performance"]');
  if (navigation) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showView();
    refreshAcademicPerformance();
    return;
  }
  if (event.target.closest('[data-academic-import-open]')) return beginAcademicImport();
  if (event.target.closest('[data-academic-close]')) return closeModal();
  if (event.target.closest('[data-academic-details-close]')) return closeDetails();
  if (event.target === $ap('[data-academic-backdrop]')) {
    closeModal();
    closeDetails();
    return;
  }
  if (event.target.closest('[data-academic-back]')) return backToAcademicUpload();
  if (event.target.closest('[data-academic-finish]')) {
    closeModal();
    refreshAcademicPerformance(academicState.selectedId);
    return;
  }
  const runButton = event.target.closest('[data-academic-run]');
  if (runButton) {
    academicState.selectedId = runButton.dataset.academicRun;
    renderAcademicPerformance();
    return;
  }
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

let ensureTimer = null;
new MutationObserver(() => {
  clearTimeout(ensureTimer);
  ensureTimer = setTimeout(ensureUi, 40);
}).observe(document.body, { childList: true, subtree: true });

ensureUi();
window.kafedraAcademicPerformance = {
  refresh: refreshAcademicPerformance,
  open: () => {
    showView();
    refreshAcademicPerformance();
  }
};
