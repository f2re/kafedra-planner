import { batchUploadMessage } from './upload-feedback.js';

function showUploadToast(message) {
  const element = document.querySelector('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(showUploadToast.timer);
  showUploadToast.timer = setTimeout(() => element.classList.add('hidden'), 4200);
}

async function uploadDocuments(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const progress = document.querySelector('#upload-progress');
  if (!progress) return;
  progress.classList.remove('hidden');
  let saved = 0;
  let errors = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    progress.textContent = `Загрузка ${index + 1} из ${files.length}: ${file.name}`;
    try {
      const response = await window.fetch('/api/documents', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'idempotency-key': `${file.name}:${file.size}:${file.lastModified}`
        },
        body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
      saved += 1;
    } catch (error) {
      errors += 1;
      showUploadToast(`${file.name}: ${error.message}`);
    }
  }
  progress.textContent = batchUploadMessage({ saved, errors });
  setTimeout(() => progress.classList.add('hidden'), 5000);
  if (saved > 0 && typeof window.kafedraSetView === 'function') window.kafedraSetView('documents');
}

document.addEventListener('change', (event) => {
  const input = event.target.closest?.('#file-input');
  if (!input) return;
  event.stopImmediatePropagation();
  uploadDocuments(input).catch((error) => showUploadToast(error.message || 'Не удалось загрузить документы.'));
}, { capture: true });
