function errorWord(count) {
  const value = Math.abs(Number(count) || 0);
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'ошибок';
  if (mod10 === 1) return 'ошибка';
  if (mod10 >= 2 && mod10 <= 4) return 'ошибки';
  return 'ошибок';
}

function savedText(count) {
  const value = Math.max(0, Number(count) || 0);
  return value === 1 ? '1 сохранён' : `${value} сохранено`;
}

function uploadingText(count) {
  const value = Math.max(0, Number(count) || 0);
  return value === 1 ? '1 загружается' : `${value} загружаются`;
}

export function uploadCountsText({ saved = 0, errors = 0, uploading = 0 } = {}) {
  const parts = [];
  if (saved > 0) parts.push(savedText(saved));
  if (errors > 0) parts.push(`${errors} ${errorWord(errors)}`);
  if (uploading > 0) parts.push(uploadingText(uploading));
  return parts.length ? parts.join(', ') : 'Нет файлов';
}

export function batchUploadMessage({ saved = 0, errors = 0 } = {}) {
  const summary = uploadCountsText({ saved, errors });
  if (saved > 0) return `${summary}. Обработка сохранённых документов продолжается.`;
  return `${summary}.`;
}

export function protocolUploadCounts(summary = {}) {
  return {
    saved: Number(summary.ready || 0) + Number(summary.needs_review || 0) + Number(summary.processing || 0),
    errors: Number(summary.failed || 0),
    uploading: Number(summary.uploading || 0)
  };
}

export function uploadStateDescription(item = {}) {
  if (item.state === 'uploading') return 'Файл загружается. Сохранение ещё не подтверждено сервером.';
  if (item.state === 'processing') return 'Исходный файл сохранён; обработка продолжается.';
  if (item.state === 'ready') return `${Number(item.agenda_count || 0)} вопросов распознано`;
  return null;
}
